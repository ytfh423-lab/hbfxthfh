#!/usr/bin/env bun
/**
 * Build script for Claude Code CN
 * 1. Generate stub files for missing local modules
 * 2. Create ESM stub packages for private/internal dependencies
 * 3. Bundle with Bun into a standalone executable
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname, resolve, extname } from 'path';
import { execSync, spawnSync } from 'child_process';

const ROOT = resolve(import.meta.dir, '..');
const srcDir = join(ROOT, 'src');
const nodeModules = join(ROOT, 'node_modules');

// ─── Helpers ───────────────────────────────────────────────
function walkDir(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) files.push(...walkDir(full));
      else if (full.endsWith('.ts') || full.endsWith('.tsx')) files.push(full);
    }
  } catch {}
  return files;
}

function findStubPath(fromFile: string, importPath: string): string | null {
  const dir = dirname(fromFile);
  const resolved = resolve(dir, importPath);
  const candidates = [
    resolved,
    resolved.replace(/\.js$/, '.ts'),
    resolved.replace(/\.js$/, '.tsx'),
    resolved.replace(/\.jsx$/, '.tsx'),
    resolved.replace(/\.js$/, '/index.ts'),
    resolved.replace(/\.js$/, '/index.tsx'),
    resolved + '.ts',
    resolved + '.tsx',
    resolved + '/index.ts',
    resolved + '/index.tsx',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return null;
  }
  if (importPath.endsWith('.js')) return resolved.replace(/\.js$/, '.ts');
  if (importPath.endsWith('.jsx')) return resolved.replace(/\.jsx$/, '.tsx');
  if (importPath.endsWith('.md')) return resolved;
  if (importPath.endsWith('.txt')) return resolved;
  return resolved + '.ts';
}

// ─── Step 1: Generate stub files for missing local modules ─
console.log('==> Step 1: Generating local module stubs...');

const allRelativeImports = new Map<string, Set<string>>();

for (const file of walkDir(srcDir)) {
  const content = readFileSync(file, 'utf-8');

  // Static: import { X } from './path'
  const namedMatches = content.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](\.[^'"]+)['"]/g
  );
  for (const m of namedMatches) {
    const stubPath = findStubPath(file, m[2]);
    if (!stubPath) continue;
    if (!allRelativeImports.has(stubPath)) allRelativeImports.set(stubPath, new Set());
    const set = allRelativeImports.get(stubPath)!;
    for (const part of m[1].split(',')) {
      let trimmed = part.trim().replace(/^type\s+/, '');
      if (!trimmed) continue;
      const asMatch = trimmed.match(/^(\w+)\s+as\s+/);
      if (asMatch) trimmed = asMatch[1];
      set.add(trimmed);
    }
  }

  // Static: import X from './path'
  const defaultMatches = content.matchAll(
    /import\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/g
  );
  for (const m of defaultMatches) {
    if (m[1] === 'type') continue;
    const stubPath = findStubPath(file, m[2]);
    if (!stubPath) continue;
    if (!allRelativeImports.has(stubPath)) allRelativeImports.set(stubPath, new Set());
    allRelativeImports.get(stubPath)!.add(`__default__:${m[1]}`);
  }

  // Static: import X, { A, B } from '...'
  const mixedMatches = content.matchAll(
    /import\s+(\w+)\s*,\s*\{([^}]*)\}\s+from\s+['"](\.[^'"]+)['"]/g
  );
  for (const m of mixedMatches) {
    const stubPath = findStubPath(file, m[3]);
    if (!stubPath) continue;
    if (!allRelativeImports.has(stubPath)) allRelativeImports.set(stubPath, new Set());
    const set = allRelativeImports.get(stubPath)!;
    set.add(`__default__:${m[1]}`);
    for (const part of m[2].split(',')) {
      let trimmed = part.trim().replace(/^type\s+/, '');
      if (!trimmed) continue;
      set.add(trimmed);
    }
  }

  // Side-effect: import './path' and export * from './path'
  const bareImports = content.matchAll(/(?:import|export\s+\*\s+from)\s+['"](\.[^'"]+)['"]/g);
  for (const m of bareImports) {
    const stubPath = findStubPath(file, m[1]);
    if (!stubPath) continue;
    if (!allRelativeImports.has(stubPath)) allRelativeImports.set(stubPath, new Set());
  }

  // Dynamic: await import('./path') and require('./path')
  const dynamicMatches = content.matchAll(/(?:import|require)\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g);
  for (const m of dynamicMatches) {
    const stubPath = findStubPath(file, m[1]);
    if (!stubPath) continue;
    if (!allRelativeImports.has(stubPath)) allRelativeImports.set(stubPath, new Set());
  }
}

let localStubCount = 0;
for (const [stubPath, names] of allRelativeImports) {
  if (existsSync(stubPath)) continue;
  mkdirSync(dirname(stubPath), { recursive: true });
  const ext = extname(stubPath);
  if (ext === '.md') {
    writeFileSync(stubPath, '<!-- stub -->\n');
    localStubCount++;
    continue;
  }
  if (ext === '.txt') {
    writeFileSync(stubPath, '');
    localStubCount++;
    continue;
  }
  const lines: string[] = ['// Auto-generated stub'];
  const defaultExports = [...names].filter(n => n.startsWith('__default__:'));
  const namedExports = [...names].filter(n => !n.startsWith('__default__'));
  for (const name of namedExports) {
    lines.push(`export const ${name} = undefined as any;`);
  }
  if (defaultExports.length > 0) {
    lines.push(`const _default = undefined as any;`);
    lines.push(`export default _default;`);
  }
  if (names.size === 0) {
    lines.push('export {};');
  }
  writeFileSync(stubPath, lines.join('\n') + '\n');
  localStubCount++;
}

// Fix "export const type X" -> "export type X"
for (const file of walkDir(srcDir)) {
  if (!readFileSync(file, 'utf-8').startsWith('// Auto-generated stub')) continue;
  const content = readFileSync(file, 'utf-8');
  const fixed = content.replace(/export const type (\w+) = undefined as any;/g, 'export type $1 = any;');
  if (fixed !== content) writeFileSync(file, fixed);
}

console.log(`   Created ${localStubCount} local stubs`);

// ─── Step 2: Create ESM stub packages for private deps ─────
console.log('==> Step 2: Creating private package stubs...');

const privatePackagePrefixes = [
  '@ant/', '@anthropic-ai/mcpb', '@anthropic-ai/sandbox-runtime',
  '@anthropic-ai/claude-agent-sdk', 'color-diff-napi'
];
const packageImports = new Map<string, Set<string>>();

for (const file of walkDir(srcDir)) {
  const content = readFileSync(file, 'utf-8');
  let m;

  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = re.exec(content)) !== null) {
    const pkg = m[2];
    if (!privatePackagePrefixes.some(p => pkg.startsWith(p))) continue;
    if (!packageImports.has(pkg)) packageImports.set(pkg, new Set());
    const set = packageImports.get(pkg)!;
    for (const part of m[1].split(',')) {
      let name = part.trim().replace(/^type\s+/, '');
      if (!name) continue;
      const asMatch = name.match(/^(\w+)\s+as\s+/);
      if (asMatch) name = asMatch[1];
      set.add(name);
    }
  }

  const re2 = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = re2.exec(content)) !== null) {
    if (m[1] === 'type') continue;
    if (!privatePackagePrefixes.some(p => m[2].startsWith(p))) continue;
    if (!packageImports.has(m[2])) packageImports.set(m[2], new Set());
    packageImports.get(m[2])!.add('__default__');
  }

  const re3 = /import\s+(\w+)\s*,\s*\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = re3.exec(content)) !== null) {
    if (!privatePackagePrefixes.some(p => m[3].startsWith(p))) continue;
    if (!packageImports.has(m[3])) packageImports.set(m[3], new Set());
    const set = packageImports.get(m[3])!;
    set.add('__default__');
    for (const part of m[2].split(',')) {
      let name = part.trim().replace(/^type\s+/, '');
      if (!name) continue;
      set.add(name);
    }
  }
}

const proxyHelper = `
const handler = {
  get(t, p) {
    if (p === Symbol.toPrimitive) return () => '';
    if (p === Symbol.iterator) return undefined;
    if (typeof p === 'symbol') return undefined;
    return new Proxy(function(){return undefined}, handler);
  },
  apply() { return undefined; },
  construct() { return new Proxy({}, handler); },
  has() { return true; },
};
function stub() { return new Proxy(function(){return undefined}, handler); }
`;

let pkgStubCount = 0;
for (const [pkg, names] of packageImports) {
  const pkgDir = join(nodeModules, ...pkg.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  const lines: string[] = ['// Auto-generated ESM stub with proxy support', proxyHelper];
  const namedExports = [...names].filter(n => n !== '__default__');
  for (const name of namedExports) {
    lines.push(`export const ${name} = stub();`);
  }
  if (names.has('__default__')) {
    lines.push(`export default stub();`);
  }
  writeFileSync(join(pkgDir, 'index.js'), lines.join('\n') + '\n');
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: pkg, version: '0.0.0', main: 'index.js', type: 'module'
  }));
  pkgStubCount++;
}
console.log(`   Created ${pkgStubCount} package stubs`);

// ─── Step 3: Create TungstenTool stub ──────────────────────
const tungstenPath = join(srcDir, 'tools', 'TungstenTool', 'TungstenTool.ts');
if (!existsSync(tungstenPath)) {
  mkdirSync(dirname(tungstenPath), { recursive: true });
  writeFileSync(tungstenPath, '// Stub: TungstenTool is ant-internal only\nexport const TungstenTool = null;\n');
  console.log('   Created TungstenTool stub');
}

// ─── Step 4: Two-phase build ─────────────────────────────
// Phase 1: Bundle to single JS using Bun.build() API with proper define & plugin
// Phase 2: Compile the bundled JS into a standalone executable
console.log('==> Step 4: Phase 1 - Bundling with Bun.build() API...');

const target = process.env.BUILD_TARGET || `bun-${process.platform}-${process.arch}`;
const outName = process.platform === 'win32' ? 'claude.exe' : 'claude';
const outDir = join(ROOT, 'dist');
const buildDir = join(ROOT, '.build');
mkdirSync(outDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });

// Packages with native bindings — mark as external
const externalPackages = [
  'sharp',
  'modifiers-napi',
];

// React production plugin: intercept react/react-reconciler imports
// and resolve them to the production CJS builds directly
const reactProductionPlugin: import('bun').BunPlugin = {
  name: 'react-production',
  setup(build) {
    const reactPkgs = ['react', 'react-reconciler'];
    for (const pkg of reactPkgs) {
      // Intercept the main package import
      build.onResolve({ filter: new RegExp(`^${pkg}$`) }, (args) => {
        return { path: join(nodeModules, pkg, 'cjs', `${pkg}.production.js`) };
      });
      // Intercept subpath imports like react/jsx-runtime
      build.onResolve({ filter: new RegExp(`^${pkg}/`) }, (args) => {
        const subpath = args.path.replace(`${pkg}/`, '');
        // Map subpath to production CJS file
        const cjsName = `${pkg}-${subpath.replace(/\//g, '-')}.production.js`;
        const cjsPath = join(nodeModules, pkg, 'cjs', cjsName);
        if (existsSync(cjsPath)) {
          return { path: cjsPath };
        }
        // Fallback: let default resolution handle it
        return undefined;
      });
    }
  },
};

const bundleResult = await Bun.build({
  entrypoints: [join(ROOT, 'src', 'entrypoints', 'cli.tsx')],
  outdir: buildDir,
  target: 'bun',
  minify: false,
  sourcemap: 'none',
  define: {
    'MACRO.VERSION': JSON.stringify('2.1.114'),
    'MACRO.GIT_HASH': JSON.stringify('dev-cn'),
    'MACRO.BUILD_ID': JSON.stringify('dev-cn'),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  external: externalPackages,
  plugins: [reactProductionPlugin],
});

if (!bundleResult.success) {
  console.error('\n❌ Phase 1 bundle failed:');
  for (const log of bundleResult.logs) {
    console.error('  ', log.message);
  }
  process.exit(1);
}

const bundledFile = join(buildDir, 'cli.js');
console.log(`   Bundled to ${bundledFile} (${(statSync(bundledFile).size / 1024 / 1024).toFixed(1)} MB)`);

// Verify no development React code
const bundledContent = readFileSync(bundledFile, 'utf-8');
if (bundledContent.includes('react.development.js') || bundledContent.includes('react-reconciler.development.js')) {
  console.warn('   ⚠️ WARNING: Development React code detected in bundle!');
} else {
  console.log('   ✅ No development React code in bundle');
}

// Phase 2: Compile to executable
console.log('==> Step 5: Phase 2 - Compiling to executable...');

const compileArgs = [
  'build',
  bundledFile,
  '--compile',
  `--target=${target}`,
  `--outfile=${join(outDir, outName)}`,
];

console.log(`   Running: bun ${compileArgs.join(' ')}`);
const result = spawnSync('bun', compileArgs, {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});

if (result.status === 0) {
  console.log(`\n✅ Build complete: dist/${outName}`);
} else {
  console.error(`\n❌ Phase 2 compile failed (exit code ${result.status})`);
  process.exit(1);
}
