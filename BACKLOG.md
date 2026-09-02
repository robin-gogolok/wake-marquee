# Backlog

Things that have been looked at and put down again, with enough of the reason
to pick them up without starting over. Not a roadmap: nothing here is
promised, and an entry earns its place by having been thought about rather
than by having been asked for.

An entry leaves this file when it ships or when it is decided against. If it
ships, the reasoning moves to a code comment or to `CLAUDE.md`, wherever the
next person is actually standing. None of this reaches npm; `files` in
`package.json` does not list it.

## One logical axis, so `writing-mode` and `rtl` work

The library translates on physical X throughout, and writes the overhang as a
logical `margin-inline-start`. For a plain left-to-right flex row those are
the same axis and everything holds. Change the writing direction and the two
halves come apart inside one calculation.

Measured on 0.2.2: a 60 × 600 container with `writing-mode: vertical-rl` and
three items.

| | |
| --- | --- |
| Items | run vertically: `x` constant at −32, `y` −60 → 110 → 279 |
| Item spacing | `margin-inline-end: 32px` resolved to `margin-bottom: 32px` ✅ |
| Lane width, as the library reads it | 52.8px, the row's thickness |
| Lane height, the actual repeat distance | 580.8px |
| Track overhang | resolved to −60px, vertical |
| Track width | 52.8px, horizontal |
| Lane transform | `translate3d(-19.2px, 0, 0)`, horizontal |
| Lanes built | 3, for a track 1742px tall |

Nothing errors. The row initialises, builds lanes and writes transforms, and
then slides its content across its own thickness while the content runs down
the page.

This is not the bug 0.2.2 fixed, although it presents the same way. A rotation
is a paint-time transform: the layout underneath is untouched, so reading the
layout rather than the screen was enough, and physical X really was the axis
the content travelled along. `writing-mode` moves the layout itself: the flex
main axis follows the writing direction, `margin-inline-*` follows it, and the
lane's repeat distance becomes its height, while the transforms and
`style.width` stay physical.

`direction: rtl` is the same mismatch one axis earlier and is already in the
README under Known limitations. The two are one piece of work or none.

**What it would touch.** `#setOverhang()`, which writes a logical margin
beside a physical width, so today they can point different ways. The transform
writes in `write()`, fixed at `translate3d(x, 0, 0)`. `refresh()` and
`layoutWidth()`, which want the inline size rather than the width.
`src/wake-marquee.css`, which assumes a horizontal row throughout.

**Why it is sitting here.** Rotating the container reaches the same place, is
supported, and has tests. `writing-mode` is a second route to somewhere you
can already get. It becomes worth doing if `rtl` is wanted for its own sake,
because that arrives with it.

**Workaround.** Rotate the container: see
[A row on its side](README.md#a-row-on-its-side).
