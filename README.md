# wake-marquee

An endless marquee that answers to the scroll. It reverses when the reader scrolls back, and drags against its own direction of travel as it crosses the viewport.

**[Live demo →](https://robin-gogolok.github.io/wake-marquee/)**

```
3.0 kB  gzipped JS
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
  <img src="/logos/a.svg" alt="Nordlicht">
  <img src="/logos/b.svg" alt="Kvist">
  <img src="/logos/c.svg" alt="Halden & Co">
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
<WakeMarquee speed={55} wake={10} fade="6rem" aria-label="Brands we stock">
  {brands.map((b) => <img src={b.logo} alt={b.name} />)}
</WakeMarquee>
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

**Give images `width` and `height`.** An unsized image changes the lane width
when it decodes, and the lane width is the loop period. The library restates
the offset in the new period so the row does not leap, but the items around it
still move: only the attributes prevent that.

## API

### `createMarquee(element, options?)`

Turns an element and its children into a marquee. Returns a handle.

| Option | Default | |
|---|---|---|
| `direction` | `'left'` | `'left'` or `'right'`, while scrolling down |
| `speed` | `60` | Travel speed in pixels per second |
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
| `data-wake-speed="55"` | `speed` |
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

All rules live in an `@layer wake-marquee` cascade layer, so your own unlayered CSS wins without `!important`.

### Tailwind CSS v4

Declare the layer order before the imports, or the library will outrank every utility:

```css
@layer theme, base, components, wake-marquee, utilities;

@import "tailwindcss";
@import "wake-marquee/css";
```

A layer registered late wins, and an `@import` after `tailwindcss` registers `wake-marquee` after `utilities`. Declared up front, it sits where it belongs: your utilities still win.

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

### Horizontal, and left-to-right

Vertical marquees are not supported. Neither is a right-to-left writing mode: the flex rows follow the writing direction while the transforms are physical, so the two disagree and the loop runs the wrong way. An `rtl` page can still use this inside an `ltr` container.

### One measurement, one period

The lane is measured once per resize, and its width is the loop period. Content that changes its own width while the row is running, a counter ticking from 9 to 10, say, drifts the seam until the next `refresh()`. Call it yourself after changing the items.

## How it compares

| | Size | Scroll-linked | Needs JS |
|---|---|---|---|
| **wake-marquee** | 3.4 kB | yes, direction and displacement | yes |
| CSS `@keyframes` marquee | 0 | no | no |
| [Marquee3k](https://github.com/ezekielaquino/Marquee3000) | ~2 kB | no | yes |
| [react-fast-marquee](https://github.com/justin-chu/react-fast-marquee) | ~4 kB | no | yes, React only |
| GSAP + ScrollTrigger | ~50 kB | yes, with a full timeline API | yes |

If a plain loop is all you need, write the four lines of CSS. If you need a timeline, keyframes and scrubbing across a whole page, use GSAP. If you want a row that answers to the reader and nothing else, use this.

## Licence

MIT © Robin Gogolok
