import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import {
  isGitRepo,
  getCurrentCommitSha,
  getCurrentBranch,
  getWorkingTreeStatus,
  getRecentCommits,
  getGitSummary,
} from '../src/git.js';

test('git.js degrades gracefully when target folder is not a git repo', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-nongit-'));

  try {
    assert.strictEqual(isGitRepo(tmpDir), false);
    assert.strictEqual(getCurrentCommitSha(tmpDir), null);
    assert.strictEqual(getCurrentBranch(tmpDir), null);

    const status = getWorkingTreeStatus(tmpDir);
    assert.strictEqual(status.is_dirty, false);
    assert.deepStrictEqual(status.uncommitted_files, []);

    const commits = getRecentCommits(tmpDir, 30);
    assert.deepStrictEqual(commits, []);

    const summary = getGitSummary(tmpDir);
    assert.strictEqual(summary.is_git, false);
    assert.strictEqual(summary.commit_sha, null);
    assert.strictEqual(summary.branch, null);
    assert.strictEqual(summary.is_dirty, false);
    assert.deepStrictEqual(summary.uncommitted_files, []);
    assert.deepStrictEqual(summary.recent_commits, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('git.js extracts commit SHA, branch, dirty status, and commits with changed files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-git-test-'));

  try {
    // Initialize git repository safely using execFileSync
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Dev User'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: tmpDir });

    assert.strictEqual(isGitRepo(tmpDir), true);

    // Initial commit
    fs.writeFileSync(path.join(tmpDir, 'fileA.js'), 'console.log("A");');
    execFileSync('git', ['add', 'fileA.js'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'Initial commit for fileA'], { cwd: tmpDir });

    const sha1 = getCurrentCommitSha(tmpDir);
    assert.ok(sha1);
    assert.strictEqual(sha1.length, 40);

    const branch = getCurrentBranch(tmpDir);
    assert.strictEqual(branch, 'main');

    // Second commit with multiple files
    fs.writeFileSync(path.join(tmpDir, 'fileB.js'), 'console.log("B");');
    fs.writeFileSync(path.join(tmpDir, 'fileA.js'), 'console.log("A updated");');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'Feature: added fileB and updated fileA'], { cwd: tmpDir });

    const sha2 = getCurrentCommitSha(tmpDir);
    assert.notStrictEqual(sha1, sha2);

    // Verify recent commits
    const commits = getRecentCommits(tmpDir, 30);
    assert.strictEqual(commits.length, 2);
    assert.strictEqual(commits[0].sha, sha2);
    assert.strictEqual(commits[0].author, 'Dev User');
    assert.strictEqual(commits[0].message, 'Feature: added fileB and updated fileA');
    assert.ok(commits[0].changed_files.includes('fileA.js'));
    assert.ok(commits[0].changed_files.includes('fileB.js'));

    // Check dirty state
    fs.writeFileSync(path.join(tmpDir, 'untracked.txt'), 'new content');
    const dirtyStatus = getWorkingTreeStatus(tmpDir);
    assert.strictEqual(dirtyStatus.is_dirty, true);
    assert.ok(dirtyStatus.uncommitted_files.includes('untracked.txt'));

    // Verify comprehensive getGitSummary
    const summary = getGitSummary(tmpDir);
    assert.strictEqual(summary.is_git, true);
    assert.strictEqual(summary.commit_sha, sha2);
    assert.strictEqual(summary.branch, 'main');
    assert.strictEqual(summary.is_dirty, true);
    assert.ok(summary.uncommitted_files.includes('untracked.txt'));
    assert.strictEqual(summary.recent_commits.length, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
