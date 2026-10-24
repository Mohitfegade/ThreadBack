import fs from 'node:fs';
import path from 'node:path';

export const MAX_FILE_SIZE_BYTES = 500 * 1024; // 500KB

export const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.threadback',
  '.project-memory',
]);

export const KNOWN_LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'shrinkwrap.yaml',
]);

export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.mov', '.avi', '.webm', '.wav',
]);

export const EXTENSION_LANGUAGE_MAP = {
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.ts': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.py': 'Python',
  '.pyw': 'Python',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.go': 'Go',
  '.rs': 'Rust',
  '.c': 'C',
  '.h': 'C/C++ Header',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++ Header',
  '.cs': 'C#',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.json': 'JSON',
  '.json5': 'JSON5',
  '.jsonc': 'JSONC',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.md': 'Markdown',
  '.markdown': 'Markdown',
  '.mdx': 'MDX',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.astro': 'Astro',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.proto': 'Protocol Buffers',
  '.xml': 'XML',
  '.svg': 'SVG',
  '.toml': 'TOML',
};

const STACK_DEFINITIONS = [
  { name: 'Next.js', category: 'Framework', packages: ['next'] },
  { name: 'React', category: 'UI Library', packages: ['react', 'react-dom'] },
  { name: 'Express', category: 'Backend Framework', packages: ['express'] },
  { name: 'Tailwind CSS', category: 'Styling', packages: ['tailwindcss', '@tailwindcss/postcss', '@tailwindcss/typography', '@tailwindcss/forms'] },
  { name: 'Prisma', category: 'ORM / Database', packages: ['prisma', '@prisma/client'] },
  { name: 'Supabase', category: 'Backend / Database', packages: ['@supabase/supabase-js', '@supabase/ssr'] },
  { name: 'Drizzle', category: 'ORM / Database', packages: ['drizzle-orm', 'drizzle-kit'] },
  { name: 'Vue', category: 'UI Framework', packages: ['vue'] },
  { name: 'Nuxt', category: 'Framework', packages: ['nuxt'] },
  { name: 'Svelte', category: 'UI Framework', packages: ['svelte', '@sveltejs/kit'] },
  { name: 'Astro', category: 'Framework', packages: ['astro'] },
  { name: 'Fastify', category: 'Backend Framework', packages: ['fastify'] },
  { name: 'NestJS', category: 'Backend Framework', packages: ['@nestjs/core', '@nestjs/common'] },
  { name: 'Hono', category: 'Backend Framework', packages: ['hono'] },
  { name: 'tRPC', category: 'API / RPC', packages: ['@trpc/server', '@trpc/client', '@trpc/react-query'] },
  { name: 'GraphQL', category: 'API', packages: ['graphql', '@apollo/client', 'apollo-server', '@apollo/server'] },
  { name: 'TypeScript', category: 'Language Tooling', packages: ['typescript'] },
  { name: 'Vite', category: 'Bundler / Build Tool', packages: ['vite'] },
  { name: 'Webpack', category: 'Bundler / Build Tool', packages: ['webpack'] },
  { name: 'PostgreSQL', category: 'Database Driver', packages: ['pg', 'postgres'] },
  { name: 'MySQL', category: 'Database Driver', packages: ['mysql', 'mysql2'] },
  { name: 'MongoDB', category: 'Database Driver / ODM', packages: ['mongodb', 'mongoose'] },
  { name: 'Redis', category: 'Cache / Database', packages: ['redis', 'ioredis'] },
  { name: 'Zod', category: 'Validation', packages: ['zod'] },
  { name: 'Jest', category: 'Testing', packages: ['jest'] },
  { name: 'Vitest', category: 'Testing', packages: ['vitest'] },
  { name: 'Playwright', category: 'Testing', packages: ['@playwright/test', 'playwright'] },
  { name: 'Cypress', category: 'Testing', packages: ['cypress'] },
];

/**
 * Checks if a directory should be skipped during traversal.
 *
 * @param {string} dirName
 * @returns {boolean}
 */
export function isIgnoredDirectory(dirName) {
  return IGNORED_DIRECTORIES.has(dirName);
}

/**
 * Checks whether a given file name or path should be ignored.
 * Preserves harmless templates (.env.example, .env.sample, .env.template).
 * Ignores:
 * - node_modules, .git, .next, dist, build, coverage
 * - .env* (except templates)
 * - *.pem, *.key
 * - lockfiles
 *
 * @param {string} fileName
 * @returns {boolean}
 */
