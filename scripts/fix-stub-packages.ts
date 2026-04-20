// Fix all stub packages in node_modules to be proper ESM with named exports
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

const srcDir = join(import.meta.dir, '..', 'src');
const nodeModules = join(import.meta.dir, '..', 'node_modules');

// Collect all named imports from each package
const packageImports = new Map<string, Set<string>>();

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

for (const file of walkDir(srcDir)) {
  const content = readFileSync(file, 'utf-8');
  
  // Match: import { A, B } from 'pkg' and import type { A } from 'pkg'
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const names = m[1];
    const pkg = m[2];
    if (!privatePackagePrefixes.some(p => pkg.startsWith(p))) continue;
    
    if (!packageImports.has(pkg)) packageImports.set(pkg, new Set());
    const set = packageImports.get(pkg)!;
    for (const part of names.split(',')) {
      let name = part.trim().replace(/^type\s+/, '');
      if (!name) continue;
      const asMatch = name.match(/^(\w+)\s+as\s+/);
      if (asMatch) name = asMatch[1];
      set.add(name);
    }
  }
  
  // Match: import X from 'pkg'
  const re2 = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = re2.exec(content)) !== null) {
    const name = m[1];
    const pkg = m[2];
    if (name === 'type') continue;
    if (!privatePackagePrefixes.some(p => pkg.startsWith(p))) continue;
    if (!packageImports.has(pkg)) packageImports.set(pkg, new Set());
    packageImports.get(pkg)!.add(`__default__`);
  }

  // import X, { A } from 'pkg'
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

// Generate proper ESM stubs
for (const [pkg, names] of packageImports) {
  const pkgDir = join(nodeModules, ...pkg.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  
  const lines: string[] = ['// Auto-generated ESM stub'];
  const namedExports = [...names].filter(n => n !== '__default__');
  
  for (const name of namedExports) {
    lines.push(`export const ${name} = undefined;`);
  }
  
  if (names.has('__default__')) {
    lines.push(`export default {};`);
  }
  
  if (namedExports.length === 0 && !names.has('__default__')) {
    lines.push('export {};');
  }
  
  writeFileSync(join(pkgDir, 'index.js'), lines.join('\n') + '\n');
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: pkg,
    version: '0.0.0',
    main: 'index.js',
    type: 'module'
  }));
  
  console.log(`Fixed: ${pkg} (${namedExports.length} named exports)`);
}
