/**
 * Renders demo/index.html.
 *
 * The demo loads the built files out of demo/ rather than reaching into src/,
 * because the GitHub Pages workflow uploads this directory alone. Anything it
 * imports from outside would 404 in production and pass locally, which is the
 * worst way round for a bug to sit.
 *
 * It doubles as the Playwright fixture: every option the library takes appears
 * in one of the sections below, so a new option is only wired up once it has
 * something exercising it.
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const here = import.meta.url;
await copyFile(new URL('../dist/wake-marquee.css', here), new URL('wake-marquee.css', here));
await copyFile(new URL('../dist/wake-marquee.js', here), new URL('wake-marquee.js', here));

/**
 * The headline figure, weighed rather than remembered. Written down by hand it
 * is wrong the first time anything is added and nobody notices, which is the
 * one number on the page a reader is entitled to trust.
 */
const gzipped = gzipSync(await readFile(new URL('wake-marquee.js', here)), { level: 9 }).length;
const size = `${(gzipped / 1000).toFixed(1)} kB`;

/**
 * A wordmark as a data URI, so the demo needs no network and no binary assets
 * in the repository, while still being made of real <img> elements: that is
 * what exercises the clone path's lazy-loading fix.
 *
 * SVG is XML, so the label is escaped before it goes in, and the whole
 * document is URI-encoded afterwards rather than by hand. A raw `&` in a
 * brand name is enough to make the document invalid and the image blank.
 *
 * @param {string} label
 * @param {number} width
 */
