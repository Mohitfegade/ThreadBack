import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  isIgnoredDirectory,
  isIgnoredFile,
  isOverSizeLimit,
  detectStack,
  findEntryPointsAndConfigs,
  extractSetupInstructions,
  findTestFiles,
  scanFileAnnotations,
  scanRepository,
  MAX_FILE_SIZE_BYTES,
} from '../src/scanner.js';
import { readLedger, writeLedger, addFeature, updateFeatureStatus } from '../src/features.js';
import { readSessions, writeSessions, recordSession } from '../src/sessions.js';
import { generateBrief } from '../src/brief.js';
import { writeStatusFile } from '../src/render.js';

test('isIgnoredDirectory correctly identifies ignored directories', () => {
  const ignored = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.project-memory'];
  for (const dir of ignored) {
    assert.strictEqual(isIgnoredDirectory(dir), true, `Should ignore ${dir}`);
  }

  assert.strictEqual(isIgnoredDirectory('src'), false);
  assert.strictEqual(isIgnoredDirectory('components'), false);
});

test('isIgnoredFile correctly identifies env, pem, key, and lockfiles while preserving .env.example', () => {
  const sensitiveAndLocks = [
    '.env',
    '.env.local',
    '.env.production',
    'server.pem',
    'private.key',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    'Cargo.lock',
  ];

  for (const file of sensitiveAndLocks) {
    assert.strictEqual(isIgnoredFile(file), true, `Should ignore file ${file}`);
  }

  // Preserved templates
  assert.strictEqual(isIgnoredFile('.env.example'), false);
  assert.strictEqual(isIgnoredFile('.env.sample'), false);
  assert.strictEqual(isIgnoredFile('.env.template'), false);

  assert.strictEqual(isIgnoredFile('index.js'), false);
  assert.strictEqual(isIgnoredFile('README.md'), false);
});

test('isOverSizeLimit filters files above 500KB', () => {
  assert.strictEqual(isOverSizeLimit(500 * 1024), false);
  assert.strictEqual(isOverSizeLimit(500 * 1024 + 1), true);
  assert.strictEqual(isOverSizeLimit(100), false);
});

