import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import {
  generateFeatureLedger,
  formatFeatureLedgerTable,
  inspectPlaceholderCode,
  categorizeRoute,
  checkRecordedTestRun,
} from '../src/features.js';
import { scanRepository } from '../src/scanner.js';
import { getGitSummary } from '../src/git.js';

test('categorizeRoute groups path segments into standardized areas and names', () => {
  const authRoute = categorizeRoute('/api/auth/callback/google');
  assert.strictEqual(authRoute.id, 'feat-auth');
  assert.strictEqual(authRoute.name, 'Authentication');
  assert.strictEqual(authRoute.area, 'auth');

  const usersRoute = categorizeRoute('/api/users/[id]');
  assert.strictEqual(usersRoute.id, 'feat-users');
  assert.strictEqual(usersRoute.name, 'User Management');
  assert.strictEqual(usersRoute.area, 'users');

  const paymentsRoute = categorizeRoute('/api/checkout');
  assert.strictEqual(paymentsRoute.id, 'feat-payments');
  assert.strictEqual(paymentsRoute.name, 'Payments & Billing');

  const homeRoute = categorizeRoute('/');
  assert.strictEqual(homeRoute.id, 'feat-home');
  assert.strictEqual(homeRoute.name, 'Home Page');
});

test('inspectPlaceholderCode detects 501, not implemented, and empty components', () => {
  const code501 = 'export async function GET() { return new Response("501", { status: 501 }); }';
  const result501 = inspectPlaceholderCode(code501);
  assert.ok(result501);
  assert.strictEqual(result501.isPlaceholder, true);

  const codeThrow = 'export default function handler() { throw new Error("not implemented yet"); }';
  const resultThrow = inspectPlaceholderCode(codeThrow);
  assert.ok(resultThrow);
  assert.strictEqual(resultThrow.isPlaceholder, true);

  const codeEmpty = 'export default function Page() { return null; }';
  const resultEmpty = inspectPlaceholderCode(codeEmpty);
  assert.ok(resultEmpty);
  assert.strictEqual(resultEmpty.isPlaceholder, true);

  const codeWorking = 'export default function Page() { return <div><h1>Active</h1></div>; }';
  assert.strictEqual(inspectPlaceholderCode(codeWorking), null);
});

