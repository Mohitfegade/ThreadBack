import fs from 'node:fs';
import path from 'node:path';

export const STATUS_FILE_NAME = 'STATUS.md';

// ── ANSI color helpers ──────────────────────────────────────────────────────
const USE_COLOR = process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;

const c = {
  reset: USE_COLOR ? '\x1b[0m' : '',
  bold: USE_COLOR ? '\x1b[1m' : '',
  dim: USE_COLOR ? '\x1b[2m' : '',
  underline: USE_COLOR ? '\x1b[4m' : '',
  // Foreground
  red: USE_COLOR ? '\x1b[31m' : '',
  green: USE_COLOR ? '\x1b[32m' : '',
  yellow: USE_COLOR ? '\x1b[33m' : '',
  blue: USE_COLOR ? '\x1b[34m' : '',
  magenta: USE_COLOR ? '\x1b[35m' : '',
  cyan: USE_COLOR ? '\x1b[36m' : '',
  white: USE_COLOR ? '\x1b[37m' : '',
  // Bright
  brightRed: USE_COLOR ? '\x1b[91m' : '',
  brightGreen: USE_COLOR ? '\x1b[92m' : '',
  brightYellow: USE_COLOR ? '\x1b[93m' : '',
  brightBlue: USE_COLOR ? '\x1b[94m' : '',
  brightMagenta: USE_COLOR ? '\x1b[95m' : '',
  brightCyan: USE_COLOR ? '\x1b[96m' : '',
  // Background
  bgBlue: USE_COLOR ? '\x1b[44m' : '',
  bgMagenta: USE_COLOR ? '\x1b[45m' : '',
  bgCyan: USE_COLOR ? '\x1b[46m' : '',
};

function statusColor(status) {
  switch (status) {
    case 'implemented': return c.green;
    case 'incomplete': return c.yellow;
    case 'planned': return c.blue;
    case 'unknown': return c.dim;
    default: return c.reset;
  }
}

function verificationBadge(status) {
  if (status === 'verified') return `${c.green}✓ verified${c.reset}`;
  return `${c.dim}○ unverified${c.reset}`;
}

function sectionHeader(title) {
  const line = '─'.repeat(60);
  return `\n${c.cyan}${line}${c.reset}\n${c.bold}${c.white}  ${title}${c.reset}\n${c.cyan}${line}${c.reset}`;
}

function banner(title) {
  const line = '═'.repeat(60);
  return `${c.brightCyan}${line}${c.reset}\n${c.bold}${c.brightCyan}  ${title}${c.reset}\n${c.brightCyan}${line}${c.reset}`;
}

/**
 * Returns formatted help text for CLI.
 *
 * @returns {string}
 */
