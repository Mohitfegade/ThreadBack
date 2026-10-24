import fs from 'node:fs';
import path from 'node:path';
import { execGit, getGitSummary } from './git.js';
import { scanRepository } from './scanner.js';

export const MEMORY_DIR_NAME = '.threadback';
export const LEGACY_MEMORY_DIR_NAME = '.project-memory';
export const LEDGER_FILE_NAME = 'ledger.json';

/**
 * Returns the absolute path to .threadback directory (falling back to legacy .project-memory if present).
 *
 * @param {string} targetDir
 * @returns {string}
 */
export function getMemoryDirPath(targetDir) {
  const primary = path.join(targetDir, MEMORY_DIR_NAME);
  if (fs.existsSync(primary)) {
    return primary;
  }
  const legacy = path.join(targetDir, LEGACY_MEMORY_DIR_NAME);
  if (fs.existsSync(legacy)) {
    return legacy;
  }
  return primary;
}

/**
 * Returns the absolute path to ledger.json.
 *
 * @param {string} targetDir
 * @returns {string}
 */
export function getLedgerFilePath(targetDir) {
  return path.join(getMemoryDirPath(targetDir), LEDGER_FILE_NAME);
}

/**
 * Ensures the .project-memory directory exists inside the target repository.
 *
 * @param {string} targetDir
 */
