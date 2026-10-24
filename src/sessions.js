import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { ensureMemoryDir, getMemoryDirPath } from './features.js';
import {
  isGitRepo,
  getCurrentCommitSha,
  getWorkingTreeStatus,
  execGit,
} from './git.js';

export const SESSIONS_FILE_NAME = 'sessions.json';

/**
 * Returns the absolute path to sessions.json.
 *
 * @param {string} targetDir
 * @returns {string}
 */
export function getSessionsFilePath(targetDir) {
  return path.join(getMemoryDirPath(targetDir), SESSIONS_FILE_NAME);
}

/**
 * Reads sessions.json from target repository.
 *
 * @param {string} targetDir
 * @returns {{ version: number, sessions: Array<object>, lastUpdated: string }}
 */
export function readSessions(targetDir) {
  const filePath = getSessionsFilePath(targetDir);
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      sessions: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    console.error(`Warning: Failed to parse ${filePath}, returning empty sessions.`);
    return {
      version: 1,
      sessions: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Writes data to sessions.json inside .project-memory.
 *
 * @param {string} targetDir
 * @param {object} sessionsData
 */
export function writeSessions(targetDir, sessionsData) {
  ensureMemoryDir(targetDir);
  const filePath = getSessionsFilePath(targetDir);
  const payload = {
    ...sessionsData,
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

/**
 * Resolves the base commit for a new session.
 * Checks the last session's end_commit, then scan.json, then ledger.json.
 *
 * @param {string} targetDir
 * @returns {string|null}
 */
export function resolveBaseCommit(targetDir) {
  const sessionsStore = readSessions(targetDir);
  if (sessionsStore.sessions.length > 0) {
    const lastSession = sessionsStore.sessions[sessionsStore.sessions.length - 1];
    if (lastSession.end_commit) {
      return lastSession.end_commit;
    }
  }

  // Fallback to scan.json
  const scanFile = path.join(getMemoryDirPath(targetDir), 'scan.json');
  if (fs.existsSync(scanFile)) {
    try {
      const scanData = JSON.parse(fs.readFileSync(scanFile, 'utf-8'));
      if (scanData.commit_sha) return scanData.commit_sha;
    } catch {
      // Ignore
    }
  }

  // Fallback to ledger.json
  const ledgerFile = path.join(getMemoryDirPath(targetDir), 'ledger.json');
  if (fs.existsSync(ledgerFile)) {
    try {
      const ledgerData = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'));
      if (ledgerData.last_analyzed_commit) return ledgerData.last_analyzed_commit;
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * Parses git log output using ASCII control character delimiters.
 *
 * @param {string} rawLog
 * @returns {Array<{ sha: string, date: string, author: string, message: string, changed_files: string[] }>}
 */
function parseGitLogChunks(rawLog) {
  if (!rawLog) return [];
  const chunks = rawLog.split('\x1e').filter(Boolean);
  const commits = [];

  for (const chunk of chunks) {
    const lines = chunk.trim().split('\n');
    const header = lines[0] || '';
    const [sha, date, author, ...messageParts] = header.split('\x1f');
    if (!sha) continue;

    const changed_files = lines
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean);

    commits.push({
      sha,
      date: date || '',
      author: author || '',
      message: messageParts.join('\x1f') || '',
      changed_files,
    });
  }

  return commits;
}

/**
 * Collects Git commits and changed files between base_commit and end_commit.
 * Also includes any uncommitted working tree modifications.
 *
 * @param {string} targetDir
 * @param {string|null} baseCommit
 * @param {string|null} endCommit
 * @returns {{
 *   commits_in_session: Array<{ sha: string, date: string, author: string, message: string, changed_files: string[] }>,
 *   changed_files: string[]
 * }}
 */
export function getSessionGitContext(targetDir, baseCommit, endCommit) {
  if (!isGitRepo(targetDir)) {
    return {
      commits_in_session: [],
      changed_files: [],
    };
  }

  let commits_in_session = [];
  const changedFileSet = new Set();

  if (baseCommit && endCommit && baseCommit !== endCommit) {
    // Commits in range baseCommit..endCommit
    const rawCommits = execGit(
      [
        'log',
        `${baseCommit}..${endCommit}`,
        '--pretty=format:%x1e%H%x1f%aI%x1f%an%x1f%s',
        '--name-only',
      ],
      targetDir
    );
    if (rawCommits) {
      commits_in_session = parseGitLogChunks(rawCommits);
    }

    // Changed files between commits
    const diffRaw = execGit(['diff', '--name-only', baseCommit, endCommit], targetDir);
    if (diffRaw) {
      for (const line of diffRaw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) changedFileSet.add(trimmed.replace(/\\/g, '/'));
      }
    }
  } else if (endCommit) {
    // Only current commit
    const rawCommit = execGit(
      [
        'log',
        '-n',
        '1',
        '--pretty=format:%x1e%H%x1f%aI%x1f%an%x1f%s',
        '--name-only',
      ],
      targetDir
    );
    if (rawCommit) {
      commits_in_session = parseGitLogChunks(rawCommit);
      for (const c of commits_in_session) {
        for (const f of c.changed_files) changedFileSet.add(f.replace(/\\/g, '/'));
      }
    }
  }

  // Include uncommitted files in working tree
  const { uncommitted_files } = getWorkingTreeStatus(targetDir);
  for (const f of uncommitted_files) {
    changedFileSet.add(f.replace(/\\/g, '/'));
  }

  return {
    commits_in_session,
    changed_files: Array.from(changedFileSet).sort(),
  };
}

/**
 * Formats a draft check-in session summary for developer review.
 *
 * @param {object} draft
 * @returns {string}
 */
export function formatDraftSummary(draft) {
  const lines = [
    '============================================================',
    '                 SESSION CHECK-IN DRAFT                     ',
    '============================================================',
    ` Session ID:      ${draft.id}`,
    ` Started At:      ${draft.started_at}`,
    ` Base Commit:     ${draft.base_commit || 'None (first session)'}`,
    ` End Commit:      ${draft.end_commit || 'None (non-git repository)'}`,
    ` Commits:         ${draft.commits_in_session.length} commit(s) in session`,
  ];

  if (draft.commits_in_session.length > 0) {
    for (const c of draft.commits_in_session.slice(0, 3)) {
      lines.push(`   * [${c.sha.slice(0, 7)}] ${c.message}`);
    }
    if (draft.commits_in_session.length > 3) {
      lines.push(`   * ... and ${draft.commits_in_session.length - 3} more commit(s)`);
    }
  }

  lines.push(` Changed Files:   ${draft.changed_files.length} file(s)`);
  if (draft.changed_files.length > 0) {
    for (const f of draft.changed_files.slice(0, 6)) {
      lines.push(`   * ${f}`);
    }
    if (draft.changed_files.length > 6) {
      lines.push(`   * ... and ${draft.changed_files.length - 6} more file(s)`);
    }
  }

  lines.push('');
  lines.push(` 1. Completed:    ${draft.completed_work || '(none)'}`);
  lines.push(` 2. Decisions:    ${draft.decisions.length} recorded`);
  for (const d of draft.decisions) {
    lines.push(`    - Decision:  ${d.decision}`);
    lines.push(`      Rationale: ${d.rationale || 'N/A'}`);
  }
  lines.push(` 3. Blockers:     ${draft.blockers || '(none)'}`);
  lines.push(` 4. Unfinished:   ${draft.unfinished || '(none)'}`);
  lines.push(` 5. Questions:    ${draft.open_questions || '(none)'}`);
  lines.push(` 6. Next Step:    ${draft.next_actions || '(none)'}`);
  lines.push('============================================================');
  return lines.join('\n');
}

/**
 * Appends a confirmed session record to .project-memory/sessions.json.
 *
 * @param {string} targetDir
 * @param {object} sessionRecord
 * @returns {object} saved record
 */
export function appendSession(targetDir, sessionRecord) {
  const store = readSessions(targetDir);
  store.sessions.push(sessionRecord);
  writeSessions(targetDir, store);
  return sessionRecord;
}

/**
 * Backwards compatible alias for recordSession.
 *
 * @param {string} targetDir
 * @param {object} entry
 * @returns {object}
 */
export function recordSession(targetDir, entry) {
  const started_at = new Date().toISOString();
  const base_commit = resolveBaseCommit(targetDir);
  const end_commit = getCurrentCommitSha(targetDir);
  const { commits_in_session, changed_files } = getSessionGitContext(
    targetDir,
    base_commit,
    end_commit
  );

  const session = {
    id: `sess-${Date.now()}`,
    started_at,
    ended_at: new Date().toISOString(),
    base_commit,
    end_commit,
    commits_in_session,
    changed_files,
    completed_work: entry.completed_work || entry.summary || entry.goal || '',
    decisions: entry.decisions || [],
    blockers: entry.blockers || '',
    unfinished: entry.unfinished || '',
    open_questions: entry.open_questions || '',
    next_actions: entry.next_actions || entry.nextSteps || '',
    developer_confirmed: true,
    // Backwards-compat fields
    timestamp: started_at,
    author: entry.author || process.env.USER || process.env.USERNAME || 'developer',
    goal: entry.goal || entry.completed_work || '',
    summary: entry.summary || entry.completed_work || '',
    nextSteps: entry.nextSteps || entry.next_actions || '',
  };

  return appendSession(targetDir, session);
}

/**
 * Interactive or non-interactive check-in flow.
 *
 * Interactive questions:
 * 1. What did you complete?
 * 2. Decisions made and why? (can add multiple, empty line to finish)
 * 3. Blockers or unresolved problems?
 * 4. What did you start but not finish?
 * 5. Open questions or assumptions to confirm?
 * 6. What is the very next step?
 *
 * Then shows draft summary and asks developer to confirm before saving.
 * Never saves AI-generated assumptions as confirmed intent.
 *
 * @param {string} targetDir
 * @param {object} [options]
 * @param {object} [io] - Custom streams for testing
 * @returns {Promise<object|null>}
 */
export async function promptCheckin(targetDir, options = {}, io = {}) {
  const started_at = new Date().toISOString();
  const input = io.input || defaultInput;
  const output = io.output || defaultOutput;

  const base_commit = resolveBaseCommit(targetDir);
  const end_commit = getCurrentCommitSha(targetDir);
  const { commits_in_session, changed_files } = getSessionGitContext(
    targetDir,
    base_commit,
    end_commit
  );

  const isNonInteractive =
    options.completed !== undefined ||
    options.next !== undefined ||
    options.blockers !== undefined ||
    options.yes === true ||
    options.y === true;

  let completed_work = '';
  const decisions = [];
  let blockers = '';
  let unfinished = '';
  let open_questions = '';
  let next_actions = '';
  let confirmed = false;

  let rl = null;

  try {
    if (isNonInteractive) {
      // Non-interactive scripted mode via flags
      completed_work = options.completed || '';
      blockers = options.blockers || '';
      unfinished = options.unfinished || '';
      open_questions = options.questions || options['open-questions'] || '';
      next_actions = options.next || options['next-actions'] || '';

      // Parse decisions from options
      if (options.decision) {
        const decisionList = Array.isArray(options.decision)
          ? options.decision
          : [options.decision];
        const rationaleList = Array.isArray(options.rationale)
          ? options.rationale
          : [options.rationale || ''];

        for (let i = 0; i < decisionList.length; i++) {
          decisions.push({
            decision: decisionList[i],
            rationale: rationaleList[i] || '',
          });
        }
      }
    } else {
      // Interactive readline prompt
      rl = readline.createInterface({
        input,
        output,
        crlfDelay: Infinity,
      });

      output.write('\n=== Project Memory Work Session Check-in ===\n');

      // Question 1
      completed_work = (
        await rl.question('1. What did you complete?\n> ')
      ).trim();

      // Question 2 (multiple entries)
      output.write(
        '\n2. Decisions made and why? (can add multiple, empty line to finish)\n'
      );
      while (true) {
        const dec = (
          await rl.question('   Decision (or press Enter to finish): ')
        ).trim();
        if (!dec) break;

        const rat = (await rl.question('   Rationale / why: ')).trim();
        decisions.push({ decision: dec, rationale: rat });
      }

      // Question 3
      blockers = (
        await rl.question('\n3. Blockers or unresolved problems?\n> ')
      ).trim();

      // Question 4
      unfinished = (
        await rl.question('\n4. What did you start but not finish?\n> ')
      ).trim();

      // Question 5
      open_questions = (
        await rl.question('\n5. Open questions or assumptions to confirm?\n> ')
      ).trim();

      // Question 6
      next_actions = (
        await rl.question('\n6. What is the very next step?\n> ')
      ).trim();
    }

    // Construct draft record
    const draftRecord = {
      id: `sess-${Date.now()}`,
      started_at,
      ended_at: new Date().toISOString(),
      base_commit,
      end_commit,
      commits_in_session,
      changed_files,
      completed_work,
      decisions,
      blockers,
      unfinished,
      open_questions,
      next_actions,
      developer_confirmed: false,
      // Backwards-compatible aliases
      timestamp: started_at,
      author: process.env.USER || process.env.USERNAME || 'developer',
      goal: completed_work,
      summary: completed_work,
      nextSteps: next_actions,
    };

    // Display draft summary before saving
    output.write('\n' + formatDraftSummary(draftRecord) + '\n');

    // Confirmation handling
    if (options.yes === true || options.y === true) {
      confirmed = true;
    } else {
      if (!rl) {
        rl = readline.createInterface({
          input,
          output,
          crlfDelay: Infinity,
        });
      }
      const answer = (
        await rl.question(
          '\nConfirm and save this session to project memory? (Y/n): '
        )
      )
        .trim()
        .toLowerCase();
      confirmed = answer === 'y' || answer === 'yes' || answer === '';
    }

    if (confirmed) {
      draftRecord.developer_confirmed = true;
      draftRecord.ended_at = new Date().toISOString();
      appendSession(targetDir, draftRecord);
      output.write(
        `\nSession [${draftRecord.id}] confirmed and appended to .threadback/sessions.json\n`
      );
      return draftRecord;
    } else {
      output.write('\nCheck-in cancelled by developer. Session not saved.\n');
      return null;
    }
  } finally {
    if (rl) {
      rl.close();
    }
  }
}