export function isIgnoredFile(fileName) {
  // Safe template env files should NOT be ignored
  if (
    fileName === '.env.example' ||
    fileName === '.env.sample' ||
    fileName === '.env.template'
  ) {
    return false;
  }

  // Check lockfiles
  if (KNOWN_LOCKFILES.has(fileName)) {
    return true;
  }

  // Check .env* pattern
  if (fileName.startsWith('.env')) {
    return true;
  }

  // Check *.pem and *.key patterns
  if (fileName.endsWith('.pem') || fileName.endsWith('.key')) {
    return true;
  }

  return false;
}

/**
 * Checks if file exceeds 500KB threshold.
 *
 * @param {number} sizeInBytes
 * @returns {boolean}
 */
export function isOverSizeLimit(sizeInBytes) {
  return sizeInBytes > MAX_FILE_SIZE_BYTES;
}

/**
 * Checks if a buffer represents a binary file by searching for null bytes in initial chunk.
 *
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isBinaryBuffer(buffer) {
  const maxCheck = Math.min(buffer.length, 512);
  for (let i = 0; i < maxCheck; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Detects tech stack from package.json dependencies.
 *
 * @param {string} targetDir
 * @returns {Array<{ name: string, category: string, package: string, version: string }>}
 */
export function detectStack(targetDir) {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return [];
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return [];
  }

  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };

  const detected = [];

  for (const def of STACK_DEFINITIONS) {
    for (const pkgName of def.packages) {
      if (Object.prototype.hasOwnProperty.call(allDeps, pkgName)) {
        detected.push({
          name: def.name,
          category: def.category,
          package: pkgName,
          version: allDeps[pkgName],
        });
        break; // Match once per stack entry
      }
    }
  }

  return detected;
}

/**
 * Identifies entry points and configuration files.
 *
 * @param {string} targetDir
 * @param {Array<{ relativePath: string }>} scannedFiles
 * @returns {Array<{ file: string, type: 'config'|'entry', description: string }>}
 */
export function findEntryPointsAndConfigs(targetDir, scannedFiles) {
  const relPaths = new Set(scannedFiles.map((f) => f.relativePath));
  const results = [];

  const checkAndAdd = (relPath, type, description) => {
    if (relPaths.has(relPath)) {
      results.push({ file: relPath, type, description });
    }
  };

  // Known config files
  checkAndAdd('package.json', 'config', 'Package manifest and scripts');
  checkAndAdd('.env.example', 'config', 'Environment template configuration');
  checkAndAdd('.env.sample', 'config', 'Environment sample configuration');
  checkAndAdd('.env.template', 'config', 'Environment template configuration');
  checkAndAdd('Dockerfile', 'config', 'Docker container definition');
  checkAndAdd('docker-compose.yml', 'config', 'Docker Compose configuration');
  checkAndAdd('docker-compose.yaml', 'config', 'Docker Compose configuration');
  checkAndAdd('tsconfig.json', 'config', 'TypeScript configuration');
  checkAndAdd('tsconfig.base.json', 'config', 'TypeScript base configuration');
  checkAndAdd('tsconfig.node.json', 'config', 'TypeScript Node configuration');

  // Next.js configs
  for (const p of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
    checkAndAdd(p, 'config', 'Next.js configuration');
  }

  // Vite, Webpack, Tailwind configs
  for (const p of ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']) {
    checkAndAdd(p, 'config', 'Vite configuration');
  }
  for (const p of ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs', 'tailwind.config.cjs']) {
    checkAndAdd(p, 'config', 'Tailwind CSS configuration');
  }
  for (const p of ['postcss.config.js', 'postcss.config.mjs', 'postcss.config.cjs']) {
    checkAndAdd(p, 'config', 'PostCSS configuration');
  }

  // Entry points
  const candidateEntries = [
    { path: 'bin/threadback.js', desc: 'CLI entry script' },
    { path: 'bin/pm.js', desc: 'CLI entry script' },
    { path: 'src/index.js', desc: 'Application entry module' },
    { path: 'src/index.ts', desc: 'Application entry module' },
    { path: 'src/main.js', desc: 'Application entry module' },
    { path: 'src/main.ts', desc: 'Application entry module' },
    { path: 'index.js', desc: 'Root entry script' },
    { path: 'main.js', desc: 'Root entry script' },
    { path: 'app.js', desc: 'Application script' },
    { path: 'server.js', desc: 'Server entry script' },
  ];

  for (const cand of candidateEntries) {
    checkAndAdd(cand.path, 'entry', cand.desc);
  }

  return results;
}