export function ensureMemoryDir(targetDir) {
  const dirPath = getMemoryDirPath(targetDir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Reads ledger.json from the target repository.
 *
 * @param {string} targetDir
 * @returns {{
 *   version: number,
 *   last_analyzed_commit: string|null,
 *   lastUpdated: string,
 *   features: Array<object>
 * }}
 */
export function readLedger(targetDir) {
  const filePath = getLedgerFilePath(targetDir);
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      last_analyzed_commit: null,
      lastUpdated: new Date().toISOString(),
      features: [],
    };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Warning: Failed to parse ${filePath}, returning empty ledger.`);
    return {
      version: 1,
      last_analyzed_commit: null,
      lastUpdated: new Date().toISOString(),
      features: [],
    };
  }
}

/**
 * Writes data to ledger.json inside .project-memory.
 * Strictly writes only inside .project-memory.
 *
 * @param {string} targetDir
 * @param {object} ledgerData
 */
export function writeLedger(targetDir, ledgerData) {
  ensureMemoryDir(targetDir);
  const filePath = getLedgerFilePath(targetDir);
  const payload = {
    version: ledgerData.version || 1,
    last_analyzed_commit: ledgerData.last_analyzed_commit ?? null,
    lastUpdated: new Date().toISOString(),
    stats: ledgerData.stats || calculateLedgerStats(ledgerData.features || []),
    features: ledgerData.features || [],
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

/**
 * Calculates summary statistics for features.
 *
 * @param {Array<object>} features
 * @returns {object}
 */
export function calculateLedgerStats(features) {
  return {
    total: features.length,
    implemented: features.filter((f) => f.implementation_status === 'implemented').length,
    incomplete: features.filter((f) => f.implementation_status === 'incomplete').length,
    planned: features.filter((f) => f.implementation_status === 'planned').length,
    unknown: features.filter((f) => f.implementation_status === 'unknown').length,
    verified: features.filter((f) => f.verification_status === 'verified').length,
    unverified: features.filter((f) => f.verification_status === 'unverified').length,
    needs_review: features.filter((f) => f.needs_review).length,
  };
}

/**
 * Adds or updates a feature in the ledger (backwards-compatible).
 *
 * @param {string} targetDir
 * @param {object} feature
 * @returns {object}
 */
export function addFeature(targetDir, feature) {
  const ledger = readLedger(targetDir);
  const id = feature.id || `feat-${Date.now()}`;
  const now = new Date().toISOString();

  const existingIndex = ledger.features.findIndex((f) => f.id === id);
  const newEntry = {
    id,
    name: feature.name || id,
    area: feature.area || 'general',
    implementation_status: feature.implementation_status || feature.status || 'planned',
    verification_status: feature.verification_status || 'unverified',
    evidence: feature.evidence || [],
    last_analyzed_commit: feature.last_analyzed_commit || null,
    confidence: feature.confidence || 'medium',
    needs_review: feature.needs_review ?? false,
    reason: feature.reason || 'Manually added or updated feature',
    status: feature.status || feature.implementation_status || 'planned', // backwards compat
    tags: feature.tags || [],
    createdAt: existingIndex >= 0 ? ledger.features[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    ledger.features[existingIndex] = newEntry;
  } else {
    ledger.features.push(newEntry);
  }

  writeLedger(targetDir, ledger);
  return newEntry;
}

/**
 * Updates feature status (backwards-compatible).
 *
 * @param {string} targetDir
 * @param {string} featureId
 * @param {string} status
 * @returns {object|null}
 */
export function updateFeatureStatus(targetDir, featureId, status) {
  const ledger = readLedger(targetDir);
  const target = ledger.features.find((f) => f.id === featureId);
  if (!target) return null;

  target.implementation_status = status;
  target.status = status; // backwards compat
  target.updatedAt = new Date().toISOString();
  writeLedger(targetDir, ledger);
  return target;
}

/**
 * Verification hook: Check if a recorded test run exists for this commit.
 * CRITICAL RULE: File existence is never proof of working. Never output "verified" without a test result.
 * Currently always returns false until test run records are persisted; provided as a clear hook for future expansion.
 *
 * @param {string|null} commitSha
 * @param {string} featureId
 * @param {string} targetDir
 * @returns {boolean}
 */
export function checkRecordedTestRun(commitSha, featureId, targetDir) {
  if (!commitSha) return false;
  const testRunsFile = path.join(getMemoryDirPath(targetDir), 'test-runs.json');
  if (fs.existsSync(testRunsFile)) {
    try {
      const runs = JSON.parse(fs.readFileSync(testRunsFile, 'utf-8'));
      if (Array.isArray(runs)) {
        return runs.some(
          (r) =>
            r.commit_sha === commitSha &&
            r.status === 'passed' &&
            Array.isArray(r.features) &&
            r.features.includes(featureId)
        );
      }
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Detects placeholder patterns in source code:
 * - 501 / Not implemented responses
 * - Empty function/handler bodies
 * - Explicit 'not implemented' or 'coming soon' comments / strings
 *
 * @param {string} code
 * @returns {{ isPlaceholder: boolean, line: number, reason: string } | null}
 */
export function inspectPlaceholderCode(code) {
  const lines = code.split('\n');

  // Check line-by-line for explicit return of 501 or not implemented
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/status\s*\(\s*501\s*\)/i.test(line) || /status:\s*501\b/i.test(line)) {
      return {
        isPlaceholder: true,
        line: i + 1,
        reason: 'Handler explicitly returns HTTP 501 Not Implemented',
      };
    }

    if (
      /throw\s+new\s+Error\s*\(\s*['"`][^'"`]*(?:not implemented|coming soon)/i.test(line)
    ) {
      return {
        isPlaceholder: true,
        line: i + 1,
        reason: 'Throws "not implemented" error',
      };
    }

    if (
      /(?:NextResponse|Response)\.json\s*\(\s*\{[^}]*(?:not implemented|coming soon)/i.test(line)
    ) {
      return {
        isPlaceholder: true,
        line: i + 1,
        reason: 'Response returns "not implemented" payload',
      };
    }
  }

  // Check for empty handler functions
  // e.g. export async function GET() {} or export default function Page() { return null; }
  const cleanCode = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim();

  if (
    /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH)\s*\([^)]*\)\s*\{\s*\}/.test(
      cleanCode
    )
  ) {
    return {
      isPlaceholder: true,
      line: 1,
      reason: 'Empty HTTP route handler function body',
    };
  }

  if (
    /export\s+default\s+function\s*\w*\s*\([^)]*\)\s*\{\s*(?:return\s*(?:null|<>\s*<\/>|undefined)?\s*;?)?\s*\}/.test(
      cleanCode
    ) ||
    /export\s+default\s+(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>\s*(?:null|<>\s*<\/>|\{\s*(?:return\s*(?:null|<>\s*<\/>)?\s*;?)?\s*\})/.test(
      cleanCode
    )
  ) {
    return {
      isPlaceholder: true,
      line: 1,
      reason: 'Component returns empty placeholder (null or <></>)',
    };
  }

  return null;
}

