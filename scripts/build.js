/**
 * Build dist/.
 *
 * Three artefacts, because there are three ways people actually install this:
 *
 *   wake-marquee.css       the stylesheet, minified
 *   wake-marquee.js        ESM bundle, for an import map or a CDN
 *   wake-marquee.auto.js   classic script, starts every marquee on the page
 *
 * Bundler users get none of these: the package entry points at src/, so their
 * own build reads the annotated source and tree-shakes it.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';

const src = new URL('../src/', import.meta.url);
const outDir = new URL('../dist/', import.meta.url);
await mkdir(outDir, { recursive: true });

/** @param {string} name @param {string} code */
async function emit(name, code) {
  await writeFile(new URL(name, outDir), code);
  const gzip = gzipSync(Buffer.from(code), { level: 9 }).length;
  console.log(`dist/${name.padEnd(22)} ${String(code.length).padStart(6)} B raw  ${String(gzip).padStart(5)} B gzip`);
}

// No `target` on the CSS. Lowering would rewrite the very features the
// stylesheet is built on, cascade layers among them.
const css = await readFile(new URL('wake-marquee.css', src), 'utf8');
const { code: minified } = await transform(css, { loader: 'css', minify: true, legalComments: 'inline' });
await emit('wake-marquee.css', minified);

/**
 * @param {string} entry
 * @param {'esm' | 'iife'} format
 * @param {string} [globalName]
 */
async function bundle(entry, format, globalName) {
  const result = await build({
    entryPoints: [new URL(entry, src).pathname],
    bundle: true,
    minify: true,
    format,
    globalName,
    // The library leans on IntersectionObserver, ResizeObserver and inert.
    // Nothing older than this has all three, so lowering would only grow the
    // file for browsers that could not run it anyway.
    target: ['es2020'],
    write: false,
    legalComments: 'inline',
  });
  return result.outputFiles[0].text;
}

await emit('wake-marquee.js', await bundle('marquee.js', 'esm'));
await emit('wake-marquee.auto.js', await bundle('auto.js', 'iife', 'WakeMarquee'));
