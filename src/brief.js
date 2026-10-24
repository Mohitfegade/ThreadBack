import fs from 'node:fs';
import path from 'node:path';
import { ensureMemoryDir, getMemoryDirPath, readLedger } from './features.js';
import { readSessions } from './sessions.js';
import { scanRepository } from './scanner.js';
import { getGitSummary } from './git.js';

export const BRIEF_FILE_NAME = 'brief.json';

/**
 * Returns the absolute path to brief.json.
 *
 * @param {string} targetDir
 * @returns {string}
 */
export function getBriefFilePath(targetDir) {
  return path.join(getMemoryDirPath(targetDir), BRIEF_FILE_NAME);
}

/**
 * Reads brief.json from target repository.
 *
 * @param {string} targetDir
 * @returns {object}
 */
export function readBrief(targetDir) {
  const filePath = getBriefFilePath(targetDir);
  if (!fs.existsSync(filePath)) {
    return {
      version: 2,
      projectName: path.basename(targetDir),
      sections: {},
      lastGenerated: null,
    };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    console.error(`Warning: Failed to parse ${filePath}, returning empty brief.`);
    return {
      version: 2,
      projectName: path.basename(targetDir),
      sections: {},
      lastGenerated: null,
    };
  }
}

/**
 * Writes data to brief.json inside .project-memory.
 *
 * @param {string} targetDir
 * @param {object} briefData
 */