/**
 * Normalizes and groups route path into a named feature and area.
 *
 * @param {string} routePath
 * @returns {{ id: string, name: string, area: string }}
 */
export function categorizeRoute(routePath) {
  const clean = routePath.replace(/^\/+|\/+$/g, '');
  const segments = clean.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { id: 'feat-home', name: 'Home Page', area: 'home' };
  }

  const first = segments[0].toLowerCase();
  const second = (segments[1] || '').toLowerCase();

  // If starts with 'api'
  if (first === 'api') {
    if (!second) {
      return { id: 'feat-api-root', name: 'API Root', area: 'api' };
    }
    return mapSegmentToFeature(second, `api/${second}`, `/api/${second}`);
  }

  return mapSegmentToFeature(first, first, `/${first}`);
}

/**
 * Maps a path segment keyword to feature name, id, and area.
 *
 * @param {string} segment
 * @param {string} area
 * @param {string} routePrefix
 * @returns {{ id: string, name: string, area: string }}
 */
function mapSegmentToFeature(segment, area, routePrefix) {
  const s = segment.toLowerCase();

  if (['auth', 'login', 'signup', 'register', 'session', 'oauth', 'token'].includes(s)) {
    return { id: 'feat-auth', name: 'Authentication', area: 'auth' };
  }
  if (['user', 'users', 'profile', 'profiles', 'account', 'accounts'].includes(s)) {
    return { id: 'feat-users', name: 'User Management', area: 'users' };
  }
  if (['payment', 'payments', 'billing', 'checkout', 'stripe', 'subscription', 'subscriptions'].includes(s)) {
    return { id: 'feat-payments', name: 'Payments & Billing', area: 'payments' };
  }
  if (['upload', 'uploads', 'media', 'files', 'storage', 'images'].includes(s)) {
    return { id: 'feat-storage', name: 'File Storage & Uploads', area: 'storage' };
  }
  if (['email', 'mail', 'notification', 'notifications'].includes(s)) {
    return { id: 'feat-notifications', name: 'Notifications & Email', area: 'notifications' };
  }
  if (['dashboard', 'admin', 'portal'].includes(s)) {
    return { id: `feat-${s}`, name: capitalize(s), area: s };
  }
  if (['settings', 'preferences'].includes(s)) {
    return { id: 'feat-settings', name: 'Settings', area: 'settings' };
  }
  if (['order', 'orders', 'cart'].includes(s)) {
    return { id: 'feat-orders', name: 'Orders & Checkout', area: 'orders' };
  }
  if (['product', 'products', 'catalog', 'items'].includes(s)) {
    return { id: 'feat-catalog', name: 'Product Catalog', area: 'catalog' };
  }
  if (['post', 'posts', 'blog', 'articles'].includes(s)) {
    return { id: 'feat-content', name: 'Blog & Content', area: 'content' };
  }

  // Fallback for custom segments
  const name = `${capitalize(s)} (${routePrefix})`;
  return { id: `feat-${s.replace(/[^a-z0-9_-]/g, '-')}`, name, area };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Discovers candidate features from App Router, Pages Router, Express/Fastify routes,
 * Prisma models, SQL tables, and Auth/Payment integrations.
 *
 * @param {string} targetDir
 * @param {object} scanResult
 * @returns {Map<string, {
 *   id: string,
 *   name: string,
 *   area: string,
 *   files: Set<string>,
 *   routes: Set<string>,
 *   models: Set<string>,
 *   evidence: Array<object>
 * }>}
 */
export function discoverCandidateFeatures(targetDir, scanResult) {
  const featureMap = new Map();

  function getOrCreateFeature(id, name, area) {
    if (!featureMap.has(id)) {
      featureMap.set(id, {
        id,
        name,
        area,
        files: new Set(),
        routes: new Set(),
        models: new Set(),
        evidence: [],
      });
    }
    const feat = featureMap.get(id);
    if (name && (!feat.name || feat.name.includes('('))) feat.name = name;
    return feat;
  }

  let scannedFiles = scanResult.scannedFiles;
  if (!scannedFiles || scannedFiles.length === 0) {
    const rescan = scanRepository(targetDir);
    scannedFiles = rescan.scannedFiles || [];
  }

  // 1. Next.js App Router (app/**/page.* and app/api/**/route.*)
  for (const file of scannedFiles) {
    const rel = file.relativePath;

    // Next.js App Router route handlers
    const appRouteMatch = rel.match(/(?:^|\/)(?:src\/)?app\/api\/(.+)\/route\.[a-zA-Z]+$/);
    if (appRouteMatch) {
      const routeSubpath = `/api/${appRouteMatch[1]}`;
      const { id, name, area } = categorizeRoute(routeSubpath);
      const feat = getOrCreateFeature(id, name, area);
      feat.files.add(rel);
      feat.routes.add(routeSubpath);
      feat.evidence.push({
        type: 'source_file',
        path: rel,
        line: 1,
        description: `App Router API route: ${routeSubpath}`,
      });
      continue;
    }

    // Next.js App Router pages
    const appPageMatch = rel.match(/(?:^|\/)(?:src\/)?app\/(.+)\/page\.[a-zA-Z]+$/);
    if (appPageMatch) {
      const routeSubpath = `/${appPageMatch[1]}`;
      const { id, name, area } = categorizeRoute(routeSubpath);
      const feat = getOrCreateFeature(id, name, area);
      feat.files.add(rel);
      feat.routes.add(routeSubpath);
      feat.evidence.push({
        type: 'source_file',
        path: rel,
        line: 1,
        description: `App Router page: ${routeSubpath}`,
      });
      continue;
    }

    // Root page app/page.*
    if (/(?:^|\/)(?:src\/)?app\/page\.[a-zA-Z]+$/.test(rel)) {
      const feat = getOrCreateFeature('feat-home', 'Home Page', 'home');
      feat.files.add(rel);
      feat.routes.add('/');
      feat.evidence.push({
        type: 'source_file',
        path: rel,
        line: 1,
        description: 'App Router root page: /',
      });
      continue;
    }

    // 2. Next.js Pages Router (pages/**)
    const pagesMatch = rel.match(/(?:^|\/)(?:src\/)?pages\/(.+)\.[a-zA-Z]+$/);
    if (pagesMatch) {
      const sub = pagesMatch[1];
      if (!sub.startsWith('_')) {
        const routePath = sub === 'index' ? '/' : `/${sub.replace(/\/index$/, '')}`;
        const { id, name, area } = categorizeRoute(routePath);
        const feat = getOrCreateFeature(id, name, area);
        feat.files.add(rel);
        feat.routes.add(routePath);
        feat.evidence.push({
          type: 'source_file',
          path: rel,
          line: 1,
          description: `Pages Router route: ${routePath}`,
        });
      }
    }
  }

  // 3. Express/Fastify routes inside JS/TS files
  for (const file of scannedFiles) {
    const ext = file.ext;
    if (!['.js', '.ts', '.mjs', '.cjs'].includes(ext)) continue;
    if (file.relativePath.includes('node_modules') || file.relativePath.includes('tests/')) continue;

    let content = '';
    try {
      content = fs.readFileSync(file.path, 'utf-8');
    } catch {
      continue;
    }

    const routeRegex =
      /(?:app|router|server|fastify)\.(get|post|put|delete|patch|options|all)\s*\(\s*(['"`])([^'"`]+)\2/gi;
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const routePath = match[3];
      if (!routePath.startsWith('/')) continue;

      const { id, name, area } = categorizeRoute(routePath);
      const feat = getOrCreateFeature(id, name, area);
      feat.files.add(file.relativePath);
      feat.routes.add(`${method} ${routePath}`);

      const lineNumber = content.slice(0, match.index).split('\n').length;
      feat.evidence.push({
        type: 'source_file',
        path: file.relativePath,
        line: lineNumber,
        description: `Express/Fastify route: ${method} ${routePath}`,
      });
    }
  }

  // 4. Prisma schema models (schema.prisma or *.prisma)
  for (const file of scannedFiles) {
    if (file.relativePath.endsWith('.prisma')) {
      let content = '';
      try {
        content = fs.readFileSync(file.path, 'utf-8');
      } catch {
        continue;
      }

      const modelRegex = /(?:^|\n)\s*model\s+([A-Za-z0-9_]+)\s*\{/g;
      let match;
      while ((match = modelRegex.exec(content)) !== null) {
        const modelName = match[1];
        const id = `model-${modelName.toLowerCase()}`;
        const feat = getOrCreateFeature(id, `Model: ${modelName}`, 'database/prisma');
        feat.files.add(file.relativePath);
        feat.models.add(modelName);

        const lineNumber = content.slice(0, match.index).split('\n').length;
        feat.evidence.push({
          type: 'source_file',
          path: file.relativePath,
          line: lineNumber,
          description: `Prisma schema model declaration for ${modelName}`,
        });
      }
    }
  }

  // 5. SQL CREATE TABLE statements (migrations, *.sql)
  for (const file of scannedFiles) {
    if (file.relativePath.endsWith('.sql')) {
      let content = '';
      try {
        content = fs.readFileSync(file.path, 'utf-8');
      } catch {
        continue;
      }

      const tableRegex =
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["'`]?\w+["'`]?\.)?["'`]?([A-Za-z0-9_]+)["'`]?\s*\(/gi;
      let match;
      const isSupabase = file.relativePath.includes('supabase');
      const area = isSupabase ? 'database/supabase' : 'database/sql';

      while ((match = tableRegex.exec(content)) !== null) {
        const tableName = match[1];
        const id = `table-${tableName.toLowerCase()}`;
        const feat = getOrCreateFeature(id, `Table: ${tableName}`, area);
        feat.files.add(file.relativePath);
        feat.models.add(tableName);

        const lineNumber = content.slice(0, match.index).split('\n').length;
        feat.evidence.push({
          type: 'source_file',
          path: file.relativePath,
          line: lineNumber,
          description: `SQL CREATE TABLE statement for ${tableName}`,
        });
      }
    }
  }

  // 6. Ecosystem packages (Auth, Payments, Upload, Email)
  const detectedStack = scanResult.stack || [];
  const stackPkgNames = new Set(detectedStack.map((s) => s.package));

  // Check auth stack
  if (
    stackPkgNames.has('next-auth') ||
    stackPkgNames.has('@supabase/supabase-js') ||
    stackPkgNames.has('passport') ||
    stackPkgNames.has('@clerk/nextjs')
  ) {
    const feat = getOrCreateFeature('feat-auth', 'Authentication', 'auth');
    for (const s of detectedStack.filter((x) =>
      ['next-auth', '@supabase/supabase-js', 'passport', '@clerk/nextjs'].includes(x.package)
    )) {
      feat.evidence.push({
        type: 'source_file',
        path: 'package.json',
        line: 1,
        description: `Auth dependency detected: ${s.package}@${s.version}`,
      });
    }
  }

  // Check payments stack
  if (stackPkgNames.has('stripe') || stackPkgNames.has('@stripe/stripe-js')) {
    const feat = getOrCreateFeature('feat-payments', 'Payments & Billing', 'payments');
    feat.evidence.push({
      type: 'source_file',
      path: 'package.json',
      line: 1,
      description: 'Stripe payments dependency configured',
    });
  }

  return featureMap;
}

/**
 * Produces the complete feature ledger with deterministic status evaluation and stale evidence tracking.
 *
 * @param {string} targetDir
 * @param {object} scanResult - Result of repository scan and git metadata
 * @returns {Array<object>} array of evaluated features
 */
export function generateFeatureLedger(targetDir, scanResult) {
  const currentCommit = scanResult.commit_sha || null;
  const annotations = scanResult.code_annotations?.items || [];
  const testFiles = scanResult.tests?.files || [];

  // 1. Read existing ledger to check for previous commit
  const existingLedger = readLedger(targetDir);
  const oldCommit = existingLedger.last_analyzed_commit || null;

  // 2. Identify files changed between oldCommit and currentCommit
  const changedFilesSinceOldCommit = new Set();
  if (oldCommit && currentCommit && oldCommit !== currentCommit) {
    const diffOutput = execGit(['diff', '--name-only', oldCommit, currentCommit], targetDir);
    if (diffOutput) {
      for (const f of diffOutput.split('\n')) {
        const trimmed = f.trim();
        if (trimmed) changedFilesSinceOldCommit.add(trimmed.replace(/\\/g, '/'));
      }
    }
  }

  // 3. Discover all candidate features
  const candidatesMap = discoverCandidateFeatures(targetDir, scanResult);
  const finalFeatures = [];

  for (const candidate of candidatesMap.values()) {
    const evidenceList = [...candidate.evidence];
    const candidateFiles = Array.from(candidate.files);
    let placeholderEvidence = null;
    let todoEvidence = null;

    // Check files for placeholder code
    for (const relPath of candidateFiles) {
      const fullPath = path.join(targetDir, relPath);
      if (fs.existsSync(fullPath)) {
        try {
          const code = fs.readFileSync(fullPath, 'utf-8');
          const placeholderResult = inspectPlaceholderCode(code);
          if (placeholderResult && placeholderResult.isPlaceholder) {
            placeholderEvidence = {
              type: 'placeholder',
              path: relPath,
              line: placeholderResult.line,
              description: placeholderResult.reason,
            };
            evidenceList.push(placeholderEvidence);
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Check for TODO/FIXME annotations belonging to this feature's files
    for (const ann of annotations) {
      if (candidate.files.has(ann.file)) {
        const todoItem = {
          type: 'todo',
          path: ann.file,
          line: ann.line,
          description: `${ann.tag}: ${ann.text}`,
        };
        evidenceList.push(todoItem);
        if (!todoEvidence) todoEvidence = todoItem;
      }
    }

    // Check for associated test files
    let testFound = false;
    for (const tf of testFiles) {
      const tfLower = tf.toLowerCase();
      const areaLower = candidate.area.toLowerCase();
      const idLower = candidate.id.replace(/^feat-|^model-|^table-/, '').toLowerCase();

      // Check if test filename references area or feature id
      if (tfLower.includes(areaLower) || tfLower.includes(idLower)) {
        evidenceList.push({
          type: 'test',
          path: tf,
          line: 1,
          description: `Test file references feature: ${tf}`,
        });
        testFound = true;
      }
    }

    // DETERMINISTIC STATUS EVALUATION
    let implementation_status = 'unknown';
    let reason = '';
    let confidence = 'high';
    let needs_review = false;

    if (placeholderEvidence) {
      implementation_status = 'incomplete';
      reason = `Incomplete: ${placeholderEvidence.description} at ${placeholderEvidence.path}:${placeholderEvidence.line}`;
      confidence = 'high';
    } else if (todoEvidence) {
      implementation_status = 'incomplete';
      reason = `Incomplete: ${todoEvidence.description} at ${todoEvidence.path}:${todoEvidence.line}`;
      confidence = 'high';
    } else if (candidateFiles.length > 0) {
      // Check if candidate is merely a model/schema declaration without actual route/service files
      if (candidate.area.startsWith('database/')) {
        implementation_status = 'planned';
        reason = `Planned: database declaration found with no dedicated service/route implementation`;
        confidence = 'medium';
      } else {
        implementation_status = 'implemented';
        reason = `Implemented: ${candidateFiles.length} source file(s) exist with no placeholder or TODO markers`;
        confidence = candidateFiles.length > 1 ? 'high' : 'medium';
      }
    } else {
      implementation_status = 'unknown';
      reason = 'Unknown: insufficient source file evidence';
      confidence = 'low';
      needs_review = true;
    }

    // VERIFICATION STATUS
    // CRITICAL RULE: File existence is never proof of working. Never output "verified" without a test result.
    const isVerifiedByRecordedRun = checkRecordedTestRun(currentCommit, candidate.id, targetDir);
    let verification_status = 'unverified';

    if (isVerifiedByRecordedRun) {
      verification_status = 'verified';
    } else {
      verification_status = 'unverified';
      if (!testFound) {
        reason += '; no test file references this feature';
      } else {
        reason += '; test file exists but test execution has not been verified for this commit';
      }
    }

    // STALE EVIDENCE DETECTION
    let stale_evidence = false;
    if (changedFilesSinceOldCommit.size > 0) {
      for (const ev of evidenceList) {
        if (ev.path && changedFilesSinceOldCommit.has(ev.path)) {
          stale_evidence = true;
          break;
        }
      }
      if (stale_evidence) {
        reason += ` [stale_evidence: modified since previous commit ${oldCommit.slice(0, 7)}]`;
      }
    }

    finalFeatures.push({
      id: candidate.id,
      name: candidate.name,
      area: candidate.area,
      implementation_status,
      verification_status,
      evidence: evidenceList,
      last_analyzed_commit: currentCommit,
      confidence,
      needs_review,
      reason,
      stale_evidence,
    });
  }

  // Sort deterministically by area and id
  finalFeatures.sort((a, b) => a.area.localeCompare(b.area) || a.id.localeCompare(b.id));

  // Save to .project-memory/ledger.json
  const ledgerPayload = {
    version: 1,
    last_analyzed_commit: currentCommit,
    lastUpdated: new Date().toISOString(),
    stats: calculateLedgerStats(finalFeatures),
    features: finalFeatures,
  };

  writeLedger(targetDir, ledgerPayload);
  return finalFeatures;
}

/**
 * Formats the feature ledger as a clean terminal table.
 *
 * @param {Array<object>} features
 * @returns {string}
 */
export function formatFeatureLedgerTable(features) {
  const headers = ['ID', 'Name', 'Area', 'Implementation', 'Verification', 'Confidence', 'Review?'];
  const rows = features.map((f) => [
    f.id,
    f.name.length > 24 ? f.name.slice(0, 21) + '...' : f.name,
    f.area,
    f.implementation_status.toUpperCase(),
    f.verification_status,
    f.confidence,
    f.needs_review ? 'YES' : 'NO',
  ]);

  // Compute column widths
  const colWidths = headers.map((h, i) => {
    const maxVal = Math.max(...rows.map((r) => r[i].length), h.length);
    return Math.max(maxVal, 8);
  });

  const formatRow = (cols) =>
    '| ' + cols.map((c, i) => c.padEnd(colWidths[i])).join(' | ') + ' |';

  const separator =
    '|-' + colWidths.map((w) => '-'.repeat(w)).join('-|-') + '-|';

  const stats = calculateLedgerStats(features);

  return [
    '=========================================================================================',
    '                                THREADBACK — FEATURE LEDGER                               ',
    '=========================================================================================',
    formatRow(headers),
    separator,
    rows.length > 0 ? rows.map(formatRow).join('\n') : '| (No candidate features discovered) |',
    '=========================================================================================',
    ` Total: ${stats.total} | Implemented: ${stats.implemented} | Incomplete: ${stats.incomplete} | Planned: ${stats.planned} | Unverified: ${stats.unverified} | Review Needed: ${stats.needs_review}`,
    '=========================================================================================',
  ].join('\n');
}

/**
 * Prints the formatted feature ledger table in the terminal.
 *
 * @param {Array<object>} features
 */
export function printFeatureLedgerTable(features) {
  console.log(formatFeatureLedgerTable(features));
}
