# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file is committed and public. Never put secrets, tokens, credentials,
internal URLs, host paths, or anything else here that must not appear in a
public repository. Keep it to architecture and commands.

## Commands

```sh
npm run build          # minify CSS, bundle JS into dist/, then render the demo
npm test               # unit + browser
npm run test:unit      # node --test test/*.test.js
npm run test:browser   # playwright; rebuilds dist/ and the demo first
npm run serve          # static server on :4173, serves the repo root
```

Single tests:

```sh
node --test test/motion.test.js
node --test --test-name-pattern='wraps into' test/motion.test.js
npx playwright test -g 'turns around'
```

`test:browser` has a `pretest:browser` hook that runs the build. The demo
loads `demo/wake-marquee.js`, copied from `dist/`, so without that hook the
browser tests silently run against whatever was built last and report bugs
that were fixed in `src/` an hour ago.

## Architecture

A runtime library, unlike its sibling `split-reveal`: the loop has to run on
its own *and* be steered by the scroll, and no CSS property does both.

```
src/motion.js    pure arithmetic, no DOM. Every function has a unit test.
src/marquee.js   the DOM, the observers, and the one shared rAF loop.
src/auto.js      side-effect entry point: initMarquees() on DOM ready.
```

The split is not decoration. `marquee.js` cannot be unit tested without a
browser, so anything that can be expressed as numbers lives in `motion.js`
and is tested there. Moving maths back into `marquee.js` moves it out of the
test suite.

### The DOM the library builds

```
[data-wake-marquee]     the caller's element. Clips. Its box is the geometry
  .wake-track           the wake layer, overhung by `wake` % on either side
    .wake-lane          the caller's children, moved here
    .wake-lane          clones, added on first sight
```

The caller writes only the container and its items. Building the rest in JS
is what keeps the unenhanced page honest: without a script the children sit
in a plain clipped flex row, which is exactly the resting state under
`prefers-reduced-motion`.

### Invariants that have tests

- **The lane's width is the loop period.** It may not shrink, wrap, or gain
  spacing from `gap` on the row. The space after the last item is a
  `margin-inline-end` on the item, so it belongs to the lane and the seam
  between two lanes matches the space inside one.
- **The wake never exceeds the overhang.** `wakeOffset` is bounded by
  `amplitude`, and the track is exactly that much wider on each side. Break
  the bound and the end of the row comes into view. Guarded by
  `the wake never spends more than its overhang`.
- **The lanes always cover the track.** `laneCount` is
  `ceil(track / period) + 2`, derived in the doc comment. One fewer and a gap
  crosses the row once per period.
- **Reads never interleave with writes.** `frame()` runs every instance's
  `read()` before any `write()`. `scrollY` and `scrollTop` are layout reads,
  which is why `sampleScroll()` (reads) and `scrollSign()` (map lookup) are
  separate functions rather than one convenient one.

### Details that look like mistakes

- **The double modulo in `advance`.** JavaScript's `%` keeps the sign of the
  dividend, so a single one returns a negative offset the moment the row runs
  backwards, and the lanes jump a period sideways. Test: `wraps into
  [0, period) travelling backwards`.
- **The exponential in `easeDirection`.** A per-frame lerp converges at
  whatever rate the display refreshes at, so a reversal is twice as fast at
  120 Hz. Test: `reaches the same place at 60 and at 120 frames per second`.
- **`data-wake-direction` is the option, `data-wake-travel` is the status.**
  They were one attribute at first. The first frame overwrote `"right"` with
  `"forward"`, and the next `initMarquees()` over fresh content read
  `"forward"` back as a direction and threw.
- **`isInitialised()` checks for `.wake-track`, not the attribute.**
  `data-wake-marquee` is also the stylesheet's hook, so it is in the markup
  long before any script runs. `destroy()` only removes it if the library
  added it.
- **Clones get `loading="eager"`.** A clone starts off to the right of the
  track and is translated in, so a lazy image there never reaches its loading
  threshold and arrives as a hole in the row.
- **Cloning happens on first sight, not at construction.** It is why the
  coverage test has to walk the whole page first.

### Generated and committed files

- `dist/` is **committed** so the package installs straight from git. The
  `dist-is-current` CI job runs `git diff --exit-code -- dist/`, so any edit
  to `src/` must be followed by `npm run build` and a commit of `dist/`.
- `demo/index.html`, `demo/wake-marquee.css` and `demo/wake-marquee.js` are
  gitignored build output. The demo is also the Playwright fixture: every
  option appears in one of its sections, so a new option is only finished
  once something on that page exercises it.

## Conventions

- Node ESM, no TypeScript. Types are JSDoc; keep them current, they are the
  only type surface consumers get.
- Zero runtime dependencies is a hard constraint. `esbuild` and
  `@playwright/test` are dev-only.
- All CSS lives inside `@layer wake-marquee`. Do not add rules outside it.
- The library owns loop geometry and nothing else. No colours, no sizes, no
  opinions about how items look.
- Comments explain *why* a non-obvious choice was made. Match that.

## Release

Tag `vX.Y.Z` matching `package.json`; `release.yml` publishes via npm OIDC
trusted publishing (no token). The workflow fails if tag and version disagree,
and skips a version already on the registry. The first publish is manual, from
a laptop, because the trusted publisher cannot be configured until the package
exists. Update `CHANGELOG.md` as part of the change, not afterwards.
