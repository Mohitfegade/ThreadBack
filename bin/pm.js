#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { scanRepository } from '../src/scanner.js';
import { getGitSummary } from '../src/git.js';
import {
  readLedger,
  writeLedger,
  ensureMemoryDir,
  getMemoryDirPath,
  generateFeatureLedger,
  formatFeatureLedgerTable,
} from '../src/features.js';
import { promptCheckin, readSessions } from '../src/sessions.js';
import { generateBrief, readBrief } from '../src/brief.js';
import {
  renderHelp,
  renderScanConsole,
  renderBriefConsole,
  renderStatusConsole,
  renderStatusMarkdown,
  writeStatusFile,
} from '../src/render.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json for version information
function getVersion() {
  try {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

/**
 * Parses CLI arguments into structured command, targetDir, flags, and options.
 *
 * @param {string[]} rawArgs
 * @returns {{
 *   command: string|null,
 *   targetDir: string,
 *   isHelp: boolean,
 *   isVersion: boolean,
 *   isJson: boolean,
 *   errors: string[]
 * }}
 */
function parseArgs(rawArgs) {
  const flags = new Set();
  const options = {};
  const positionals = [];

  function addOption(target, key, value) {
    if (target[key] !== undefined) {
      if (Array.isArray(target[key])) {
        target[key].push(value);
      } else {
        target[key] = [target[key], value];
      }
    } else {
      target[key] = value;
    }
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        addOption(options, key, val);
      } else {
        const key = arg.slice(2);
        const nextArg = rawArgs[i + 1];
        if (nextArg && !nextArg.startsWith('-')) {
          addOption(options, key, nextArg);
          i++;
        } else {
          addOption(options, key, true);
        }
      }
      flags.add(arg.split('=')[0]);
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      flags.add(arg);
      if (key === 'y') {
        options.yes = true;
        options.y = true;
      } else {
        const nextArg = rawArgs[i + 1];
        if (nextArg && !nextArg.startsWith('-')) {
          addOption(options, key, nextArg);
          i++;
        } else {
          addOption(options, key, true);
        }
      }
    } else {
      positionals.push(arg);
    }
  }

  const isHelp =
    flags.has('-h') ||
    flags.has('--help') ||
    positionals[0] === 'help';

  const isVersion =
    flags.has('-v') ||
    flags.has('--version') ||
    positionals[0] === 'version';

  const isJson = flags.has('--json') || Boolean(options.json);

  let command = null;
  let targetDir = process.cwd();

  if (positionals.length > 0 && positionals[0] !== 'help' && positionals[0] !== 'version') {
    command = positionals[0].toLowerCase();
    if (positionals.length > 1) {
      targetDir = path.resolve(positionals[1]);
    }
  }

  return {
    command,
    targetDir: path.resolve(targetDir),
    isHelp,
    isVersion,
    isJson,
    options,
    errors: [],
  };
}

/**
 * Validates that target directory exists and is a valid folder.
 *
 * @param {string} dir
 * @returns {boolean}
 */
function validateDirectory(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`Error: Target directory does not exist: "${dir}"`);
    return false;
  }
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    console.error(`Error: Target path is not a directory: "${dir}"`);
    return false;
  }
  return true;
}

/**
 * Compiles a single comprehensive scan JSON object combining repository walker and git analysis.
 *
 * @param {string} targetDir
 * @returns {object}
 */
export function buildScanReport(targetDir) {
  const scanResult = scanRepository(targetDir);
  const gitSummary = getGitSummary(targetDir);

  return {
    timestamp: new Date().toISOString(),
    target_path: targetDir,
    commit_sha: gitSummary.commit_sha, // exact commit SHA analyzed or null
    git: gitSummary,
    languages: scanResult.languages,
    stack: scanResult.stack,
    entry_points_and_configs: scanResult.entry_points_and_configs,
    setup_instructions: scanResult.setup_instructions,
    tests: scanResult.tests,
    code_annotations: scanResult.code_annotations,
    stats: {
      total_files: scanResult.stats.totalFiles,
      total_size_bytes: scanResult.stats.totalSizeBytes,
      ignored_counts: scanResult.ignoredCounts,
    },
    scannedFiles: scanResult.scannedFiles,
  };
}

/**
 * Runs the full demo flow against the bundled demo repository.
 *
 * @param {boolean} isJson
 */
