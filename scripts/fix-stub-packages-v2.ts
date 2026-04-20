// Fix all stub packages to export proxy objects instead of undefined
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const srcDir = join(import.meta.dir, '..', 'src');
const nodeModules = join(import.meta.dir, '..', 'node_modules');

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

const privatePackagePrefixes = ['@ant/', '@anthropic-ai/mcpb', '@anthropic-ai/sandbox-runtime', '@anthropic-ai/claude-agent-sdk', 'color-diff-napi'];
const packageImports = new Map<string, Set<string>>();

for (const file of walkDir(srcDir)) {
  const content = readFileSync(file, 'utf-8');
  
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m;
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
    const pkg = m[2];
    if (m[1] === 'type') continue;
    if (!privatePackagePrefixes.some(p => pkg.startsWith(p))) continue;
    if (!packageImports.has(pkg)) packageImports.set(pkg, new Set());
    packageImports.get(pkg)!.add('__default__');
  }

  const re3 = /import\s+(\w+)\s*,\s*\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = re3.exec(content)) !== null) {
    const pkg = m[3];
    if (!privatePackagePrefixes.some(p => pkg.startsWith(p))) continue;
    if (!packageImports.has(pkg)) packageImports.set(pkg, new Set());
    const set = packageImports.get(pkg)!;
    set.add('__default__');
    for (const part of m[2].split(',')) {
      let name = part.trim().replace(/^type\s+/, '');
      if (!name) continue;
      set.add(name);
    }
  }
}

// Generate stubs with proxy objects that tolerate property access
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
    name: pkg,
    version: '0.0.0',
    main: 'index.js',
    type: 'module'
  }));
  
  console.log(`Fixed: ${pkg} (${namedExports.length} exports)`);
}