export function renderHelp() {
  return `
${c.bold}${c.brightCyan}Project Memory${c.reset} ${c.dim}— Never lose your project context again.${c.reset}

${c.bold}USAGE:${c.reset}
  ${c.cyan}node bin/pm.js${c.reset} ${c.yellow}<command>${c.reset} [repo-path] [options]
  ${c.cyan}pm${c.reset} ${c.yellow}<command>${c.reset} [repo-path] [options]

${c.bold}COMMANDS:${c.reset}
  ${c.green}scan${c.reset}     [repo-path]  Walk and analyze codebase, tech stack, git state & TODOs
  ${c.green}checkin${c.reset}  [repo-path]  Interactive check-in to record a work session
  ${c.green}brief${c.reset}    [repo-path]  Generate structured project brief answering 5 key questions
  ${c.green}status${c.reset}   [repo-path]  Display project memory dashboard and generate STATUS.md
  ${c.green}demo${c.reset}                  Run the full flow against the bundled demo repository
  ${c.green}help${c.reset}                  Show this help guide

${c.bold}OPTIONS:${c.reset}
  ${c.dim}-h, --help${c.reset}           Show help information
  ${c.dim}-v, --version${c.reset}        Show version number
  ${c.dim}--json${c.reset}               Output as JSON to stdout

${c.bold}CHECKIN FLAGS${c.reset} ${c.dim}(non-interactive mode):${c.reset}
  ${c.dim}--completed${c.reset} "..."     What you completed
  ${c.dim}--next${c.reset} "..."          What is the very next step
  ${c.dim}--decision${c.reset} "..."      A decision made (repeatable)
  ${c.dim}--rationale${c.reset} "..."     Rationale for decision (repeatable)
  ${c.dim}--blockers${c.reset} "..."      Blockers or unresolved problems
  ${c.dim}--unfinished${c.reset} "..."    What you started but didn't finish
  ${c.dim}--questions${c.reset} "..."     Open questions or assumptions
  ${c.dim}-y${c.reset}                    Auto-confirm without prompting

${c.bold}RULES & PRIVACY:${c.reset}
  ${c.dim}•${c.reset} STRICTLY READ-ONLY with respect to user source code
  ${c.dim}•${c.reset} Only writes data inside ${c.yellow}.project-memory/${c.reset} and ${c.yellow}STATUS.md${c.reset}
  ${c.dim}•${c.reset} Automatically ignores: node_modules, .git, .next, dist, build, coverage,
    .env* (except .env.example), *.pem, *.key, lockfiles, and files >500KB
`;
}

/**
 * Formats full scan report into a concise human-readable terminal summary with ANSI colors.
 *
 * @param {object} scanReport
 * @returns {string}
 */
