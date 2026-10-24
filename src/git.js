import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Runs a git command safely using child_process.execFileSync with argument array.
 * Never uses string interpolation or shell commands.
 *
 * @param {string[]} args - Git arguments array
 * @param {string} cwd - Working directory
 * @returns {string|null} - Command stdout as trimmed string or null on failure
 */
export function execGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Checks if target directory is inside a Git working tree.
 * Accurately determines if target directory is a repository or part of one,
 * guarding against unwanted matches (e.g. dotfiles git in home directory).
 *
 * @param {string} targetDir
 * @returns {boolean}
 */
export function isGitRepo(targetDir) {
  if (fs.existsSync(path.join(targetDir, '.git'))) {
    return true;
  }

  const toplevel = execGit(['rev-parse', '--show-toplevel'], targetDir);
  if (!toplevel) return false;

  const resolvedTarget = path.resolve(targetDir);
  const resolvedTop = path.resolve(toplevel);

  if (resolvedTarget === resolvedTop) {
    return true;
  }

  // If top-level is user home directory but target is a subfolder, ignore user-home git repository
  if (resolvedTop === path.resolve(os.homedir()) && resolvedTarget !== resolvedTop) {
    return false;
  }

  // If targetDir is in os.tmpdir() but toplevel is outside tmpdir, ignore
  const resolvedTmp = path.resolve(os.tmpdir());
  if (resolvedTarget.startsWith(resolvedTmp) && !resolvedTop.startsWith(resolvedTmp)) {
    return false;
  }

  return true;
}

/**
 * Gets current commit SHA or null if not a git repo or no commits yet.
 *
 * @param {string} targetDir
 * @returns {string|null}
 */
export function getCurrentCommitSha(targetDir) {
  if (!isGitRepo(targetDir)) return null;
  return execGit(['rev-parse', 'HEAD'], targetDir) || null;
}

/**
 * Gets the current branch name, or null.
 *
 * @param {string} targetDir
 * @returns {string|null}
 */
export function getCurrentBranch(targetDir) {
  if (!isGitRepo(targetDir)) return null;
  const branch = execGit(['branch', '--show-current'], targetDir);
  if (branch) return branch;

  // Fallback for detached HEAD or older git versions
  const ref = execGit(['rev-parse', '--abbrev-ref', 'HEAD'], targetDir);
  return ref && ref !== 'HEAD' ? ref : (ref || null);
}

/**
 * Retrieves uncommitted working tree changes.
 *
 * @param {string} targetDir
 * @returns {{ is_dirty: boolean, uncommitted_files: string[] }}
 */
export function getWorkingTreeStatus(targetDir) {
  if (!isGitRepo(targetDir)) {
    return { is_dirty: false, uncommitted_files: [] };
  }
  const raw = execGit(['status', '--porcelain'], targetDir);
  if (!raw) {
    return { is_dirty: false, uncommitted_files: [] };
  }

  const uncommitted_files = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Porcelain lines start with 2 status chars and a space, e.g. " M path/to/file"
      return line.length > 3 ? line.slice(3).trim() : line;
    });

  return {
    is_dirty: uncommitted_files.length > 0,
    uncommitted_files,
  };
}

/**
 * Retrieves the last 30 commits with SHA, date, author, message, and changed files.
 *
 * @param {string} targetDir
 * @param {number} [limit=30]
 * @returns {Array<{ sha: string, date: string, author: string, message: string, changed_files: string[] }>}
 */
export function getRecentCommits(targetDir, limit = 30) {
  if (!isGitRepo(targetDir)) return [];
  // Use ASCII unit separator (0x1f) and record separator (0x1e) to ensure unambiguous parsing
  const raw = execGit(
    [
      'log',
      `-n`,
      String(limit),
      '--pretty=format:%x1e%H%x1f%aI%x1f%an%x1f%s',
      '--name-only',
    ],
    targetDir
  );

  if (!raw) return [];

  const chunks = raw.split('\x1e').filter(Boolean);
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
 * Collects full Git repository metadata. Degrades gracefully if not a Git repository.
 *
 * @param {string} targetDir
 * @returns {{
 *   is_git: boolean,
 *   isGit: boolean,
 *   commit_sha: string|null,
 *   branch: string|null,
 *   is_dirty: boolean,
 *   uncommitted_files: string[],
 *   status: { clean: boolean, files: string[] },
 *   recent_commits: Array<{ sha: string, date: string, author: string, message: string, changed_files: string[] }>,
 *   recentCommits: Array<{ sha: string, date: string, author: string, message: string, changed_files: string[] }>
 * }}
 */
export function getGitSummary(targetDir) {
  if (!isGitRepo(targetDir)) {
    return {
      is_git: false,
      isGit: false,
      commit_sha: null,
      branch: null,
      is_dirty: false,
      uncommitted_files: [],
      status: { clean: true, files: [] },
      recent_commits: [],
      recentCommits: [],
    };
  }

  const commit_sha = getCurrentCommitSha(targetDir);
  const branch = getCurrentBranch(targetDir);
  const { is_dirty, uncommitted_files } = getWorkingTreeStatus(targetDir);
  const recent_commits = getRecentCommits(targetDir, 30);

  return {
    is_git: true,
    isGit: true,
    commit_sha,
    branch,
    is_dirty,
    uncommitted_files,
    status: { clean: !is_dirty, files: uncommitted_files },
    recent_commits,
    recentCommits: recent_commits,
  };
}