test('generateFeatureLedger discovers features, applies deterministic status rules, and outputs exact schema', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ledger-engine-'));

  try {
    fs.mkdirSync(path.join(tmpDir, 'app', 'dashboard'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'app', 'api', 'auth', '[...nextauth]'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'app', 'api', 'placeholder'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'prisma'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });

    // 1. Working Dashboard page
    fs.writeFileSync(
      path.join(tmpDir, 'app', 'dashboard', 'page.tsx'),
      'export default function Dashboard() { return <main>Dashboard Panel</main>; }'
    );

    // 2. Auth route with a TODO
    fs.writeFileSync(
      path.join(tmpDir, 'app', 'api', 'auth', '[...nextauth]', 'route.ts'),
      '// TODO: Add refresh token rotation\nexport async function GET() { return Response.json({ ok: true }); }'
    );

    // 3. Placeholder route returning 501
    fs.writeFileSync(
      path.join(tmpDir, 'app', 'api', 'placeholder', 'route.ts'),
      'export async function GET() { return new Response("Not Implemented", { status: 501 }); }'
    );

    // 4. Prisma model
    fs.writeFileSync(
      path.join(tmpDir, 'prisma', 'schema.prisma'),
      'model User {\n  id Int @id\n  email String\n}\n\nmodel Order {\n  id Int @id\n}\n'
    );

    // 5. Test file targeting dashboard
    fs.writeFileSync(
      path.join(tmpDir, 'tests', 'dashboard.test.js'),
      'test("dashboard renders", () => {});'
    );

    // Run scanner & git
    const scanResult = scanRepository(tmpDir);
    const gitInfo = getGitSummary(tmpDir);
    const combinedScan = {
      ...scanResult,
      commit_sha: gitInfo.commit_sha,
    };

    // Generate ledger
    const features = generateFeatureLedger(tmpDir, combinedScan);

    assert.ok(Array.isArray(features));
    assert.ok(features.length >= 4);

    // Verify exact schema keys on every feature
    for (const f of features) {
      assert.ok('id' in f, 'Missing id');
      assert.ok('name' in f, 'Missing name');
      assert.ok('area' in f, 'Missing area');
      assert.ok(['implemented', 'incomplete', 'planned', 'unknown'].includes(f.implementation_status));
      assert.ok(['verified', 'unverified', 'unknown'].includes(f.verification_status));
      assert.ok(Array.isArray(f.evidence));
      assert.ok('last_analyzed_commit' in f);
      assert.ok(['high', 'medium', 'low'].includes(f.confidence));
      assert.strictEqual(typeof f.needs_review, 'boolean');
      assert.strictEqual(typeof f.reason, 'string');

      // CRITICAL RULE: File existence is never proof of working. Never output "verified" without test result.
      assert.strictEqual(f.verification_status, 'unverified');
    }

    // Verify Dashboard is "implemented"
    const dashboard = features.find((f) => f.id === 'feat-dashboard');
    assert.ok(dashboard);
    assert.strictEqual(dashboard.implementation_status, 'implemented');

    // Verify Auth is "incomplete" due to TODO
    const auth = features.find((f) => f.id === 'feat-auth');
    assert.ok(auth);
    assert.strictEqual(auth.implementation_status, 'incomplete');
    assert.ok(auth.evidence.some((e) => e.type === 'todo'));

    // Verify Placeholder route is "incomplete" due to 501
    const placeholder = features.find((f) => f.id.includes('placeholder'));
    assert.ok(placeholder);
    assert.strictEqual(placeholder.implementation_status, 'incomplete');
    assert.ok(placeholder.evidence.some((e) => e.type === 'placeholder'));

    // Verify Prisma models are "planned"
    const orderModel = features.find((f) => f.id === 'model-order');
    assert.ok(orderModel);
    assert.strictEqual(orderModel.implementation_status, 'planned');

    // Verify terminal table formatting
    const table = formatFeatureLedgerTable(features);
    assert.ok(table.includes('FEATURE MEMORY LEDGER'));
    assert.ok(table.includes('feat-dashboard'));
    assert.ok(table.includes('IMPLEMENTED'));
    assert.ok(table.includes('INCOMPLETE'));

    // Verify file written to .project-memory/ledger.json
    const ledgerFile = path.join(tmpDir, '.project-memory', 'ledger.json');
    assert.ok(fs.existsSync(ledgerFile));
    const saved = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'));
    assert.strictEqual(saved.features.length, features.length);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generateFeatureLedger detects stale evidence when files changed between commits', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-stale-test-'));

  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });

    fs.mkdirSync(path.join(tmpDir, 'app', 'users'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app', 'users', 'page.tsx'), 'export default function Users() { return <div>Users</div>; }');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'Initial commit with users'], { cwd: tmpDir });

    const sha1 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();

    // First scan & ledger generation
    let scanResult = scanRepository(tmpDir);
    let gitInfo = getGitSummary(tmpDir);
    let features = generateFeatureLedger(tmpDir, { ...scanResult, commit_sha: sha1 });
    assert.strictEqual(features[0].stale_evidence, false);

    // Make changes to users page and commit
    fs.writeFileSync(path.join(tmpDir, 'app', 'users', 'page.tsx'), 'export default function Users() { return <div>Users Updated</div>; }');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'Updated users page'], { cwd: tmpDir });

    const sha2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();
    assert.notStrictEqual(sha1, sha2);

    // Second scan & ledger generation
    scanResult = scanRepository(tmpDir);
    gitInfo = getGitSummary(tmpDir);
    features = generateFeatureLedger(tmpDir, { ...scanResult, commit_sha: sha2 });

    const usersFeat = features.find((f) => f.id === 'feat-users');
    assert.ok(usersFeat);
    assert.strictEqual(usersFeat.stale_evidence, true);
    assert.ok(usersFeat.reason.includes('stale_evidence'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