export function writeBrief(targetDir, briefData) {
  ensureMemoryDir(targetDir);
  const filePath = getBriefFilePath(targetDir);
  const payload = {
    ...briefData,
    lastGenerated: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

/**
 * Extracts the first paragraph of README.md as a project purpose statement.
 *
 * @param {string} targetDir
 * @returns {string|null}
 */
function extractReadmePurpose(targetDir) {
  const candidates = ['README.md', 'readme.md', 'README'];
  for (const name of candidates) {
    const readmePath = path.join(targetDir, name);
    if (fs.existsSync(readmePath)) {
      try {
        const content = fs.readFileSync(readmePath, 'utf-8');
        const lines = content.split('\n');
        const paragraphLines = [];
        let pastHeader = false;

        for (const line of lines) {
          // Skip leading headers, badges, blank lines
          if (!pastHeader) {
            if (line.startsWith('#') || line.trim() === '' || line.startsWith('![') || line.startsWith('[![')) {
              continue;
            }
            pastHeader = true;
          }

          if (pastHeader) {
            if (line.trim() === '' && paragraphLines.length > 0) break;
            if (line.startsWith('#')) break;
            paragraphLines.push(line.trim());
          }
        }

        return paragraphLines.length > 0 ? paragraphLines.join(' ') : null;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Determines the 3 prioritized next actions based on session data and feature ledger.
 *
 * Priority rules:
 * 1. Developer's own recorded "next step" and unfinished work from last session (if still relevant)
 * 2. Incomplete features with placeholder/TODO evidence
 * 3. Features changed recently that are unverified (suggest writing/running a test)
 * 4. Unknown features needing review
 *
 * @param {object} lastSession
 * @param {Array<object>} features
 * @returns {Array<{ action: string, reason: string, evidence_links: string[] }>}
 */
function computeNextActions(lastSession, features) {
  const actions = [];

  // Priority 1: Developer's own next step from last session
  if (lastSession) {
    if (lastSession.next_actions && lastSession.next_actions.trim()) {
      actions.push({
        action: lastSession.next_actions,
        reason: 'Developer\'s own recorded next step from last session',
        evidence_links: [`sessions.json → session ${lastSession.id}`],
      });
    }

    if (lastSession.unfinished && lastSession.unfinished.trim()) {
      actions.push({
        action: `Complete unfinished work: ${lastSession.unfinished}`,
        reason: 'Unfinished work from last session',
        evidence_links: [`sessions.json → session ${lastSession.id}`],
      });
    }
  }

  // Priority 2: Incomplete features with placeholder/TODO evidence
  const incomplete = features.filter(
    (f) => f.implementation_status === 'incomplete'
  );
  for (const feat of incomplete) {
    if (actions.length >= 3) break;
    const todoEvidence = feat.evidence.filter(
      (e) => e.type === 'todo' || e.type === 'placeholder'
    );
    const links = todoEvidence.map((e) => `${e.path}:${e.line}`);
    actions.push({
      action: `Fix incomplete feature: ${feat.name}`,
      reason: feat.reason || `Has ${todoEvidence.length} TODO/placeholder marker(s)`,
      evidence_links: links.length > 0 ? links : [feat.evidence[0]?.path || feat.id],
    });
  }

  // Priority 3: Features changed recently that are unverified
  const staleUnverified = features.filter(
    (f) =>
      f.stale_evidence &&
      f.verification_status === 'unverified' &&
      f.implementation_status !== 'incomplete'
  );
  for (const feat of staleUnverified) {
    if (actions.length >= 3) break;
    actions.push({
      action: `Write or run tests for recently changed feature: ${feat.name}`,
      reason: 'Feature was modified since last analysis and has no verified test',
      evidence_links: feat.evidence.slice(0, 2).map((e) => e.path || feat.id),
    });
  }

  // Priority 4: Unknown features needing review
  const unknowns = features.filter(
    (f) => f.implementation_status === 'unknown' || f.needs_review
  );
  for (const feat of unknowns) {
    if (actions.length >= 3) break;
    actions.push({
      action: `Review and classify: ${feat.name}`,
      reason: 'Feature status is unknown and needs manual review',
      evidence_links: feat.evidence.slice(0, 2).map((e) => e.path || feat.id),
    });
  }

  return actions.slice(0, 3);
}

/**
 * Generates and saves a consolidated project brief answering 5 structured questions.
 *
 * 1. What is this project?
 * 2. What state is it in?
 * 3. What happened last session?
 * 4. What is unfinished or uncertain?
 * 5. What should I do first?
 *
 * Also includes "questions you must answer before coding" from blockers/open questions.
 *
 * @param {string} targetDir
 * @returns {object} brief object
 */
export function generateBrief(targetDir) {
  const scanResult = scanRepository(targetDir);
  const gitInfo = getGitSummary(targetDir);
  const ledger = readLedger(targetDir);
  const sessionsStore = readSessions(targetDir);

  const features = ledger.features || [];
  const sessions = sessionsStore.sessions || [];
  const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

  const projectName = path.basename(targetDir);
  const purpose = extractReadmePurpose(targetDir);

  // --- Section 1: What is this project? ---
  const stackNames = (scanResult.stack || []).map((s) => s.name);
  const setupScripts = scanResult.setup_instructions?.scripts || {};
  const setupCommands = Object.entries(setupScripts)
    .filter(([key]) => ['dev', 'start', 'build', 'install', 'setup'].includes(key))
    .map(([key, val]) => `npm run ${key} → ${val}`);

  const section1 = {
    project_name: projectName,
    purpose: purpose || '(No README first paragraph found)',
    stack: stackNames,
    setup_commands: setupCommands,
    readme_setup: scanResult.setup_instructions?.readme_setup || null,
  };

  // --- Section 2: What state is it in? ---
  const implemented = features.filter((f) => f.implementation_status === 'implemented').length;
  const incomplete = features.filter((f) => f.implementation_status === 'incomplete').length;
  const planned = features.filter((f) => f.implementation_status === 'planned').length;
  const unknown = features.filter((f) => f.implementation_status === 'unknown').length;
  const unverified = features.filter((f) => f.verification_status === 'unverified').length;
  const needsReview = features.filter((f) => f.needs_review).length;

  const section2 = {
    counts: {
      total: features.length,
      implemented,
      incomplete,
      planned,
      unknown,
      unverified,
      needs_review: needsReview,
    },
    analyzed_commit: ledger.last_analyzed_commit || gitInfo.commit_sha || null,
    dirty_tree: gitInfo.is_dirty,
    uncommitted_files: gitInfo.uncommitted_files?.length || 0,
  };

  // --- Section 3: What happened last session? ---
  let section3 = null;
  if (lastSession) {
    section3 = {
      session_id: lastSession.id,
      date: lastSession.started_at || lastSession.timestamp,
      completed_work: lastSession.completed_work || lastSession.goal || '',
      decisions: lastSession.decisions || [],
      blockers: lastSession.blockers || '',
      commits_since: lastSession.commits_in_session?.length || 0,
      changed_files: lastSession.changed_files?.length || 0,
    };
  }

  // --- Section 4: What is unfinished or uncertain? ---
  const incompleteFeatures = features
    .filter((f) => f.implementation_status === 'incomplete')
    .map((f) => ({
      id: f.id,
      name: f.name,
      reason: f.reason,
      evidence: f.evidence.filter((e) => e.type === 'todo' || e.type === 'placeholder'),
    }));

  const todosFromScan = (scanResult.code_annotations?.items || []).slice(0, 10);

  const staleFeatures = features
    .filter((f) => f.stale_evidence)
    .map((f) => ({ id: f.id, name: f.name, reason: f.reason }));

  const section4 = {
    incomplete_features: incompleteFeatures,
    todos: todosFromScan,
    stale_evidence: staleFeatures,
  };

  // --- Section 5: What should I do first? ---
  const nextActions = computeNextActions(lastSession, features);

  // --- Questions you must answer before coding ---
  const mustAnswerQuestions = [];
  if (lastSession?.blockers) {
    mustAnswerQuestions.push(`Blocker from last session: ${lastSession.blockers}`);
  }
  if (lastSession?.open_questions) {
    mustAnswerQuestions.push(`Open question: ${lastSession.open_questions}`);
  }
  if (section2.dirty_tree) {
    mustAnswerQuestions.push(
      `Working tree is dirty with ${section2.uncommitted_files} uncommitted file(s). Commit or stash before starting?`
    );
  }

  // --- Compose brief ---
  const brief = {
    version: 2,
    projectName,
    repositoryPath: targetDir,
    // Backwards-compatible flat fields
    git: {
      isGit: gitInfo.isGit ?? gitInfo.is_git,
      branch: gitInfo.branch,
      clean: !gitInfo.is_dirty,
      pendingChanges: gitInfo.uncommitted_files?.length || 0,
      latestCommit: gitInfo.recentCommits?.[0] || gitInfo.recent_commits?.[0] || null,
    },
    codebase: {
      totalFiles: scanResult.stats.totalFiles,
      totalSizeBytes: scanResult.stats.totalSizeBytes,
      topExtensions: Object.entries(scanResult.stats?.extensions || scanResult.languages?.by_extension || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .reduce((acc, [ext, count]) => ({ ...acc, [ext]: count }), {}),
    },
    features: {
      total: features.length,
      planned,
      inProgress: incomplete,
      completed: implemented,
    },
    recentSessions: sessions.slice(-3).reverse(),
    // The 5 structured sections
    sections: {
      what_is_this_project: section1,
      what_state_is_it_in: section2,
      what_happened_last_session: section3,
      what_is_unfinished: section4,
      what_should_i_do_first: nextActions,
    },
    must_answer_questions: mustAnswerQuestions,
  };

  writeBrief(targetDir, brief);
  return brief;
}

// "Resume brief" aliases in code as specified by naming rules
export const generateResumeBrief = generateBrief;
export const readResumeBrief = readBrief;
export const writeResumeBrief = writeBrief;

