import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';

import {
  readSessions,
  writeSessions,
  resolveBaseCommit,
  getSessionGitContext,
  formatDraftSummary,
  promptCheckin,
} from '../src/sessions.js';

test('resolveBaseCommit finds previous session end_commit or scan commit', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-base-commit-'));

  try {
    // 1. When empty, returns null
    assert.strictEqual(resolveBaseCommit(tmpDir), null);

    // 2. When previous session exists
    writeSessions(tmpDir, {
      sessions: [
        {
          id: 'sess-1',
          end_commit: 'commit-abc-123',
        },
      ],
    });

    assert.strictEqual(resolveBaseCommit(tmpDir), 'commit-abc-123');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getSessionGitContext auto-detects commits in session and changed files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-git-context-'));

  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });

    // Commit 1 (base)
    fs.writeFileSync(path.join(tmpDir, 'file1.js'), 'console.log("base");');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'Base commit'], { cwd: tmpDir });
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();

    // Commit 2 (session commit)
    fs.writeFileSync(path.join(tmpDir, 'file2.js'), 'console.log("added file2");');
    fs.writeFileSync(path.join(tmpDir, 'file1.js'), 'console.log("updated file1");');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'feat: update file1 and add file2'], { cwd: tmpDir });
    const endSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();

    // Uncommitted change in working tree
    fs.writeFileSync(path.join(tmpDir, 'draft.txt'), 'in progress notes');

    const context = getSessionGitContext(tmpDir, baseSha, endSha);

    // Verify commits in session
    assert.strictEqual(context.commits_in_session.length, 1);
    assert.strictEqual(context.commits_in_session[0].sha, endSha);
    assert.strictEqual(context.commits_in_session[0].message, 'feat: update file1 and add file2');

    // Verify changed files include committed + uncommitted
    assert.ok(context.changed_files.includes('file1.js'));
    assert.ok(context.changed_files.includes('file2.js'));
    assert.ok(context.changed_files.includes('draft.txt'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('promptCheckin in non-interactive scripted mode saves confirmed session record', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-scripted-checkin-'));

  try {
    let capturedOutput = '';
    const mockOutput = new Writable({
      write(chunk, encoding, callback) {
        capturedOutput += chunk.toString();
        callback();
      },
    });

    const options = {
      completed: 'Implemented authentication flow and sessions module',
      decision: ['Use native readline', 'Store in JSON format'],
      rationale: ['Zero external dependencies', 'Human-readable git-friendly memory'],
      blockers: 'None currently',
      unfinished: 'Integration with OAuth providers',
      questions: 'Should session length be tracked via wall-clock or timer?',
      next: 'Add brief synthesizer and status reports',
      yes: true, // Auto-confirm
    };

    const session = await promptCheckin(tmpDir, options, {
      output: mockOutput,
    });

    assert.ok(session);
    assert.ok(session.id.startsWith('sess-'));
    assert.ok(session.started_at);
    assert.ok(session.ended_at);
    assert.strictEqual(session.developer_confirmed, true);
    assert.strictEqual(session.completed_work, 'Implemented authentication flow and sessions module');
    assert.strictEqual(session.blockers, 'None currently');
    assert.strictEqual(session.unfinished, 'Integration with OAuth providers');
    assert.strictEqual(session.open_questions, 'Should session length be tracked via wall-clock or timer?');
    assert.strictEqual(session.next_actions, 'Add brief synthesizer and status reports');

    // Verify decisions
    assert.strictEqual(session.decisions.length, 2);
    assert.strictEqual(session.decisions[0].decision, 'Use native readline');
    assert.strictEqual(session.decisions[0].rationale, 'Zero external dependencies');

    // Verify draft summary was printed
    assert.ok(capturedOutput.includes('SESSION CHECK-IN DRAFT'));
    assert.ok(capturedOutput.includes('Implemented authentication flow'));

    // Verify appended to .project-memory/sessions.json
    const store = readSessions(tmpDir);
    assert.strictEqual(store.sessions.length, 1);
    assert.strictEqual(store.sessions[0].id, session.id);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('promptCheckin in interactive mode prompts 6 questions and handles confirm/cancel', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-interactive-checkin-'));

  try {
    // Simulate user answering 6 questions:
    // 1. completed
    // 2. decision 1, rationale 1, empty line to finish decisions
    // 3. blockers
    // 4. unfinished
    // 5. open questions
    // 6. next step
    // Confirm: y
    const answers = [
      'Finished testing features module',
      'Use deterministic status rules',
      'Avoid LLM hallucinations',
      '', // Finish decisions
      'Windows CRLF vs LF',
      'Documentation updates',
      'What CLI flags to add next?',
      'Implement brief module',
      'y', // Confirm
    ];

    async function* makeGenerator(lines) {
      for (const line of lines) {
        yield line + '\n';
      }
    }

    const mockInput = Readable.from(makeGenerator(answers));
    let capturedOutput = '';
    const mockOutput = new Writable({
      write(chunk, encoding, callback) {
        capturedOutput += chunk.toString();
        callback();
      },
    });

    const session = await promptCheckin(tmpDir, {}, {
      input: mockInput,
      output: mockOutput,
    });

    assert.ok(session);
    assert.strictEqual(session.developer_confirmed, true);
    assert.strictEqual(session.completed_work, 'Finished testing features module');
    assert.strictEqual(session.decisions.length, 1);
    assert.strictEqual(session.decisions[0].decision, 'Use deterministic status rules');
    assert.strictEqual(session.decisions[0].rationale, 'Avoid LLM hallucinations');
    assert.strictEqual(session.blockers, 'Windows CRLF vs LF');
    assert.strictEqual(session.unfinished, 'Documentation updates');
    assert.strictEqual(session.open_questions, 'What CLI flags to add next?');
    assert.strictEqual(session.next_actions, 'Implement brief module');

    // Test cancellation
    const cancelAnswers = [
      'WIP work',
      '', // no decisions
      '',
      '',
      '',
      '',
      'n', // Cancel!
    ];

    const cancelInput = Readable.from(makeGenerator(cancelAnswers));
    const cancelOutput = new Writable({ write(c, e, cb) { cb(); } });

    const cancelledSession = await promptCheckin(tmpDir, {}, {
      input: cancelInput,
      output: cancelOutput,
    });

    assert.strictEqual(cancelledSession, null);
    // Sessions count should still be 1 (the cancelled one was not saved)
    const store = readSessions(tmpDir);
    assert.strictEqual(store.sessions.length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