async function runDemo(isJson) {
  const demoDir = path.resolve(__dirname, '../demo-repo');

  // Create the demo repo if it doesn't exist
  if (!fs.existsSync(demoDir)) {
    console.log('\n\x1b[36m▸ Creating demo repository...\x1b[0m');
    const setupScript = path.resolve(__dirname, '../scripts/setup-demo-repo.js');
    if (fs.existsSync(setupScript)) {
      execFileSync('node', [setupScript, demoDir], {
        stdio: 'inherit',
        windowsHide: true,
      });
    } else {
      console.error('Demo setup script not found. Run from project root.');
      process.exit(1);
    }
  }

  console.log('\n\x1b[1m\x1b[96m═══════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m\x1b[96m  PROJECT MEMORY DEMO\x1b[0m');
  console.log('\x1b[2m  Never lose your project context again.\x1b[0m');
  console.log('\x1b[1m\x1b[96m═══════════════════════════════════════════════════════════\x1b[0m');

  // Step 1: Scan
  console.log('\n\x1b[1m\x1b[33m▸ Step 1: Scanning repository...\x1b[0m\n');
  ensureMemoryDir(demoDir);
  const scanReport = buildScanReport(demoDir);
  const features = generateFeatureLedger(demoDir, scanReport);
  const scanFilePath = path.join(getMemoryDirPath(demoDir), 'scan.json');
  fs.writeFileSync(scanFilePath, JSON.stringify(scanReport, null, 2), 'utf-8');
  console.log(renderScanConsole(scanReport));
  console.log(formatFeatureLedgerTable(features));

  // Step 2: Check-in (non-interactive)
  console.log('\n\x1b[1m\x1b[33m▸ Step 2: Recording a work session check-in...\x1b[0m\n');
  await promptCheckin(demoDir, {
    completed: 'Set up auth, dashboard, and gift-page editor routes',
    decision: 'Used Next.js App Router for all routes',
    rationale: 'Better SEO and simpler file-based routing',
    blockers: 'Image upload handler is a stub',
    unfinished: 'Upload feature needs S3 integration',
    next: 'Implement the image upload handler with presigned URLs',
    yes: true,
  });

  // Step 3: Generate brief
  console.log('\n\x1b[1m\x1b[33m▸ Step 3: Generating project brief...\x1b[0m\n');
  const brief = generateBrief(demoDir);
  const ledger = readLedger(demoDir);
  console.log(renderBriefConsole(brief, ledger));

  // Step 4: Generate STATUS.md
  console.log('\n\x1b[1m\x1b[33m▸ Step 4: Writing STATUS.md...\x1b[0m\n');
  const markdown = renderStatusMarkdown(brief, ledger);
  const statusPath = writeStatusFile(demoDir, markdown);
  console.log(`\x1b[32m✓\x1b[0m STATUS.md written to: ${statusPath}`);

  console.log('\n\x1b[1m\x1b[96m═══════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m\x1b[96m  DEMO COMPLETE\x1b[0m');
  console.log('\x1b[2m  Data stored in: demo-repo/.project-memory/\x1b[0m');
  console.log('\x1b[1m\x1b[96m═══════════════════════════════════════════════════════════\x1b[0m\n');
}

/**
 * Main CLI entry point.
 */
async function main() {
  const rawArgs = process.argv.slice(2);
  const parsed = parseArgs(rawArgs);

  if (parsed.isVersion) {
    console.log(`project-memory v${getVersion()}`);
    process.exit(0);
  }

  if (parsed.isHelp || !parsed.command) {
    console.log(renderHelp());
    process.exit(0);
  }

  if (parsed.command === 'demo') {
    await runDemo(parsed.isJson);
    process.exit(0);
  }

  if (!validateDirectory(parsed.targetDir)) {
    process.exit(1);
  }

  // Ensure read-only safety: ensure .project-memory exists before writing internal state
  ensureMemoryDir(parsed.targetDir);

  switch (parsed.command) {
    case 'scan': {
      const scanReport = buildScanReport(parsed.targetDir);
      const features = generateFeatureLedger(parsed.targetDir, scanReport);

      // Persist scan.json inside .project-memory
      const scanFilePath = path.join(getMemoryDirPath(parsed.targetDir), 'scan.json');
      fs.writeFileSync(scanFilePath, JSON.stringify(scanReport, null, 2), 'utf-8');

      if (parsed.isJson) {
        console.log(JSON.stringify({ scan: scanReport, features }, null, 2));
      } else {
        console.log(renderScanConsole(scanReport));
        console.log(formatFeatureLedgerTable(features));
        console.log(`\x1b[32m✓\x1b[0m Scan saved to: .project-memory/scan.json`);
        console.log(`\x1b[32m✓\x1b[0m Ledger saved to: .project-memory/ledger.json`);
      }
      break;
    }

    case 'checkin': {
      try {
        const sessionRecord = await promptCheckin(parsed.targetDir, parsed.options);
        if (sessionRecord) {
          // Refresh project brief after recording check-in
          generateBrief(parsed.targetDir);
        }
      } catch (err) {
        console.error(`Error during check-in: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'brief': {
      const brief = generateBrief(parsed.targetDir);
      const ledger = readLedger(parsed.targetDir);
      if (parsed.isJson) {
        console.log(JSON.stringify(brief, null, 2));
      } else {
        console.log(renderBriefConsole(brief, ledger));
        console.log(`\n\x1b[32m✓\x1b[0m Brief saved to: .project-memory/brief.json`);
      }
      break;
    }

    case 'status': {
      const brief = generateBrief(parsed.targetDir);
      const ledger = readLedger(parsed.targetDir);
      const markdown = renderStatusMarkdown(brief, ledger);
      const statusFilePath = writeStatusFile(parsed.targetDir, markdown);

      if (parsed.isJson) {
        console.log(JSON.stringify({ brief, ledger, statusFile: statusFilePath }, null, 2));
      } else {
        console.log(renderStatusConsole(brief, ledger));
        console.log(`\n\x1b[32m✓\x1b[0m Updated status markdown: ${statusFilePath}`);
      }
      break;
    }

    default: {
      console.error(`Unknown command: "${parsed.command}"\n`);
      console.log(renderHelp());
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