export function renderScanConsole(scanReport) {
  const {
    target_path,
    commit_sha,
    git,
    languages,
    stack,
    entry_points_and_configs,
    setup_instructions,
    tests,
    code_annotations,
    stats,
  } = scanReport;

  const lines = [
    banner('PROJECT MEMORY — SCAN REPORT'),
    `  ${c.dim}Target:${c.reset}   ${target_path}`,
    `  ${c.dim}Commit:${c.reset}   ${commit_sha ? `${c.yellow}${commit_sha.slice(0, 10)}${c.reset}` : `${c.dim}None (non-git)${c.reset}`}`,
    `  ${c.dim}Branch:${c.reset}   ${git.branch || 'N/A'} ${git.is_dirty ? `${c.brightRed}● dirty${c.reset}` : `${c.green}● clean${c.reset}`}`,
    `  ${c.dim}Files:${c.reset}    ${c.bold}${stats.total_files}${c.reset} (${(stats.total_size_bytes / 1024).toFixed(1)} KB)`,
  ];

  // Languages
  lines.push(sectionHeader('LANGUAGES'));
  const topLangs = Object.entries(languages.by_language || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (topLangs.length > 0) {
    const maxCount = topLangs[0][1];
    for (const [lang, count] of topLangs) {
      const barLen = Math.max(1, Math.round((count / maxCount) * 20));
      const bar = '█'.repeat(barLen);
      lines.push(`  ${c.cyan}${bar}${c.reset} ${lang.padEnd(22)} ${c.bold}${count}${c.reset} files`);
    }
  } else {
    lines.push(`  ${c.dim}No language files identified${c.reset}`);
  }

  // Stack
  lines.push(sectionHeader('DETECTED STACK'));
  if (stack && stack.length > 0) {
    for (const item of stack) {
      lines.push(`  ${c.green}▸${c.reset} ${c.bold}${item.name}${c.reset} ${c.dim}(${item.category})${c.reset} ${c.yellow}${item.package}@${item.version}${c.reset}`);
    }
  } else {
    lines.push(`  ${c.dim}No framework/library dependencies detected${c.reset}`);
  }

  // Entry Points & Configs
  lines.push(sectionHeader('ENTRY POINTS & CONFIGS'));
  if (entry_points_and_configs && entry_points_and_configs.length > 0) {
    for (const item of entry_points_and_configs) {
      const icon = item.type === 'config' ? `${c.yellow}⚙${c.reset}` : `${c.green}▶${c.reset}`;
      lines.push(`  ${icon} ${c.bold}${item.file.padEnd(26)}${c.reset} ${c.dim}${item.description}${c.reset}`);
    }
  } else {
    lines.push(`  ${c.dim}No standard entry points or configs identified${c.reset}`);
  }

  // Setup & Testing
  lines.push(sectionHeader('SETUP & TESTING'));
  lines.push(`  ${c.dim}Test Command:${c.reset}  ${setup_instructions.test_command || `${c.dim}None defined${c.reset}`}`);
  lines.push(`  ${c.dim}Test Files:${c.reset}    ${c.bold}${tests.count}${c.reset} detected`);
  if (tests.files.length > 0) {
    for (const tf of tests.files.slice(0, 4)) {
      lines.push(`    ${c.dim}•${c.reset} ${tf}`);
    }
    if (tests.files.length > 4) {
      lines.push(`    ${c.dim}... and ${tests.files.length - 4} more${c.reset}`);
    }
  }
  const scriptKeys = Object.keys(setup_instructions.scripts || {});
  if (scriptKeys.length > 0) {
    lines.push(`  ${c.dim}Scripts:${c.reset}       ${scriptKeys.map(k => `${c.cyan}${k}${c.reset}`).join(', ')}`);
  }

  // Code Annotations
  lines.push(sectionHeader('CODE ANNOTATIONS'));
  const tags = code_annotations.by_tag;
  const tagSummary = [
    tags.TODO > 0 ? `${c.yellow}TODO: ${tags.TODO}${c.reset}` : null,
    tags.FIXME > 0 ? `${c.brightRed}FIXME: ${tags.FIXME}${c.reset}` : null,
    tags.HACK > 0 ? `${c.magenta}HACK: ${tags.HACK}${c.reset}` : null,
    tags['not implemented'] > 0 ? `${c.red}Not Implemented: ${tags['not implemented']}${c.reset}` : null,
    tags['coming soon'] > 0 ? `${c.blue}Coming Soon: ${tags['coming soon']}${c.reset}` : null,
  ].filter(Boolean);
  lines.push(`  ${c.dim}Total:${c.reset} ${c.bold}${code_annotations.total}${c.reset}  ${tagSummary.join('  ')}`);

  if (code_annotations.items.length > 0) {
    for (const item of code_annotations.items.slice(0, 5)) {
      const tagColor = item.tag === 'TODO' ? c.yellow : item.tag === 'FIXME' ? c.brightRed : c.magenta;
      lines.push(`  ${tagColor}[${item.tag}]${c.reset} ${c.dim}${item.file}:${item.line}${c.reset} → ${item.text.slice(0, 70)}`);
    }
    if (code_annotations.items.length > 5) {
      lines.push(`  ${c.dim}... and ${code_annotations.items.length - 5} more annotations${c.reset}`);
    }
  }

  lines.push(`\n${c.brightCyan}${'═'.repeat(60)}${c.reset}`);
  return lines.join('\n');
}

/**
 * Formats the structured brief for console output with ANSI colors.
 *
 * @param {object} brief
 * @param {object} ledger
 * @returns {string}
 */
export function renderBriefConsole(brief, ledger) {
  const s = brief.sections || {};
  const lines = [
    banner(`PROJECT BRIEF — ${brief.projectName}`),
    `${c.dim}  Never lose your project context again.${c.reset}`,
  ];

  // Section 1: What is this project?
  lines.push(sectionHeader('1. WHAT IS THIS PROJECT?'));
  const s1 = s.what_is_this_project || {};
  lines.push(`  ${c.dim}Name:${c.reset}    ${c.bold}${s1.project_name || brief.projectName}${c.reset}`);
  lines.push(`  ${c.dim}Purpose:${c.reset} ${s1.purpose || '(unknown)'}`);
  if (s1.stack && s1.stack.length > 0) {
    lines.push(`  ${c.dim}Stack:${c.reset}   ${s1.stack.map(s => `${c.cyan}${s}${c.reset}`).join(', ')}`);
  }
  if (s1.setup_commands && s1.setup_commands.length > 0) {
    lines.push(`  ${c.dim}Setup:${c.reset}`);
    for (const cmd of s1.setup_commands) {
      lines.push(`    ${c.green}$${c.reset} ${cmd}`);
    }
  }

  // Section 2: What state is it in?
  lines.push(sectionHeader('2. WHAT STATE IS IT IN?'));
  const s2 = s.what_state_is_it_in || {};
  const counts = s2.counts || {};
  lines.push(
    `  ${c.green}● Implemented: ${counts.implemented || 0}${c.reset}  ` +
    `${c.yellow}◐ Incomplete: ${counts.incomplete || 0}${c.reset}  ` +
    `${c.blue}○ Planned: ${counts.planned || 0}${c.reset}  ` +
    `${c.dim}? Unknown: ${counts.unknown || 0}${c.reset}`
  );
  lines.push(
    `  ${c.dim}Unverified: ${counts.unverified || 0}  |  Needs Review: ${counts.needs_review || 0}${c.reset}`
  );
  lines.push(`  ${c.dim}Analyzed at:${c.reset} ${s2.analyzed_commit ? `${c.yellow}${String(s2.analyzed_commit).slice(0, 10)}${c.reset}` : 'N/A'}`);
  if (s2.dirty_tree) {
    lines.push(`  ${c.brightRed}⚠ Working tree is dirty (${s2.uncommitted_files} uncommitted file(s))${c.reset}`);
  }

  // Feature table
  if (ledger && ledger.features && ledger.features.length > 0) {
    lines.push('');
    const feats = ledger.features;
    lines.push(`  ${c.bold}Feature Ledger:${c.reset}`);
    for (const f of feats) {
      const sc = statusColor(f.implementation_status);
      const staleTag = f.stale_evidence ? ` ${c.brightRed}[STALE]${c.reset}` : '';
      lines.push(
        `  ${sc}${f.implementation_status.toUpperCase().padEnd(12)}${c.reset} ` +
        `${f.name.padEnd(30)} ` +
        `${verificationBadge(f.verification_status)}${staleTag}`
      );
    }
  }

  // Section 3: What happened last session?
  lines.push(sectionHeader('3. WHAT HAPPENED LAST SESSION?'));
  const s3 = s.what_happened_last_session;
  if (s3) {
    lines.push(`  ${c.dim}Date:${c.reset}      ${s3.date ? s3.date.slice(0, 19) : 'N/A'}`);
    lines.push(`  ${c.dim}Completed:${c.reset} ${s3.completed_work || '(nothing recorded)'}`);
    if (s3.decisions && s3.decisions.length > 0) {
      lines.push(`  ${c.dim}Decisions:${c.reset}`);
      for (const d of s3.decisions) {
        lines.push(`    ${c.magenta}→${c.reset} ${d.decision} ${c.dim}(${d.rationale || 'no rationale'})${c.reset}`);
      }
    }
    if (s3.blockers) {
      lines.push(`  ${c.brightRed}Blockers:${c.reset}  ${s3.blockers}`);
    }
    lines.push(`  ${c.dim}Commits:${c.reset}   ${s3.commits_since} commit(s), ${s3.changed_files} file(s) changed`);
  } else {
    lines.push(`  ${c.dim}No sessions recorded yet. Run ${c.cyan}pm checkin${c.dim} after a work session.${c.reset}`);
  }

  // Section 4: What is unfinished or uncertain?
  lines.push(sectionHeader('4. WHAT IS UNFINISHED OR UNCERTAIN?'));
  const s4 = s.what_is_unfinished || {};
  if (s4.incomplete_features && s4.incomplete_features.length > 0) {
    lines.push(`  ${c.yellow}Incomplete Features:${c.reset}`);
    for (const feat of s4.incomplete_features) {
      lines.push(`    ${c.yellow}▸${c.reset} ${c.bold}${feat.name}${c.reset}`);
      for (const ev of (feat.evidence || []).slice(0, 2)) {
        lines.push(`      ${c.dim}${ev.path}:${ev.line} — ${ev.description}${c.reset}`);
      }
    }
  }
  if (s4.stale_evidence && s4.stale_evidence.length > 0) {
    lines.push(`  ${c.brightRed}Stale Evidence (changed since last scan):${c.reset}`);
    for (const feat of s4.stale_evidence) {
      lines.push(`    ${c.brightRed}▸${c.reset} ${feat.name}`);
    }
  }
  if (s4.todos && s4.todos.length > 0) {
    lines.push(`  ${c.yellow}TODOs/FIXMEs:${c.reset}`);
    for (const td of s4.todos.slice(0, 5)) {
      const tagColor = td.tag === 'FIXME' ? c.brightRed : c.yellow;
      lines.push(`    ${tagColor}[${td.tag}]${c.reset} ${c.dim}${td.file}:${td.line}${c.reset} → ${td.text.slice(0, 60)}`);
    }
  }
  if (
    (!s4.incomplete_features || s4.incomplete_features.length === 0) &&
    (!s4.stale_evidence || s4.stale_evidence.length === 0) &&
    (!s4.todos || s4.todos.length === 0)
  ) {
    lines.push(`  ${c.green}✓ Nothing flagged as unfinished or uncertain.${c.reset}`);
  }

  // Section 5: What should I do first?
  lines.push(sectionHeader('5. WHAT SHOULD I DO FIRST?'));
  const nextActions = s.what_should_i_do_first || [];
  if (nextActions.length > 0) {
    for (let i = 0; i < nextActions.length; i++) {
      const a = nextActions[i];
      const num = `${c.bold}${c.brightCyan}${i + 1}.${c.reset}`;
      lines.push(`  ${num} ${c.bold}${a.action}${c.reset}`);
      lines.push(`     ${c.dim}Why: ${a.reason}${c.reset}`);
      if (a.evidence_links && a.evidence_links.length > 0) {
        lines.push(`     ${c.dim}See: ${a.evidence_links.join(', ')}${c.reset}`);
      }
    }
  } else {
    lines.push(`  ${c.green}✓ No prioritized actions — all features look good!${c.reset}`);
  }

  // Must-answer questions
  if (brief.must_answer_questions && brief.must_answer_questions.length > 0) {
    lines.push(sectionHeader('⚠ QUESTIONS YOU MUST ANSWER BEFORE CODING'));
    for (const q of brief.must_answer_questions) {
      lines.push(`  ${c.brightRed}?${c.reset} ${q}`);
    }
  }

  lines.push(`\n${c.brightCyan}${'═'.repeat(60)}${c.reset}`);
  return lines.join('\n');
}

/**
 * Formats dashboard status for console output with ANSI colors.
 *
 * @param {object} brief
 * @param {object} ledger
 * @returns {string}
 */
export function renderStatusConsole(brief, ledger) {
  return renderBriefConsole(brief, ledger);
}

/**
 * Renders STATUS.md markdown content.
 *
 * @param {object} brief
 * @param {object} ledger
 * @returns {string}
 */
export function renderStatusMarkdown(brief, ledger) {
  const now = new Date().toISOString();
  const topExts = Object.entries(brief.codebase?.topExtensions || {})
    .map(([ext, count]) => `- \`${ext}\`: ${count} files`)
    .join('\n');

  const featureRows = ledger.features.length
    ? ledger.features
        .map((f) => {
          const st = f.implementation_status || f.status || 'unknown';
          const ver = f.verification_status || 'unverified';
          const stale = f.stale_evidence ? ' ⚠️' : '';
          const dt = f.updatedAt ? f.updatedAt.slice(0, 10) : '-';
          return `| \`${f.id}\` | ${f.name} | **${st}** (${ver})${stale} | ${dt} |`;
        })
        .join('\n')
    : '| - | *No features tracked yet* | - | - |';

  const s = brief.sections || {};
  const s3 = s.what_happened_last_session;
  const sessionMd = s3
    ? `### Last Session (${s3.date ? s3.date.slice(0, 10) : 'N/A'})
- **Completed:** ${s3.completed_work || 'N/A'}
- **Commits:** ${s3.commits_since} commit(s), ${s3.changed_files} file(s) changed
${s3.blockers ? `- **Blockers:** ${s3.blockers}` : ''}
${(s3.decisions || []).map(d => `- **Decision:** ${d.decision} *(${d.rationale || 'N/A'})*`).join('\n')}
`
    : '*No recorded sessions yet. Run `pm checkin` to add one.*';

  const nextActionsMd = (s.what_should_i_do_first || [])
    .map((a, i) => `${i + 1}. **${a.action}**\n   - *Why:* ${a.reason}\n   - *See:* ${a.evidence_links?.join(', ') || 'N/A'}`)
    .join('\n');

  return `# Project Status: ${brief.projectName}

> *Generated automatically by \`project-memory\` on ${now}*
> *Never lose your project context again.*

## 1. What is this project?
- **Repository:** \`${brief.repositoryPath}\`
- **Purpose:** ${s.what_is_this_project?.purpose || 'N/A'}
- **Stack:** ${s.what_is_this_project?.stack?.join(', ') || 'N/A'}
- **Git Branch:** \`${brief.git.branch || 'non-git'}\` (${brief.git.clean ? 'clean working tree' : `${brief.git.pendingChanges} pending changes`})
- **Total Tracked Files:** ${brief.codebase?.totalFiles || 0} (${((brief.codebase?.totalSizeBytes || 0) / 1024).toFixed(1)} KB)

### File Composition
${topExts || '- No files detected'}

## 2. What state is it in?

| Status | Count |
|--------|-------|
| ✅ Implemented | ${s.what_state_is_it_in?.counts?.implemented || 0} |
| ⚠️ Incomplete | ${s.what_state_is_it_in?.counts?.incomplete || 0} |
| 📋 Planned | ${s.what_state_is_it_in?.counts?.planned || 0} |
| ❓ Unknown | ${s.what_state_is_it_in?.counts?.unknown || 0} |
| 🔍 Unverified | ${s.what_state_is_it_in?.counts?.unverified || 0} |

## Feature Ledger
| ID | Feature | Status | Last Updated |
|---|---|---|---|
${featureRows}

## 3. What happened last session?
${sessionMd}

## 4. What is unfinished or uncertain?
${(s.what_is_unfinished?.incomplete_features || []).map(f => `- **${f.name}**: ${f.reason || 'Incomplete'}`).join('\n') || '- Nothing flagged'}

## 5. What should I do first?
${nextActionsMd || '- All features look good!'}

${brief.must_answer_questions?.length > 0 ? `## ⚠️ Questions You Must Answer Before Coding\n${brief.must_answer_questions.map(q => `- ${q}`).join('\n')}` : ''}

---
*Note: \`project-memory\` operates in read-only mode on source code. It only manages \`.project-memory/\` and \`STATUS.md\`.*
`;
}

/**
 * Strictly writes STATUS.md inside the target repository.
 *
 * @param {string} targetDir
 * @param {string} markdownContent
 * @returns {string} filePath
 */
export function writeStatusFile(targetDir, markdownContent) {
  const filePath = path.join(targetDir, STATUS_FILE_NAME);
  fs.writeFileSync(filePath, markdownContent, 'utf-8');
  return filePath;
}