/**
 * Extracts setup instructions from package.json and README.md.
 *
 * @param {string} targetDir
 * @returns {{
 *   scripts: Record<string, string>,
 *   test_command: string|null,
 *   readme_setup: string|null
 * }}
 */
export function extractSetupInstructions(targetDir) {
  let scripts = {};
  let test_command = null;

  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      scripts = pkg.scripts || {};
      test_command = scripts.test || null;
    } catch {
      // Ignore package.json parsing error
    }
  }

  let readme_setup = null;
  const readmeCandidates = ['README.md', 'readme.md', 'README', 'README.markdown'];

  for (const name of readmeCandidates) {
    const readmePath = path.join(targetDir, name);
    if (fs.existsSync(readmePath)) {
      try {
        const content = fs.readFileSync(readmePath, 'utf-8');
        readme_setup = extractReadmeSetupSection(content);
        if (readme_setup) break;
      } catch {
        // Continue
      }
    }
  }

  return {
    scripts,
    test_command,
    readme_setup,
  };
}

/**
 * Parses README content looking for Setup, Installation, or Getting Started sections.
 *
 * @param {string} content
 * @returns {string|null}
 */
export function extractReadmeSetupSection(content) {
  const lines = content.split('\n');
  let inSetup = false;
  let setupLevel = 0;
  const capturedLines = [];

  const setupHeaderRegex = /^(#{1,3})\s+(Installation|Setup|Getting Started|Quick Start|How to run|Usage)/i;
  const anyHeaderRegex = /^(#{1,3})\s+/;

  for (const line of lines) {
    const match = line.match(setupHeaderRegex);
    if (match) {
      inSetup = true;
      setupLevel = match[1].length;
      capturedLines.push(line);
      continue;
    }

    if (inSetup) {
      const headerMatch = line.match(anyHeaderRegex);
      if (headerMatch && headerMatch[1].length <= setupLevel) {
        // Reached next section of same or higher hierarchy
        break;
      }
      capturedLines.push(line);
    }
  }

  const result = capturedLines.join('\n').trim();
  return result.length > 0 ? result : null;
}

/**
 * Identifies test files (*.test.*, *.spec.*, or in __tests__ folders).
 *
 * @param {Array<{ relativePath: string }>} scannedFiles
 * @param {string|null} test_command
 * @returns {{ count: number, files: string[], test_command: string|null }}
 */
export function findTestFiles(scannedFiles, test_command) {
  const testFiles = [];

  for (const file of scannedFiles) {
    const rel = file.relativePath;
    const base = path.basename(rel);

    const isTestFile =
      base.includes('.test.') ||
      base.includes('.spec.') ||
      rel.includes('__tests__/') ||
      rel.startsWith('tests/') ||
      rel.startsWith('test/');

    if (isTestFile) {
      testFiles.push(rel);
    }
  }

  return {
    count: testFiles.length,
    files: testFiles,
    test_command,
  };
}

/**
 * Scans a text file for annotations:
 * TODO, FIXME, HACK, "not implemented", "coming soon".
 *
 * @param {string} fullPath
 * @param {string} relativePath
 * @returns {Array<{ file: string, line: number, tag: string, text: string }>}
 */
export function scanFileAnnotations(fullPath, relativePath) {
  const ext = path.extname(fullPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return [];
  }

  let buffer;
  try {
    buffer = fs.readFileSync(fullPath);
  } catch {
    return [];
  }

  if (isBinaryBuffer(buffer)) {
    return [];
  }

  const content = buffer.toString('utf-8');
  const lines = content.split('\n');
  const annotations = [];

  // Patterns to search for
  const patterns = [
    { tag: 'TODO', regex: /\bTODO\b/ },
    { tag: 'FIXME', regex: /\bFIXME\b/ },
    { tag: 'HACK', regex: /\bHACK\b/ },
    { tag: 'not implemented', regex: /\bnot implemented\b/i },
    { tag: 'coming soon', regex: /\bcoming soon\b/i },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        annotations.push({
          file: relativePath,
          line: i + 1,
          tag: pattern.tag,
          text: line.trim(),
        });
        break; // Record line once per line
      }
    }
  }

  return annotations;
}

