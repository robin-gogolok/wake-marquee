# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below `1.0.0` the API may still change in a minor release.

## [Unreleased]

## [0.2.0] - 2026-09-01

Three things adopting `0.1.0` in a real project turned up.

### Added

- `getMarquee(element)` returns the marquee running on an element, or `null`.
  `initMarquees()` hands back only the instances that call created, so the
  declarative integrations were a one-way door: `wake-marquee/astro` starts the
  rows in a hoisted script with nowhere to return a handle to, and calling
  `initMarquees()` again from application code returns an empty array because
  every row is already running. There was no way to reach `pause()`, `refresh()`
  or `destroy()` at all without giving up the integration and hand-rolling the
  markup.
- `speed` accepts a percentage of the container width per second, `'8%'` as
  well as `60`. Pixels a second is a physical unit on a page whose elements are
  not physically constant: a logo row is 40px tall with a 72px gap on a desktop
  and 16px with a 32px gap on a phone, so one value is calm on the first and
  hectic on the second, with three times as many items going past. The
  percentage is resolved against the width the wake is already measuring every
  frame, so it follows a resize and costs nothing.
- A console warning when the item spacing has collapsed to zero while
  `--wake-gap` asks for more. An unlayered global reset outranks every cascade
  layer whatever the specificity says, so `* { margin: 0 }` quietly beats the
  library's `margin-inline-end` and the items sit flush. Nothing else gives it
  away: the row still loops and the value still reads correctly in the devtools,
  which makes it look like a mistake in the consuming project. Said once per
  page, and never when `--wake-gap` is genuinely `0`.

### Changed

- The README's layer-order guidance was only under "Tailwind CSS v4", which is
  not where somebody with a hand-written reset goes looking. Styling now has a
  "Cascade layers" section covering both, and it records why the item spacing
  stays inside the layer: it is the rule you are most likely to want to
  override, and unlayered library CSS would beat your own utilities.
- The demo's size figure is weighed at build time rather than written down.

### Notes

- A duration form of `speed`, `'9.6s'` for one container width, was considered
  and dropped. It reverses the option on itself next to the number form, where
  `'12s'` would be slower than `'6s'` while `120` is faster than `60`, and it
  invites the reading "per lap", which would be the lane width and would mean
  adding one logo slowed the row down.

## [0.1.0] - 2026-09-01

First release.

### Added

- `createMarquee(element, options)` turns an element and its children into an
  endless marquee and hands back a handle with `play`, `pause`, `refresh` and
  `destroy`. `destroy` restores the original DOM exactly, which is what makes
  the React integration a ref and an effect rather than an adapter package.
- The wake: the layer holding the content is built `wake` percent wider than
  its container on each side, and the scroll spends exactly that reserve as
  the element crosses the viewport. The displacement is bounded by the
  overhang, so the ends of the row can never come into view.
- The turn: scrolling up reverses travel, eased from `+1` to `-1` rather than
  switched. The easing is framerate independent, so the same reversal takes
  the same time at 60 and at 120 Hz.
- `initMarquees()` and `wake-marquee/auto` start every `[data-wake-marquee]`
  on the page from its own `data-wake-*` attributes, so a page with no build
  step needs one script tag and no JavaScript of its own.
- One shared `requestAnimationFrame` loop for every instance, reading all
  geometry before writing any transform, so a frame costs one layout rather
  than one per row. The loop stops when nothing is on screen.
- Rows are measured and cloned on first sight, not at construction, so a page
  of ten marquees does no work for the nine nobody has scrolled to.
- The handover from the static row to the running one happens inside a single
  task, so no half-built state is ever painted, and the first frame is aligned
  to the position the static row already occupied rather than to the loop's
  own zero point. A row reached by anchor link or a restored scroll position
  starts as cleanly as one scrolled to.
- A lane resized under a running row, by a late web font or an image with no
  `width` and `height`, does not shift it: the offset is restated in the new
  period, holding the phase.
- `wake-marquee/css`: the loop geometry in an `@layer wake-marquee` cascade
  layer, 407 B gzipped. It owns nothing about how items look.
- `wake-marquee/astro`: Astro component rendering the same attributes.
- Accessibility: clones are `inert` and `aria-hidden`, with a `tabindex="-1"`
  fallback where `inert` is missing, so the content is announced once rather
  than once per lane. Lazy images inside clones are switched to eager, because
  a clone starts off screen and would otherwise arrive as a hole in the row.
- `prefers-reduced-motion: reduce` is honoured live: the row never starts, and
  turning the preference on mid-session stops and resets it.

### Notes

- Spacing and fade width change the layout of the static row, so declaring
  them only in `data-wake-gap` or `data-wake-fade` leaves the items shifting
  when the script runs. Set the matching custom property too; the Astro
  component does it for you. Documented in the README.
- The spacing between items is a `margin-inline-end` on the item rather than
  `gap` on the row. The lane's width is the loop period, so the space after
  the last item has to belong to the lane; with `gap` there is none between
  one lane and the next and the seam shows on every pass.
- Right-to-left writing modes are not supported. Flex rows follow the writing
  direction while the transforms are physical, so the two disagree.

[Unreleased]: https://github.com/robin-gogolok/wake-marquee/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/robin-gogolok/wake-marquee/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/robin-gogolok/wake-marquee/releases/tag/v0.1.0
