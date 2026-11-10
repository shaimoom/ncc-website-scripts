// Builds dist/: a comment-free, minified mirror of js/, css/ and vendor/three/.
// The site loads dist/. Edit the commented sources, then run `npm run build` and commit both.
// Same file names as the sources, so relative imports ('./tree-gen.js', './Pass.js') and the
// import map's 'three/addons/' prefix resolve to minified files. Only license comments are kept.
import { readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import CleanCSS from 'clean-css';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const MODULES = new Set(['js/hero-tree.js', 'js/tree-gen.js', 'js/approach-plant.js']);
const LICENSE = /@license|@preserve|^!/;

// GLSL inside template literals marked /* glsl */ (the three.js convention, used by every shader here): drop
// // and /* */ comments and blank lines. GLSL has no string literals, so a comment marker there is always a comment.
const stripGlsl = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '').join('\n');
const glsl = src => src.replace(/\/\*\s*glsl\s*\*\/\s*`([^`]*)`/g, (m, body) => '`' + stripGlsl(body) + '`');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

async function js(rel, module) {
  const src = glsl(await readFile(join(root, rel), 'utf8'));
  const r = await minify(src, {
    module,
    ecma: 2020,
    compress: { passes: 1 },
    mangle: true,
    format: { comments: LICENSE },
  });
  return r.code;
}

async function out(rel, text) {
  const p = join(dist, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, text);
}

await rm(dist, { recursive: true, force: true });
const report = [];
for (const rel of (await readdir(join(root, 'js'))).filter(f => f.endsWith('.js')).map(f => 'js/' + f)) {
  const code = await js(rel, MODULES.has(rel));
  await out(rel, code + '\n');
  report.push([rel, (await readFile(join(root, rel))).length, code.length + 1]);
}
{
  const rel = 'css/ncc-motion.css';
  const src = await readFile(join(root, rel), 'utf8');
  const r = new CleanCSS({ level: 1 }).minify(src);
  if (r.errors.length) throw new Error(r.errors.join('\n'));
  await out(rel, r.styles + '\n');
  report.push([rel, src.length, r.styles.length + 1]);
}
for (const p of await walk(join(root, 'vendor/three'))) {
  const rel = relative(root, p);
  if (rel.endsWith('three.module.min.js') || !rel.endsWith('.js')) {
    await mkdir(dirname(join(dist, rel)), { recursive: true });
    await copyFile(p, join(dist, rel));
    continue;
  }
  const code = await js(rel, true);
  await out(rel, code + '\n');
  report.push([rel, (await readFile(p)).length, code.length + 1]);
}
let a = 0, b = 0;
for (const [f, s, m] of report) { a += s; b += m; console.log(f.padEnd(58), String(s).padStart(7), '->', String(m).padStart(7)); }
console.log('total'.padEnd(58), String(a).padStart(7), '->', String(b).padStart(7));