/**
 * Walks the target repository in read-only mode and compiles all required metrics:
 * - languages by extension & language name
 * - detected stack
 * - entry points & config files
 * - setup instructions
 * - test files & test command
 * - annotations (TODO, FIXME, HACK, not implemented, coming soon)
 *
 * @param {string} targetDir
 * @param {object} [options]
 * @returns {{
 *   languages: { by_extension: Record<string, number>, by_language: Record<string, number> },
 *   stack: Array<{ name: string, category: string, package: string, version: string }>,
 *   entry_points_and_configs: Array<{ file: string, type: string, description: string }>,
 *   setup_instructions: { scripts: Record<string, string>, test_command: string|null, readme_setup: string|null },
 *   tests: { count: number, files: string[], test_command: string|null },
 *   code_annotations: {
 *     total: number,
 *     by_tag: { TODO: number, FIXME: number, HACK: number, 'not implemented': number, 'coming soon': number },
 *     items: Array<{ file: string, line: number, tag: string, text: string }>
 *   },
 *   scannedFiles: Array<{ path: string, relativePath: string, size: number, ext: string }>,
 *   ignoredCounts: { directories: number, sensitiveOrLock: number, overSize: number },
 *   stats: { totalFiles: number, totalSizeBytes: number }
 * }}
 */
export function scanRepository(targetDir, options = {}) {
  const maxDepth = options.maxDepth ?? 15;
  const scannedFiles = [];
  const ignoredCounts = {
    directories: 0,
    sensitiveOrLock: 0,
    overSize: 0,
  };
  const by_extension = {};
  const by_language = {};
  let totalSizeBytes = 0;
  const allAnnotations = [];

  function walk(currentDir, currentDepth) {
    if (currentDepth > maxDepth) return;

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) {
          ignoredCounts.directories++;
          continue;
        }
        walk(fullPath, currentDepth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (isIgnoredFile(entry.name)) {
          ignoredCounts.sensitiveOrLock++;
          continue;
        }

        try {
          const stat = fs.statSync(fullPath);
          if (isOverSizeLimit(stat.size)) {
            ignoredCounts.overSize++;
            continue;
          }

          const relativePath = path.relative(targetDir, fullPath).replace(/\\/g, '/');
          const ext = path.extname(entry.name).toLowerCase() || '[no-ext]';
          const lang = EXTENSION_LANGUAGE_MAP[ext] || (ext === '[no-ext]' ? 'Plain Text' : 'Other');

          scannedFiles.push({
            path: fullPath,
            relativePath,
            size: stat.size,
            ext,
          });

          totalSizeBytes += stat.size;
          by_extension[ext] = (by_extension[ext] || 0) + 1;
          by_language[lang] = (by_language[lang] || 0) + 1;

          // Scan for annotations
          const fileAnnotations = scanFileAnnotations(fullPath, relativePath);
          if (fileAnnotations.length > 0) {
            allAnnotations.push(...fileAnnotations);
          }
        } catch {
          continue;
        }
      }
    }
  }

  walk(targetDir, 0);

  // Extract stack and setup from repo
  const stack = detectStack(targetDir);
  const entry_points_and_configs = findEntryPointsAndConfigs(targetDir, scannedFiles);
  const setup_instructions = extractSetupInstructions(targetDir);
  const tests = findTestFiles(scannedFiles, setup_instructions.test_command);

  const by_tag = {
    TODO: 0,
    FIXME: 0,
    HACK: 0,
    'not implemented': 0,
    'coming soon': 0,
  };

  for (const item of allAnnotations) {
    if (Object.prototype.hasOwnProperty.call(by_tag, item.tag)) {
      by_tag[item.tag]++;
    }
  }

  return {
    languages: {
      by_extension,
      by_language,
    },
    stack,
    entry_points_and_configs,
    setup_instructions,
    tests,
    code_annotations: {
      total: allAnnotations.length,
      by_tag,
      items: allAnnotations,
    },
    scannedFiles,
    ignoredCounts,
    stats: {
      totalFiles: scannedFiles.length,
      totalSizeBytes,
      extensions: by_extension,
    },
  };
}
