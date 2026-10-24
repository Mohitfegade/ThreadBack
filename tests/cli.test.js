import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const CLI_PATH = path.resolve('bin/pm.js');

test('CLI prints help when invoked without arguments or with --help', () => {
  const outputNoArgs = execSync(`node "${CLI_PATH}"`, { encoding: 'utf-8' });
  assert.ok(outputNoArgs.includes('USAGE:'));
  assert.ok(outputNoArgs.includes('COMMANDS:'));
  assert.ok(outputNoArgs.includes('scan'));
  assert.ok(outputNoArgs.includes('checkin'));
  assert.ok(outputNoArgs.includes('brief'));
  assert.ok(outputNoArgs.includes('status'));

  const outputHelp = execSync(`node "${CLI_PATH}" --help`, { encoding: 'utf-8' });
  assert.ok(outputHelp.includes('USAGE:'));
});

test('CLI runs scan on a specified repository path', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cli-'));

  try {
    fs.writeFileSync(path.join(tmpDir, 'test.js'), 'console.log(1);');

    const output = execSync(`node "${CLI_PATH}" scan "${tmpDir}"`, { encoding: 'utf-8' });
    assert.ok(output.includes('Project Memory Scan Report'));
    assert.ok(output.includes('Scanned Files:      1'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI brief command generates brief.json inside .project-memory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-brief-'));

  try {
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'console.log("running");');

    const output = execSync(`node "${CLI_PATH}" brief "${tmpDir}"`, { encoding: 'utf-8' });
    assert.ok(output.includes('Brief generated and saved to .project-memory/brief.json'));

    const briefPath = path.join(tmpDir, '.project-memory', 'brief.json');
    assert.ok(fs.existsSync(briefPath));

    const briefData = JSON.parse(fs.readFileSync(briefPath, 'utf-8'));
    assert.strictEqual(briefData.codebase.totalFiles, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI status command creates STATUS.md and prints dashboard', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-status-'));

  try {
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const a = 1;');

    const output = execSync(`node "${CLI_PATH}" status "${tmpDir}"`, { encoding: 'utf-8' });
    assert.ok(output.includes('Project Memory Status:'));
    assert.ok(output.includes('STATUS.md'));

    const statusFilePath = path.join(tmpDir, 'STATUS.md');
    assert.ok(fs.existsSync(statusFilePath));

    const content = fs.readFileSync(statusFilePath, 'utf-8');
    assert.ok(content.includes('# Project Status:'));
    assert.ok(content.includes('## Overview'));
    assert.ok(content.includes('## Feature Ledger'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