const wordmark = (label, width) => {
  const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48" viewBox="0 0 ${width} 48">` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="47" rx="6" fill="none" stroke="#888" stroke-opacity="0.45"/>` +
    `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" ` +
    `font-family="ui-sans-serif,system-ui,sans-serif" font-size="17" font-weight="600" ` +
    `letter-spacing="1.5" fill="#888">${escaped}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const BRANDS = [
  ['NORDLICHT', 150],
  ['KVIST', 110],
  ['HALDEN & CO', 175],
  ['MERIDIAN', 145],
  ['SAAL', 95],
  ['OSTWIND', 135],
  ['BRÜNN', 110],
  ['LAVENDER', 155],
];

const logos = BRANDS.map(
  ([label, width]) =>
    `<img src="${wordmark(label, width)}" alt="${label}" width="${width}" height="48" loading="lazy">`,
).join('\n      ');

const words = (items) => items.map((w) => `<span class="word">${w}</span>`).join('\n      ');

const sections = [
  {
    id: 'logos',
    label: 'the ordinary case',
    note: 'A logo row. <code>fade</code> softens both edges so items are never cut mid-glyph, and <code>wake: 10</code> means the scroll drags the row against its own travel as the section crosses the viewport.',
    html: `<div id="logos-row" data-wake-marquee data-wake-speed="55" data-wake="10" data-wake-gap="4.5rem" data-wake-fade="7rem" style="--wake-gap:4.5rem;--wake-fade:7rem" aria-label="Brands we stock">
      ${logos}
    </div>`,
  },
  {
    id: 'wake',
    label: 'wake: 0 against wake: 18',
    note: 'The same row twice, at the same speed, differing only in wake. The top row is a plain loop and reads as decoration. The bottom row is being pulled through the page, and stops looking like a banner.',
    html: `<div id="wake-none" data-wake-marquee data-wake-speed="60" data-wake="0" data-wake-gap="3rem" style="--wake-gap:3rem">
      ${words(['no wake', 'constant', 'a banner', 'playing on a loop', 'ignores you', 'wake: 0'])}
    </div>
    <div class="spacer"></div>
    <div id="wake-strong" data-wake-marquee data-wake-speed="60" data-wake="18" data-wake-gap="3rem" style="--wake-gap:3rem">
      ${words(['with wake', 'dragged', 'has weight', 'answers the scroll', 'knows you are there', 'wake: 18'])}
    </div>`,
  },
  {
    id: 'reverse',
    label: 'the turn',
    note: 'Scroll up. The top row turns around and the bottom one does not. The turn is eased over <code>ease</code>, not switched, so the row reads as something with momentum rather than a video played backwards.',
    html: `<div id="reverse-on" data-wake-marquee data-wake-direction="right" data-wake-speed="70" data-wake="8" data-wake-ease="2.5" data-wake-gap="3rem" style="--wake-gap:3rem">
      ${words(['scroll up', 'and I turn', 'eased, not switched', 'ease: 2.5', '↺'])}
    </div>
    <div class="spacer"></div>
    <div id="reverse-off" data-wake-marquee data-wake-reverse="false" data-wake-speed="70" data-wake="8" data-wake-gap="3rem" style="--wake-gap:3rem">
      ${words(['I keep going', 'reverse: false', 'still has a wake', 'just no turn', '→'])}
    </div>`,
  },
  {
    id: 'counter',
    label: 'two rows against each other',
    note: 'The commonest marquee layout, and the one where the wake earns its keep: the two rows are dragged in opposite directions, because the wake always pulls against travel. Scroll and the pair opens and closes like a pair of shears.',
    html: `<div id="counter-left" data-wake-marquee data-wake-speed="45" data-wake="14" data-wake-gap="3rem" style="--wake-gap:3rem">
      ${words(['Seit 1906', 'Künzelsau', 'Hohenlohe', 'Vier Generationen'])}
    </div>
    <div class="spacer"></div>
    <div id="counter-right" data-wake-marquee data-wake-direction="right" data-wake-speed="45" data-wake="14" data-wake-gap="3rem" style="--wake-gap:3rem">
      ${words(['Damenmode', 'Herrenmode', 'Stilberatung', 'Änderungen'])}
    </div>`,
  },
  {
    id: 'few',
    label: 'three items',
    note: 'A lane narrower than the container, repeated until it covers one. This is where a hand-rolled marquee usually breaks: too few copies and a gap crosses the row once per lap, and the number needed changes with the viewport. The count is derived, not configured.',
    html: `<div id="few-items" data-wake-marquee data-wake-speed="50" data-wake="8" data-wake-gap="5rem" style="--wake-gap:5rem">
      ${words(['Damenmode', 'Herrenmode', 'Stilberatung'])}
    </div>`,
  },
  {
    id: 'pace',
    label: 'speed: 8% against speed: 60',
    note: 'Narrow the window. The top row slows down with it and the bottom one does not. A pixel speed is a physical unit on a page whose elements are not physically constant: the same <code>60</code> that reads as calm across a desktop crosses a phone in a third of the time, with the items scaled down and three times as many of them going past a second. A percentage is a fraction of the container width per second, so the pace survives the trip.',
    html: `<div id="pace-relative" data-wake-marquee data-wake-speed="8%" data-wake="10" data-wake-gap="3rem" style="--wake-gap:3rem">
      ${words(['speed: 8%', 'of the container', 'every second', 'narrow the window', 'and I slow down with it'])}
    </div>
    <div class="spacer"></div>
    <div id="pace-fixed" data-wake-marquee data-wake-speed="60" data-wake="10" data-wake-gap="3rem" style="--wake-gap:3rem">
      ${words(['speed: 60', 'pixels a second', 'whatever the window', 'and on a phone', 'that is a different row'])}
    </div>`,
  },
  {
    id: 'hover',
    label: 'pauseOnHover',
    note: 'Rest the pointer on the row. Only where there is a real pointer to rest: on touch there is no hover to leave again, so the option is ignored rather than trapping the row in a paused state.',
    html: `<div id="hover-row" data-wake-marquee data-wake-pause-on-hover data-wake-speed="80" data-wake="6" data-wake-gap="3rem" style="--wake-gap:3rem">
      ${words(['hover me', 'and I hold', 'pointer: fine only', 'let go', 'and I resume'])}
    </div>`,
  },
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wake-marquee</title>
<meta name="description" content="An endless marquee that answers to the scroll: it reverses when the reader scrolls back, and drags against its own direction of travel as it crosses the viewport.">
<link rel="stylesheet" href="./wake-marquee.css">
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa;
    --fg: #16161a;
    --muted: #6f6f78;
    --rule: #e2e2df;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0d0d0e; --fg: #f3f1ed; --muted: #8a8578; --rule: #24242a; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }
  .wrap { max-width: 62rem; margin: 0 auto; padding: 0 1.5rem; }
  .bleed { max-width: none; padding: 0; }
  header { padding: 20vh 0 10vh; }
  h1 { font-size: clamp(2.5rem, 8vw, 5rem); line-height: 0.95; letter-spacing: -0.03em; margin: 0 0 1.5rem; }
  .tagline { font-size: clamp(1.05rem, 2.4vw, 1.35rem); color: var(--muted); max-width: 36em; margin: 0 0 2rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  pre {
    background: color-mix(in srgb, var(--fg) 5%, transparent);
    border: 1px solid var(--rule);
    border-radius: 10px;
    padding: 1rem 1.15rem;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
    line-height: 1.7;
  }
  section { padding: 22vh 0 10vh; border-top: 1px solid var(--rule); }
  .label {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted); margin: 0 0 1.75rem;
  }
  .note { color: var(--muted); max-width: 42em; margin: 2rem 0 0; font-size: 0.95rem; }
  .stat {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem; padding: 0.5rem 0.75rem; border: 1px solid var(--rule);
    border-radius: 999px; display: inline-block; color: var(--muted); margin: 0 0 2rem;
  }
  .spacer { height: 1.5rem; }
  /* The rows themselves. wake-marquee styles none of this: it owns the loop
     geometry and nothing about how the items look. */
  [data-wake-marquee] { padding-block: 0.5rem; }
  .word {
    font-size: clamp(1.6rem, 5vw, 3rem);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
    white-space: nowrap;
  }
  #wake-none .word, #reverse-off .word, #pace-fixed .word { color: var(--muted); }
  #logos-row img { display: block; opacity: 0.9; }
  footer { padding: 14vh 0 8vh; color: var(--muted); font-size: 0.9rem; border-top: 1px solid var(--rule); }
  a { color: inherit; }
  @media (prefers-reduced-motion: reduce) {
    .reduced-notice { display: block !important; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>wake-marquee</h1>
    <p class="tagline">An endless marquee that answers to the scroll. It reverses when the reader scrolls back, and drags against its own direction of travel as it crosses the viewport.</p>
    <p class="stat" data-stat>${size} gzipped · 0 dependencies</p>
    <pre><code>npm i wake-marquee</code></pre>
    <p class="note reduced-notice" style="display:none">
      You have <code>prefers-reduced-motion: reduce</code> set, so every row below is standing still. That is the library honouring it, not a bug.
    </p>
  </header>
</div>

${sections
  .map(
    (s) => `<section id="${s.id}">
  <div class="wrap"><p class="label">${s.label}</p></div>
  <div class="wrap bleed">
    ${s.html}
  </div>
  <div class="wrap"><p class="note">${s.note}</p></div>
</section>`,
  )
  .join('\n\n')}

<footer>
  <div class="wrap">
    <p>MIT · <a href="https://github.com/robin-gogolok/wake-marquee">github.com/robin-gogolok/wake-marquee</a></p>
  </div>
</footer>

<script type="module">
  import { initMarquees } from './wake-marquee.js';
  // Every row on this page is configured by its own data-wake-* attributes,
  // so one call is the whole integration. The handles are put on window for
  // the browser tests to reach.
  window.marquees = initMarquees();
</script>
</body>
</html>
`;

await writeFile(new URL('index.html', here), html);
console.log(`demo/index.html         ${String(html.length).padStart(6)} B`);
