# wake-marquee

An endless marquee that answers to the scroll. It reverses when the reader scrolls back, and drags against its own direction of travel as it crosses the viewport.

**[Live demo →](https://robin-gogolok.github.io/wake-marquee/)**

```
3.5 kB  gzipped JS
0.4 kB  gzipped CSS
  0     runtime dependencies
  1     rAF loop, however many rows are on the page
```

A row of logos that plays on a loop is wallpaper. The reader learns in two seconds that it will never do anything, and stops looking. This makes the row part of the page instead: it has momentum, it turns around when they do, and it is visibly being dragged through the scroll.

---

## Why this exists

A CSS marquee is four lines and costs nothing, and for a lot of pages that is the right answer. It also has nothing to say to the reader. Nothing about it changes whether they are moving, still, or heading back up.

The scroll-linked half of this cannot be done in CSS today. `animation-timeline: scroll()` can drive an animation from the scroll position, but not an animation that also runs on its own, in a direction the scroll only influences. That needs a frame loop.

So this is a frame loop, kept as small as one can honestly be:

- **One `requestAnimationFrame` for the whole page.** Ten rows share it. It reads every element's geometry before it writes any transform, so a frame costs one layout rather than one per row.
- **It stops when nothing is on screen.** An idle rAF loop still keeps the compositor awake, and that shows up on a battery.
- **Nothing is measured or cloned until a row is actually seen.** A page with a row in the footer does no work for it until the reader gets there.

## Install

```sh
npm i wake-marquee
```

## Use

Import the stylesheet once, anywhere in your app:

```js
import 'wake-marquee/css'
```

Write the container and its items. The direct children become the items; the library builds everything else.

```html
<div data-wake-marquee data-wake-speed="55" data-wake="10" data-wake-fade="6rem">
  <img src="/logos/a.svg" alt="Nordlicht" width="150" height="48">
  <img src="/logos/b.svg" alt="Kvist" width="110" height="48">
  <img src="/logos/c.svg" alt="Halden & Co" width="175" height="48">
</div>
```

Then either start every row on the page in one line:

```js
import 'wake-marquee/auto'
```

or take a handle and drive it yourself:

```js
import { createMarquee } from 'wake-marquee'

const row = createMarquee(document.querySelector('#logos'), {
  direction: 'left',
  speed: 55,
  wake: 10,
})
```

### Astro

```astro
---
import WakeMarquee from 'wake-marquee/astro'
---
<WakeMarquee speed="8%" wake={10} fade="6rem" aria-label="Brands we stock">
  {brands.map((b) => <img src={b.logo} alt={b.name} width={b.width} height={48} />)}
</WakeMarquee>
```

The component's script starts the row and keeps no handle, because a hoisted
Astro script has nowhere to hand one to. Ask for it by element instead:

```js
import { getMarquee } from 'wake-marquee'

getMarquee(document.querySelector('#logos'))?.pause()
```

### React

The library takes an element, so a ref and an effect are the whole integration. No adapter package.

```jsx
import { useEffect, useRef } from 'react'
import { createMarquee } from 'wake-marquee'
import 'wake-marquee/css'

function Marquee({ children, ...options }) {
  const ref = useRef(null)

  useEffect(() => {
    const row = createMarquee(ref.current, options)
    return () => row.destroy()
    // Options are read once at construction; change the key to rebuild.
  }, [])

  return <div ref={ref} data-wake-marquee>{children}</div>
}
```

`destroy()` puts the DOM back exactly as it found it, which is what makes this safe under React 18's double-invoked effects in development.

## What the wake is

The row does two things at once.

The **loop** is the ordinary part: lanes of content translate sideways by up to one lane width, then snap back. The snap is invisible because it lands exactly one repeat of the content later.

The **wake** is the part worth having. The layer holding those lanes is built wider than its container by `wake` percent on each side, and the scroll spends precisely that reserve as the element crosses the viewport:

```
        element enters                centre                element leaves
              │                          │                          │
  track  ├────┼──────────────────────────┼──────────────────────────┼────┤
         └ overhang                                          overhang ┘
              →  →  →                    ·                    ←  ←  ←
         held back against its travel   zero      pulled the other way
```

Because the displacement is bounded by exactly the overhang the track was given, the ends of the row can never come into view, at any scroll position or scroll speed. That bound is a unit test, not a hope.

Set `wake: 0` and you have a plain loop. Around `8` is a row that feels attached to the page; past `20` it reads as an effect in its own right.

## The turn

When the reader scrolls up, the row turns around. Not by flipping a sign, which looks like a video played backwards, but by easing the direction factor from `+1` to `-1` over `ease` seconds. The row decelerates, stops, and picks up the other way, so it reads as something with mass.

The easing is framerate independent, so the same turn takes the same time on a 60 Hz laptop and a 120 Hz phone. (`current += (target - current) * 0.1` per frame, the usual lerp, would be twice as fast on the phone.)

Set `reverse: false` to keep a fixed heading and keep the wake.

## Speed that survives a phone

`speed: 150` is 150 pixels a second, and pixels a second is a physical unit on
a page whose elements are not physically constant. The same row of logos is
40px tall with a 72px gap on a desktop and 16px with a 32px gap on a phone, so
that one number crosses a 1440px container in nine and a half seconds and a
390px one in under three, with three times as many items going past. Calm on
the desktop, hectic on the phone, and no breakpoint anywhere in sight because
the mismatch is in the unit rather than in the value.

So `speed` also takes a percentage, meaning that fraction of the container
width per second:

```html
<div data-wake-marquee data-wake-speed="8%">
```

The width is the one measured every frame for the wake, so this costs nothing
and follows a resize, a rotation or a container that changes under the row.

A rate rather than a duration on purpose. "One container width per 9.6
seconds" reads well on its own and reverses the option on itself the moment it
sits beside the number form: `'12s'` would be slower than `'6s'` while `120` is
faster than `60`. It also invites the reading "per lap", which would be the
lane width, so adding one logo would slow the row down.

There is no floor. A percentage on a very narrow viewport is a very slow row,
and `8%` of 390px is 31 px/s, which may be slower than you want it. Pick the
percentage for the width you care about most and check the other end.

## Starting without a flash

A row has two lives: the static one the server sends, and the running one the
script builds. The handover between them is where marquees usually give
themselves away, jumping once or twice before they settle.

The library does its part. Measuring, cloning and the first transform all
happen in one task, so no half-built state is ever painted, and that first
frame is positioned to land on the same pixel the static row occupied rather
than wherever the loop's zero point falls. A row reached by anchor link, or a
reload at a restored scroll position, starts as cleanly as one scrolled to.

Two things are left to you, because both change the layout of the static row
before any script has run:

**Declare the spacing in CSS, not only in the attribute.** `data-wake-gap` is
read by the script, which means the static row is laid out with the default
`2rem` until then and the items shift when it runs.

```html
<div data-wake-marquee data-wake-gap="4.5rem" style="--wake-gap:4.5rem">
```

Same for `data-wake-fade` and `--wake-fade`. The library leaves a property
that is already set alone, so there is no conflict. `wake-marquee/astro` does
this for you.

**Give images `width` and `height`.** An unsized image is zero pixels wide
until it decodes, and the lane width is the loop period. A row of eight
unsized logos measures its gaps and nothing else at the first frame, then
grows into its real width one logo at a time.

The library will not start on a measurement like that: a row whose items
reserve no space waits for them, keeps standing as the static row the reader
was already looking at, and starts once. That is the safe behaviour, not the
good one, and it says so in the console. With the attributes there is nothing
to wait for and the row starts immediately.

## API

### `createMarquee(element, options?)`

Turns an element and its children into a marquee. Returns a handle.

| Option | Default | |
|---|---|---|
| `direction` | `'left'` | `'left'` or `'right'`, while scrolling down |
| `speed` | `60` | Pixels per second, or a percentage of the container width per second (`'8%'`) |
| `wake` | `8` | Scroll displacement, as a percentage of the container width. `0` turns it off |
| `reverse` | `true` | Whether scrolling up reverses travel |
| `ease` | `5` | How sharply a reversal settles, per second. Around `1` is a long, heavy turn |
| `gap` | `2rem` | Space between two items, any CSS length |
| `fade` | `false` | Soft edges left and right, any CSS length |
| `pauseOnHover` | `false` | Hold still while a real pointer rests on the row |
| `scroller` | `window` | What to read the scroll direction from |
| `respectMotionPreference` | `true` | Stay still under `prefers-reduced-motion: reduce` |

The handle:

| Member | |
|---|---|
| `element` | The element you passed in |
| `options` | The normalised options |
| `play()` | Resume. Does nothing under a reduced-motion preference |
| `pause()` | Hold the row where it is. The wake stops with it |
| `refresh()` | Re-measure and top up the clones. Call it after changing the items yourself |
| `destroy()` | Undo everything: clones, wrappers, observers, listeners, attributes |

### `getMarquee(element)`

The marquee running on an element, or `null`.

```js
import { getMarquee } from 'wake-marquee'

const row = getMarquee(document.querySelector('#logos'))
row?.pause()
```

`initMarquees()` returns only the instances that call created, which is the
right answer for something safe to call repeatedly and the wrong one for
anybody who needs a handle later: asking a second time over the same content
hands back an empty array, because every row is already running. This is the
way back in, and it is what makes the declarative path as capable as the
imperative one.

### `initMarquees({ root?, defaults? })`

Finds every `[data-wake-marquee]` under `root` and starts it, reading each element's own attributes for its options. Skips rows that are already running, so it is safe to call again after new content arrives. Returns only the handles it created.

```js
import { initMarquees } from 'wake-marquee'

initMarquees()                                   // the whole document
initMarquees({ root: panel, defaults: { wake: 4 } })  // scoped, with a house default
```

`defaults` sits under each element's own attributes, so the markup always wins.

### Attributes

Every option except `scroller` and `respectMotionPreference` can be declared in markup, which is what makes `wake-marquee/auto` a complete integration on its own.

| Attribute | Option |
|---|---|
| `data-wake-marquee` | Marks the container. Also the stylesheet's hook |
| `data-wake-direction="right"` | `direction` |
| `data-wake-speed="55"` or `"8%"` | `speed` |
| `data-wake="10"` | `wake` |
| `data-wake-ease="2.5"` | `ease` |
| `data-wake-gap="4rem"` | `gap` |
| `data-wake-fade="6rem"` | `fade` |
| `data-wake-reverse="false"` | `reverse` |
| `data-wake-pause-on-hover` | `pauseOnHover`, presence is the value |

The library writes two attributes back, for you to hang CSS off:

| | |
|---|---|
| `data-wake-active` | Present while the row is on screen and running |
| `data-wake-travel` | `forward` or `reversed`, following the reader |

```css
[data-wake-travel="reversed"] .item { color: var(--accent); }
```

### Without a bundler

```html
<link rel="stylesheet" href="https://unpkg.com/wake-marquee/dist/wake-marquee.css">
<script src="https://unpkg.com/wake-marquee/dist/wake-marquee.auto.js" defer></script>
```

Starts every `[data-wake-marquee]` on the page and leaves the API on `window.WakeMarquee`.

## Styling

The library owns the loop geometry and nothing else. Items look however you style them.

| Custom property | Default | |
|---|---|---|
| `--wake-gap` | `2rem` | Space after each item |
| `--wake-fade` | — | Width of the soft edge, when `fade` is on |

The spacing is a `margin-inline-end` on each item rather than `gap` on the row, and that is load-bearing rather than a style choice: **the lane's width is the loop's repeat distance**, so the space after the last item has to be part of the lane. With `gap`, there is no space between the last item of one lane and the first of the next, and the seam is visible on every pass.

### Cascade layers

All rules live in an `@layer wake-marquee` cascade layer, so your own unlayered CSS wins without `!important`. That is worth knowing in both directions, because the rule behind it is absolute: **an unlayered declaration beats a layered one whatever the specificity says.**

The one rule of the library's that this reaches is the item spacing. An ordinary global reset

```css
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
```

beats `margin-inline-end: var(--wake-gap)` at 0,0,0 against 0,1,0, and the gap collapses to zero. Nothing else gives it away: the row still loops, `--wake-gap` still resolves correctly in the devtools, and the items simply sit flush against one another. It reads as a mistake in your own stylesheet, so the library says so in the console when it sees it.

Put the reset in a layer, and declare the order before the library's import:

```css
@layer reset, wake-marquee;

@import "wake-marquee/css";

@layer reset {
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
}
```

The order declaration comes first and the imports come next, because `@import`
has to precede every rule that is not a layer statement. Where the reset is a
file of its own, `@import "reset.css" layer(reset);` does the same job.

The spacing stays in the layer rather than being lifted out of it, because it is also the rule you are most likely to want to override: a `me-10` utility or a class of your own on the items should win, and unlayered library CSS would beat both. The library measures whatever spacing ends up applied, so any of that is fine. What it cannot do is guess that you meant a gap and got none.

### Tailwind CSS v4

The same rule, the other way round. Declare the layer order before the imports, or the library will outrank every utility:

```css
@layer theme, base, components, wake-marquee, utilities;

@import "tailwindcss";
@import "wake-marquee/css";
```

A layer registered late wins, and an `@import` after `tailwindcss` registers `wake-marquee` after `utilities`. Declared up front, it sits where it belongs: your utilities still win.

## A row on its side

There is no vertical mode. Rotate the container:

```css
.edge {
  width: 30rem;   /* the edge it runs along, not its thickness */
  height: 2.75rem;
  transform-origin: 0 0;
  transform: rotate(90deg);
}
```

The loop is measured in the row's own coordinate system rather than off the screen, so a rotated row gets the period, the lane count, the wake and a percentage speed it would have had lying flat. Any angle works, and so does a `scale()` on the row or on anything above it.

The one thing to write down is `width`: for a row on its side that is the edge it travels along, and nothing in CSS infers it from the height of whatever it is framing. The demo frames a block with four rows, two of them turned.

## Accessibility

- **The content is announced once.** Clones are `inert` and `aria-hidden`, so a screen reader hears eight logos, not the forty that fill the track. Where `inert` is missing, focusable elements inside clones get `tabindex="-1"` instead, so they never become invisible tab stops.
- **Reduced motion is honoured live.** Under `prefers-reduced-motion: reduce` the row does not start, and if the reader turns the preference on while the page is open, it stops and resets. What is left is a static, clipped row: the same thing a reader with JavaScript off sees.
- **Only `transform` is animated**, on a layer that is promoted while the row is on screen and dropped when it leaves.
- Give the container an `aria-label` if the row means something (`aria-label="Brands we stock"`), or leave it off if it is decoration.

## Browser support

| | |
|---|---|
| Chrome / Edge | 99+ |
| Safari / iOS | 15.4+ |
| Firefox | 97+ |

The floor is cascade layers, which is what `@layer wake-marquee` needs. Everything else the library uses, `IntersectionObserver`, `ResizeObserver` and `matchMedia` change events, shipped well before that.

One exception: `inert` reached Firefox in 112. Below that, clones fall back to a `tabindex="-1"` sweep, which keeps them out of the tab order but not out of the accessibility tree.

Without JavaScript, or before it arrives, the row is a static line of items clipped at the container edge. That is the intended resting state, not a broken one, and it needs no script.

## Known limitations

### It needs JavaScript

There is no build-time or CSS-only version of this, and there cannot be one while the row has to both run on its own and be steered by the scroll. If a completely static row is unacceptable as the no-JS state, this is the wrong library.

### Items are cloned

Filling the track means copying the row until it covers the container, typically two to four times. That is cheap for images and text and expensive for anything with its own runtime: iframes, videos, canvases and framework components with state get copied along with everything else. Rows of that kind want a different approach.

### Left to right

A right-to-left writing mode is not supported: the flex rows follow the writing direction while the transforms are physical, so the two disagree and the loop runs the wrong way. An `rtl` page can still use this inside an `ltr` container. `writing-mode` is the same story, measured and written up in [BACKLOG.md](BACKLOG.md) along with what a fix would take. For a vertical row, rotate the container instead, which is supported.

### One measurement, one period

The lane is measured once per resize, and its width is the loop period. Content that changes its own width while the row is running, a counter ticking from 9 to 10, say, drifts the seam until the next `refresh()`. Call it yourself after changing the items.

## How it compares

| | Size | Scroll-linked | Needs JS |
|---|---|---|---|
| **wake-marquee** | 3.9 kB | yes, direction and displacement | yes |
| CSS `@keyframes` marquee | 0 | no | no |
| [Marquee3k](https://github.com/ezekielaquino/Marquee3000) | ~2 kB | no | yes |
| [react-fast-marquee](https://github.com/justin-chu/react-fast-marquee) | ~4 kB | no | yes, React only |
| GSAP + ScrollTrigger | ~50 kB | yes, with a full timeline API | yes |

If a plain loop is all you need, write the four lines of CSS. If you need a timeline, keyframes and scrubbing across a whole page, use GSAP. If you want a row that answers to the reader and nothing else, use this.

## Licence

MIT © Robin Gogolok