test('detectStack correctly identifies Next.js, React, Express, Tailwind, Prisma, Supabase, Drizzle', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-stack-'));

  try {
    const pkg = {
      name: 'sample-app',
      dependencies: {
        next: '^14.2.0',
        react: '^18.3.0',
        express: '^4.19.0',
        tailwindcss: '^3.4.0',
        prisma: '^5.14.0',
        '@supabase/supabase-js': '^2.43.0',
      },
      devDependencies: {
        'drizzle-orm': '^0.30.0',
        typescript: '^5.4.0',
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));

    const stack = detectStack(tmpDir);
    const names = stack.map((s) => s.name);

    assert.ok(names.includes('Next.js'));
    assert.ok(names.includes('React'));
    assert.ok(names.includes('Express'));
    assert.ok(names.includes('Tailwind CSS'));
    assert.ok(names.includes('Prisma'));
    assert.ok(names.includes('Supabase'));
    assert.ok(names.includes('Drizzle'));
    assert.ok(names.includes('TypeScript'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('findEntryPointsAndConfigs discovers configs and entry points', () => {
  const files = [
    { relativePath: 'package.json' },
    { relativePath: 'next.config.mjs' },
    { relativePath: 'tsconfig.json' },
    { relativePath: '.env.example' },
    { relativePath: 'Dockerfile' },
    { relativePath: 'bin/pm.js' },
    { relativePath: 'src/index.ts' },
  ];

  const found = findEntryPointsAndConfigs('/dummy', files);
  const fileNames = found.map((f) => f.file);

  assert.ok(fileNames.includes('package.json'));
  assert.ok(fileNames.includes('next.config.mjs'));
  assert.ok(fileNames.includes('tsconfig.json'));
  assert.ok(fileNames.includes('.env.example'));
  assert.ok(fileNames.includes('Dockerfile'));
  assert.ok(fileNames.includes('bin/pm.js'));
  assert.ok(fileNames.includes('src/index.ts'));
});

test('extractSetupInstructions captures scripts and README setup section', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-setup-'));

  try {
    const pkg = {
      scripts: {
        dev: 'node index.js',
        test: 'node --test',
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));

    const readme = `
# My App

## Setup
Run npm install then npm test.

## Features
- Fast
- Clean
`;
    fs.writeFileSync(path.join(tmpDir, 'README.md'), readme);

    const setup = extractSetupInstructions(tmpDir);
    assert.strictEqual(setup.test_command, 'node --test');
    assert.strictEqual(setup.scripts.dev, 'node index.js');
    assert.ok(setup.readme_setup.includes('Run npm install'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('findTestFiles detects test and spec files and __tests__ folders', () => {
  const files = [
    { relativePath: 'src/components/button.test.jsx' },
    { relativePath: 'src/utils/math.spec.ts' },
    { relativePath: 'src/__tests__/app.js' },
    { relativePath: 'tests/cli.test.js' },
    { relativePath: 'src/index.js' },
  ];

  const testInfo = findTestFiles(files, 'npm test');
  assert.strictEqual(testInfo.count, 4);
  assert.strictEqual(testInfo.test_command, 'npm test');
  assert.ok(testInfo.files.includes('src/components/button.test.jsx'));
  assert.ok(testInfo.files.includes('src/utils/math.spec.ts'));
  assert.ok(testInfo.files.includes('src/__tests__/app.js'));
  assert.ok(testInfo.files.includes('tests/cli.test.js'));
  assert.ok(!testInfo.files.includes('src/index.js'));
});

test('scanFileAnnotations locates TODO, FIXME, HACK, not implemented, coming soon', () => {
  const tmpFile = path.join(os.tmpdir(), `test-annotations-${Date.now()}.js`);

  try {
    const content = `
// Line 1: normal code
// TODO: refactor this method
const x = 1;
// FIXME: memory leak here
function foo() {
  // HACK: temporary workaround for bug #42
  throw new Error("not implemented yet");
}
/* Feature coming soon in v2 */
`;
    fs.writeFileSync(tmpFile, content);

    const annotations = scanFileAnnotations(tmpFile, 'test.js');
    assert.strictEqual(annotations.length, 5);

    const tags = annotations.map((a) => a.tag);
    assert.ok(tags.includes('TODO'));
    assert.ok(tags.includes('FIXME'));
    assert.ok(tags.includes('HACK'));
    assert.ok(tags.includes('not implemented'));
    assert.ok(tags.includes('coming soon'));

    const todo = annotations.find((a) => a.tag === 'TODO');
    assert.strictEqual(todo.line, 3);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('scanRepository full integration test', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-full-scan-'));

  try {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'full-scan-test',
        scripts: { test: 'node --test' },
        dependencies: { react: '^18.0.0', next: '^14.0.0' },
      })
    );

    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.env.example'), 'PORT=3000');
    fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM node:20');
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.js'), '// TODO: write logic\nconsole.log(1);');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'index.test.js'), 'test("ok", () => {});');

    const result = scanRepository(tmpDir);

    // Languages
    assert.ok(result.languages.by_extension['.js'] >= 2);
    assert.ok(result.languages.by_language['JavaScript'] >= 2);

    // Stack
    const stackNames = result.stack.map((s) => s.name);
    assert.ok(stackNames.includes('React'));
    assert.ok(stackNames.includes('Next.js'));

    // Configs
    const configFiles = result.entry_points_and_configs.map((c) => c.file);
    assert.ok(configFiles.includes('package.json'));
    assert.ok(configFiles.includes('tsconfig.json'));
    assert.ok(configFiles.includes('.env.example'));
    assert.ok(configFiles.includes('Dockerfile'));

    // Tests
    assert.strictEqual(result.tests.count, 1);
    assert.strictEqual(result.tests.test_command, 'node --test');

    // Annotations
    assert.strictEqual(result.code_annotations.total, 1);
    assert.strictEqual(result.code_annotations.by_tag.TODO, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
