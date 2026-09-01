/**
 * wake-marquee — an endless marquee that answers to the scroll.
 *
 * Two movements run at once on the same row:
 *
 *   1. The loop. Lanes are translated together by up to one lane width, then
 *      snap back. The snap is invisible because it is exactly one repeat of
 *      the content.
 *   2. The wake. The layer holding those lanes is given `wake` percent of
 *      overhang on each side, and the scroll spends precisely that reserve.
 *      The row is dragged against its own direction of travel as the element
 *      crosses the viewport, so it reads as something being pulled through
 *      water rather than a banner playing on a loop.
 *
 * On top of that the loop reverses when the reader scrolls back up, eased
 * rather than switched, so the row appears to have momentum of its own.
 *
 * Every instance on the page shares one `requestAnimationFrame` loop, and
 * that loop reads all geometry before it writes any transform. Interleaving
 * the two would force a layout between every read and every write, which is
 * the difference between one reflow per frame and one per marquee.
 *
 * @module wake-marquee
 */

import {
  advance,
  clamp,
  easeDirection,
  frameDelta,
  laneCount,
  resolveSpeed,
  viewProgress,
  wakeOffset,
} from './motion.js';

/**
 * @typedef {object} MarqueeOptions
 * @property {'left' | 'right'} [direction='left'] Travel direction while the
 *   reader scrolls down. Scrolling up reverses it unless `reverse` is off.
 * @property {number | string} [speed=60] Travel speed in pixels per second,
 *   or a percentage of the container width per second, e.g. `'8%'`. The
 *   percentage is the one that reads the same on a phone and on a desktop.
 * @property {number} [wake=8] Scroll-driven displacement, as a percentage of
 *   the container width. `0` turns the wake off and leaves a plain loop.
 * @property {boolean} [reverse=true] Whether scrolling up reverses travel.
 * @property {number} [ease=5] How sharply a reversal settles, per second.
 *   Higher is more abrupt; around `1` reads as a long, heavy turn.
 * @property {string} [gap] Space between two items, any CSS length. Defaults
 *   to the stylesheet's `2rem`.
 * @property {string | false} [fade=false] Soft edges left and right, any CSS
 *   length, e.g. `'6rem'`.
 * @property {boolean} [pauseOnHover=false] Hold still while a real pointer
 *   rests on the row. Ignored on touch, where there is no hover to leave.
 * @property {Window | HTMLElement} [scroller=window] What to read the scroll
 *   direction from. Pass the scrolling element when the page is inside an
 *   overflow container.
 * @property {boolean} [respectMotionPreference=true] Stay still under
 *   `prefers-reduced-motion: reduce`. Turning this off is almost always the
 *   wrong call.
 */

/** @type {Required<Omit<MarqueeOptions, 'gap' | 'fade' | 'scroller'>> & {gap: string | null, fade: string | false, scroller: Window | HTMLElement | null}} */
const DEFAULTS = Object.freeze({
  direction: 'left',
  speed: 60,
  wake: 8,
  reverse: true,
  ease: 5,
  gap: null,
  fade: false,
  pauseOnHover: false,
  scroller: null, // resolved to `window` at construction, so this stays SSR-safe
  respectMotionPreference: true,
});

const ATTRIBUTE = 'data-wake-marquee';
const LANE_CLASS = 'wake-lane';
const TRACK_CLASS = 'wake-track';

/** Extra lanes held in reserve against sub-pixel rounding at the right edge. */
const LANE_BUFFER = 1;

/** How far outside the viewport an instance starts running, in px. */
const ROOT_MARGIN = '200px 0px';

/** The relative form of `speed`: `'8%'` of the container width, per second. */
const PERCENT = /^\d*\.?\d+%$/;

/**
 * Is this a speed the loop can run at: px per second, or a percentage of the
 * container width per second?
 *
 * Deliberately no time form. `'9.6s'` for one container width reads well until
 * it sits next to the number form, where it reverses the direction of the
 * option: `'12s'` would be slower than `'6s'` while `120` is faster than `60`.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isSpeed(value) {
  if (typeof value === 'string') return PERCENT.test(value);
  return Number.isFinite(value) && /** @type {number} */ (value) >= 0;
}

/**
 * Has this element already been turned into a marquee?
 *
 * The presence of `data-wake-marquee` is not the answer. That attribute is
 * also the stylesheet's hook, so it belongs in the markup for the sake of the
 * unenhanced page, and it is there long before any script runs. The structure
 * is the honest signal: an initialised root holds a `.wake-track`.
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isInitialised(el) {
  return el.firstElementChild?.classList.contains(TRACK_CLASS) === true;
}

/** @type {Set<Marquee>} Every live instance, driven by the one shared loop. */
const registry = new Set();

/**
 * @type {WeakMap<Element, Marquee>} The same instances, indexed by element, so
 * a handle can be found again by whoever ends up needing one. Weak because the
 * key is the caller's element: a row removed from the document should not be
 * held alive by this.
 */
const byElement = new WeakMap();

/** @type {Map<Window | HTMLElement, {last: number, sign: number}>} */
const scrollers = new Map();

let rafId = 0;
let lastFrame = 0;

/** Warned about collapsed spacing once? A global reset breaks every row. */
let warnedSpacing = false;

/**
 * Read the scroll offset of either the window or an overflow container.
 * @param {Window | HTMLElement} scroller
 * @returns {number}
 */
function scrollOffset(scroller) {
  return scroller === window ? window.scrollY : /** @type {HTMLElement} */ (scroller).scrollTop;
}

/**
 * Sample which way a scroller last moved: +1 down, -1 up.
 *
 * Reading `scrollY` or `scrollTop` is a layout read, so this belongs in the
 * frame's read phase and nowhere else. It samples once per scroller rather
 * than once per instance, and only reacts past half a pixel: without that
 * threshold the sub-pixel jitter of a smooth-scrolling library flips the sign
 * every few frames and shakes every marquee on the page.
 *
 * @param {Window | HTMLElement} scroller
 */
function sampleScroll(scroller) {
  const state = scrollers.get(scroller);
  if (!state) {
    scrollers.set(scroller, { last: scrollOffset(scroller), sign: 1 });
    return;
  }
  const now = scrollOffset(scroller);
  if (Math.abs(now - state.last) > 0.5) {
    state.sign = now > state.last ? 1 : -1;
    state.last = now;
  }
}

/**
 * The last sampled direction of a scroller. Pure map lookup, no layout.
 * @param {Window | HTMLElement} scroller
 * @returns {number}
 */
function scrollSign(scroller) {
  return scrollers.get(scroller)?.sign ?? 1;
}

/**
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Options in, validated options out. Explicit `undefined` counts as absent,
 * because framework wrappers hand every prop through whether it was set or
 * not, and `speed: undefined` has to mean the default rather than `NaN`.
 *
 * Exported so a wrapper can reject bad options where the caller wrote them,
 * rather than at the first frame of an animation that then silently does
 * nothing.
 *
 * @param {MarqueeOptions} options
 * @returns {typeof DEFAULTS}
 */
export function normalizeOptions(options = {}) {
  const config = { ...DEFAULTS };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) config[key] = value;
  }

  if (config.direction !== 'left' && config.direction !== 'right') {
    throw new RangeError(`wake-marquee: direction must be "left" or "right", received "${config.direction}"`);
  }
  if (typeof config.speed === 'string') config.speed = config.speed.trim();
  if (!isSpeed(config.speed)) {
    const received = typeof config.speed === 'string' ? `"${config.speed}"` : config.speed;
    throw new RangeError(
      'wake-marquee: speed must be a non-negative number of pixels per second, or a percentage ' +
        `of the container width per second such as "8%", received ${received}`,
    );
  }
  if (!Number.isFinite(config.wake) || config.wake < 0) {
    throw new RangeError(`wake-marquee: wake must be a non-negative number, received ${config.wake}`);
  }
  if (!Number.isFinite(config.ease) || config.ease <= 0) {
    throw new RangeError(`wake-marquee: ease must be a positive number, received ${config.ease}`);
  }

  // `?? window` would throw where there is no window at all, and a bad
  // option should be reportable from a test runner or a server render.
  config.scroller = config.scroller ?? (typeof window === 'undefined' ? null : window);
  return config;
}

/**
 * Read options declared on the element as `data-wake-*` attributes, so the
 * markup can carry its own configuration and the auto-init entry point needs
 * no JavaScript from the caller at all.
 *
 * @param {HTMLElement} el
 * @returns {MarqueeOptions}
 */
export function readOptions(el) {
  const d = el.dataset;
  /** @type {MarqueeOptions} */
  const options = {};

  if (d.wakeDirection) options.direction = /** @type {'left' | 'right'} */ (d.wakeDirection);
  // A percentage passes through as the string it is. Anything else that is
  // not a number passes through too, so normalisation can name it in the
  // error rather than reporting the NaN that Number() would have made of it.
  if (d.wakeSpeed) {
    const speed = d.wakeSpeed.trim();
    options.speed = Number.isFinite(Number(speed)) ? Number(speed) : speed;
  }
  if (d.wake) options.wake = Number(d.wake);
  if (d.wakeEase) options.ease = Number(d.wakeEase);
  if (d.wakeGap) options.gap = d.wakeGap;
  if (d.wakeFade) options.fade = d.wakeFade;
  // Presence is the value: `data-wake-pause-on-hover` reads as an empty
  // string, which is falsy, so these cannot be tested by truthiness.
  if (d.wakePauseOnHover !== undefined) options.pauseOnHover = true;
  if (d.wakeReverse !== undefined) options.reverse = d.wakeReverse !== 'false';

  return options;
}

/**
 * One marquee. Built by `createMarquee`, never constructed directly.
 */
class Marquee {
  /**
   * @param {HTMLElement} root
   * @param {MarqueeOptions} options
   */
  constructor(root, options) {
    /** @type {HTMLElement} The element handed to `createMarquee`. */
    this.element = root;
    /** @type {typeof DEFAULTS} */
    this.options = normalizeOptions(options);

    this.dirSign = this.options.direction === 'right' ? 1 : -1;
    /** Eased travel direction in `[-1, 1]`; starts already up to speed. */
    this.dirFactor = this.dirSign;
    /** Running loop offset, always inside `[0, period)`. */
    this.offset = 0;
    /** Width of one lane in px: the loop's repeat distance. */
    this.period = 0;
    /** Last resolved travel speed in px per second. */
    this.speedPx = 0;
    /** Last written wake displacement in px, kept so a paused frame holds. */
    this.wakePx = 0;
    /** Last measured wake amplitude in px. */
    this.amplitude = 0;
    /** Has the first frame been lined up with the static row it replaces? */
    this.aligned = false;

    this.visible = false;
    this.measured = false;
    this.paused = false;
    this.hovered = false;
    this.destroyed = false;
    /** Last written status, so an unchanged frame writes no attribute. */
    this.status = '';

    this.#build();
    this.#observe();

    registry.add(this);
    byElement.set(root, this);
    this.#applyMotionPreference();
  }

  /**
   * Wrap the caller's children into the two layers the animation needs.
   *
   *   root   [data-wake-marquee]   clips, and is the geometry the wake reads
   *     track  .wake-track         overhung by `wake` percent on either side
   *       lane   .wake-lane        the original children
   *       lane   .wake-lane        clones, added once measured
   *
   * Building this here rather than asking for it in the markup keeps the
   * unenhanced page honest: without JavaScript the children sit in a plain
   * clipped flex row, which is the resting state the stylesheet describes and
   * exactly what stays on screen under reduced motion.
   */
  #build() {
    const root = this.element;
    const doc = root.ownerDocument;

    this.track = doc.createElement('div');
    this.track.className = TRACK_CLASS;

    this.lane = doc.createElement('div');
    this.lane.className = LANE_CLASS;

    // Move the children before the track is attached, so this costs one
    // layout rather than one per child.
    while (root.firstChild) this.lane.appendChild(root.firstChild);

    this.track.appendChild(this.lane);
    root.appendChild(this.track);

    /** @type {HTMLElement[]} Lane 0 is the original; the rest are clones. */
    this.lanes = [this.lane];

    /**
     * How to put the element back. Every attribute and custom property below
     * doubles as configuration the markup may have declared itself, so
     * `destroy()` may only take back what it actually added. Removing
     * `data-wake-fade` because we saw it would delete the caller's option and
     * a later `initMarquees()` would come back without it.
     *
     * @type {Array<() => void>}
     */
    this.undo = [];

    /** @param {string} name @param {string} value */
    const setAttribute = (name, value) => {
      if (root.hasAttribute(name)) return;
      root.setAttribute(name, value);
      this.undo.push(() => root.removeAttribute(name));
    };

    /** @param {string} name @param {string} value */
    const setProperty = (name, value) => {
      if (root.style.getPropertyValue(name)) return;
      root.style.setProperty(name, value);
      this.undo.push(() => root.style.removeProperty(name));
    };

    setAttribute(ATTRIBUTE, '');
    if (this.options.gap) setProperty('--wake-gap', this.options.gap);
    if (this.options.fade) {
      setProperty('--wake-fade', this.options.fade);
      setAttribute('data-wake-fade', '');
    }

  }

  /**
   * Give the track the overhang the wake spends, half of it on each side.
   *
   * Deliberately not done at construction. The overhang shifts the row left
   * by a full amplitude on its own, and the transform that cancels it is only
   * written once the row is measured. Set them at different times and the
   * reader sees the row slide sideways and back: at construction for a row on
   * screen, and on the way in for a row below the fold, which is worse
   * because it happens right where they are looking.
   *
   * Idempotent, so refresh() can call it on every resize.
   */
  #setOverhang() {
    this.track.style.marginInlineStart = `-${this.options.wake}%`;
    this.track.style.width = `${100 + this.options.wake * 2}%`;
  }

  /**
   * Take the row from its static state to its running one inside a single
   * task: overhang, measurement, clones and the first transform together.
   * Anything left over for the next frame gets painted on its own.
   */
  #activate() {
    this.refresh();
    if (this.period > 0 && !this.paused) {
      this.read(window.innerHeight);
      this.write(0, scrollSign(this.options.scroller));
    }
  }

  #observe() {
    const root = this.element;

    this.intersection = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          this.visible = entry.isIntersecting;
          root.toggleAttribute('data-wake-active', entry.isIntersecting);
          // Clone on first sight, not at construction. Images below the fold
          // keep their `loading="lazy"` meaning that way, and a page with a
          // dozen marquees does no work for the eleven nobody has reached.
          // Activating here rather than leaving it to the next frame matters
          // when the reader arrives by anchor link or a restored scroll
          // position: the row is already fully in view when this fires.
          if (entry.isIntersecting && !this.measured) this.#activate();
        }
        schedule();
      },
      { rootMargin: ROOT_MARGIN, threshold: 0 },
    );
    this.intersection.observe(root);

    // Content decides the period, the container decides how many lanes cover
    // it, so both are watched. A late web font or a decoded image changes the
    // first; a rotation changes the second.
    this.resize = new ResizeObserver(() => {
      if (this.measured) this.refresh();
    });
    this.resize.observe(this.lane);
    this.resize.observe(root);

    if (this.options.pauseOnHover && matchMedia('(hover: hover)').matches) {
      this.onEnter = () => {
        this.hovered = true;
      };
      this.onLeave = () => {
        this.hovered = false;
        schedule();
      };
      root.addEventListener('pointerenter', this.onEnter);
      root.addEventListener('pointerleave', this.onLeave);
    }

    if (this.options.respectMotionPreference && typeof matchMedia === 'function') {
      this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
      this.onMotionChange = () => this.#applyMotionPreference();
      this.motionQuery.addEventListener('change', this.onMotionChange);
    }
  }

  /**
   * Honour the reader's motion preference, now and whenever they change it.
   * Stopping resets the transforms, so the row settles back into the same
   * static, clipped state a page without JavaScript would show.
   */
  #applyMotionPreference() {
    if (!this.options.respectMotionPreference) {
      schedule();
      return;
    }
    if (prefersReducedMotion()) {
      this.paused = true;
      this.#reset();
    } else {
      this.paused = false;
      schedule();
    }
  }

  #reset() {
    this.offset = 0;
    this.wakePx = 0;
    // Resuming is a first frame again: it has to line up with the static row
    // that a reduced-motion reader has been looking at until now.
    this.aligned = false;
    for (const lane of this.lanes) lane.style.transform = '';
    this.track.style.transform = '';
  }

  /**
   * Build the running state now, in the caller's own task, for a row that is
   * already on screen.
   *
   * Left to the observers, the three steps land in three different frames:
   * the overhang in one, the clones in the next, the first transform in the
   * one after. The browser paints all three, and the row visibly jumps twice
   * before it settles. Doing them together means the reader goes straight
   * from the static row to the moving one with nothing in between.
   *
   * Rows below the fold are left to the IntersectionObserver, which is what
   * keeps a page of ten marquees from measuring ten of them at load.
   */
  prime() {
    if (this.destroyed || this.measured) return this;

    const viewport = window.innerHeight;
    const rect = this.element.getBoundingClientRect();
    const margin = 200; // matches ROOT_MARGIN
    if (rect.bottom < -margin || rect.top > viewport + margin) return this;

    this.visible = true;
    this.element.toggleAttribute('data-wake-active', true);
    // dt of zero advances nothing: this only puts the row on screen already
    // running, aligned to the static row it replaces.
    this.#activate();
    return this;
  }

  /**
   * Re-measure and top up the clones. Called on first sight, on resize, and
   * available to callers who change the content themselves.
   */
  refresh() {
    if (this.destroyed) return;

    const period = this.lane.getBoundingClientRect().width;
    // A display:none ancestor, or a lane whose images have not laid out yet,
    // measures zero. Bailing leaves `measured` false so the next observer
    // callback tries again, rather than locking in a broken period.
    if (!(period > 0)) return;

    // The period is the unit the offset is expressed in, so when it changes
    // the offset has to be restated in the new one or the row jumps by the
    // difference. This is not a rare edge: an image without width and height
    // attributes, or a web font swapping in, resizes the lane under a row
    // that is already running. Holding the phase keeps that invisible.
    if (this.period > 0 && period !== this.period) {
      this.offset = (this.offset / this.period) * period;
    }

    if (!this.measured) this.#checkSpacing();
    this.period = period;
    this.measured = true;
    this.#setOverhang();

    const needed = laneCount(this.track.getBoundingClientRect().width, period, LANE_BUFFER);

    while (this.lanes.length < needed) {
      const clone = /** @type {HTMLElement} */ (this.lane.cloneNode(true));
      // A clone is decoration. `inert` takes it out of the focus order and the
      // accessibility tree in one attribute; `aria-hidden` and the tabindex
      // sweep cover browsers that do not have `inert` yet, where a clone would
      // otherwise put a dozen invisible tab stops in the reader's way.
      clone.inert = true;
      clone.setAttribute('aria-hidden', 'true');
      if (!('inert' in clone)) {
        clone
          .querySelectorAll('a, button, input, select, textarea, [tabindex]')
          .forEach((el) => el.setAttribute('tabindex', '-1'));
      }
      // Clones start far off to the right and are translated in. A lazy image
      // there would never reach its loading threshold and would arrive as a
      // hole in the row. The source is identical to the original, so this is
      // a cache hit rather than a second download.
      clone.querySelectorAll('img[loading="lazy"]').forEach((img) => img.setAttribute('loading', 'eager'));
      this.track.appendChild(clone);
      this.lanes.push(clone);
    }

    while (this.lanes.length > needed) {
      this.lanes.pop()?.remove();
    }

    schedule();
  }

  /**
   * Say something when a global CSS reset has eaten the spacing between items.
   *
   * `margin-inline-end` on the item lives in `@layer wake-marquee`, and every
   * unlayered declaration beats every layered one whatever the specificity
   * says, so an ordinary `* { margin: 0 }` reset wins over it. Nothing breaks
   * loudly: the row still loops, `--wake-gap` still resolves correctly in the
   * devtools, and the items simply sit flush against one another. A failure
   * that quiet, in the interaction between two stylesheets, is worth a line in
   * the console; it otherwise reads as a mistake in the consuming project.
   *
   * Runs once per instance, and never again on any of them once it has fired.
   */
  #checkSpacing() {
    if (warnedSpacing) return;
    const item = this.lane.firstElementChild;
    if (!item) return;

    const style = getComputedStyle(item);
    // Unset resolves to the stylesheet's own 2rem, which is not zero either.
    const declared = style.getPropertyValue('--wake-gap').trim();
    const asked = declared === '' ? 32 : parseFloat(declared);
    // A calc() or a var() chain parses as NaN. Unknowable, so say nothing:
    // a false warning about someone else's CSS is worse than none.
    if (!(asked > 0) || parseFloat(style.marginInlineEnd) !== 0) return;

    warnedSpacing = true;
    console.warn(
      'wake-marquee: the items have no spacing. An unlayered CSS reset outranks ' +
        '@layer wake-marquee whatever the specificity says. Put the reset in a layer ' +
        'and name the order first: @layer reset, wake-marquee;',
    );
  }

  /** Read geometry. Never writes, so it cannot force a layout mid-frame. */
  read(viewport) {
    if (!this.#running()) return;
    const rect = this.element.getBoundingClientRect();
    const progress = viewProgress(rect.top, rect.height, viewport);
    // Kept because the first frame's alignment has to undo exactly the
    // overhang the track was given, and that is measured in these same px.
    this.amplitude = (this.options.wake * rect.width) / 100;
    this.wakePx = wakeOffset(progress, this.amplitude, this.dirSign);
    // Resolved here rather than in write(), because a percentage speed is a
    // fraction of this same width and this is where the width is honest. It
    // is re-read every frame, so an option changed at runtime takes effect on
    // the next one, and a container resized under a running row is followed.
    this.speedPx = resolveSpeed(this.options.speed, rect.width);
  }

  /**
   * Land the first animated frame on the pixel the static row already
   * occupies, instead of wherever `offset: 0` happens to fall.
   *
   * Before the script runs, item 1 sits flush at the container's left edge.
   * A running row puts lane 0 at `-period` so a clone covers that edge, and
   * shifts the whole track by `-amplitude` of overhang plus the wake. Left
   * alone, those add up to a visible jump on the first frame, of anything up
   * to one full amplitude depending on where the row happens to be on screen.
   *
   * Solving `-amplitude + wake + (offset - period) ≡ 0 (mod period)` for the
   * offset lines the two up exactly, whatever the scroll position. From the
   * next frame on it advances normally: nothing else ever touches it.
   */
  #align() {
    this.aligned = true;
    const shift = this.amplitude - this.wakePx;
    this.offset = ((shift % this.period) + this.period) % this.period;
  }

  /** Write transforms. Never reads geometry. */
  write(dt, scrollDir) {
    if (!this.#running()) return;
    if (!this.aligned) this.#align();

    const target = this.hovered ? 0 : this.options.reverse ? this.dirSign * scrollDir : this.dirSign;
    this.dirFactor = easeDirection(this.dirFactor, target, dt, this.options.ease);

    this.offset = advance(this.offset, this.dirFactor * this.speedPx, dt, this.period);

    // One period of lead, so travelling left never exposes the origin.
    const x = this.offset - this.period;
    const transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    for (const lane of this.lanes) lane.style.transform = transform;

    this.track.style.transform = `translate3d(${this.wakePx.toFixed(2)}px, 0, 0)`;

    // Deliberately not `data-wake-direction`: that attribute is the *option*
    // the markup declares, and a re-run of initMarquees() reads it back. A
    // status written into it would turn "right" into "forward" and the next
    // read would reject it.
    const status = scrollDir === 1 ? 'forward' : 'reversed';
    if (status !== this.status) {
      this.status = status;
      this.element.setAttribute('data-wake-travel', status);
    }
  }

  #running() {
    return !this.destroyed && !this.paused && this.visible && this.period > 0;
  }

  /** Resume after `pause()`. No effect under a reduced-motion preference. */
  play() {
    if (this.destroyed) return this;
    if (this.options.respectMotionPreference && prefersReducedMotion()) return this;
    this.paused = false;
    schedule();
    return this;
  }

  /** Hold the row where it is. The wake stops with it. */
  pause() {
    this.paused = true;
    return this;
  }

  /** Undo everything: clones, wrappers, observers, listeners, attributes. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    registry.delete(this);
    byElement.delete(this.element);

    this.intersection?.disconnect();
    this.resize?.disconnect();
    if (this.onEnter) this.element.removeEventListener('pointerenter', this.onEnter);
    if (this.onLeave) this.element.removeEventListener('pointerleave', this.onLeave);
    if (this.motionQuery && this.onMotionChange) {
      this.motionQuery.removeEventListener('change', this.onMotionChange);
    }

    for (const lane of this.lanes.slice(1)) lane.remove();
    // Hand the original children back exactly where they came from.
    while (this.lane.firstChild) this.element.appendChild(this.lane.firstChild);
    this.track.remove();

    // Written by the running loop, never by the caller, so always ours.
    this.element.removeAttribute('data-wake-travel');
    this.element.removeAttribute('data-wake-active');
    for (const undo of this.undo) undo();
    this.undo = [];

    this.lanes = [];
  }
}

/**
 * The one loop for every marquee on the page.
 *
 * Reads first, writes second, both across all instances. Interleaving them
 * would put a forced reflow between each pair, so a page with six marquees
 * would pay six layouts a frame instead of one.
 *
 * @param {number} time
 */
function frame(time) {
  const dt = lastFrame === 0 ? 0 : frameDelta(time - lastFrame);
  lastFrame = time;

  const viewport = window.innerHeight;

  for (const marquee of registry) {
    if (marquee.options.reverse) sampleScroll(marquee.options.scroller);
    marquee.read(viewport);
  }

  for (const marquee of registry) {
    marquee.write(dt, marquee.options.reverse ? scrollSign(marquee.options.scroller) : 1);
  }

  // Stop the moment nothing is on screen. A page scrolled past its marquees
  // should cost nothing at all, and an idle rAF loop is not nothing: it keeps
  // the compositor awake and shows up on a battery.
  rafId = 0;
  schedule();
}

/** Start the shared loop if any instance needs it and it is not already up. */
function schedule() {
  if (rafId !== 0) return;
  let wanted = false;
  for (const marquee of registry) {
    if (!marquee.destroyed && !marquee.paused && marquee.visible) {
      wanted = true;
      break;
    }
  }
  if (!wanted) {
    lastFrame = 0; // so the first frame after a gap integrates zero, not seconds
    return;
  }
  rafId = requestAnimationFrame(frame);
}

/**
 * Turn an element and its children into a marquee.
 *
 * @param {HTMLElement} element Container. Its direct children become the items.
 * @param {MarqueeOptions} [options]
 * @returns {Marquee}
 */
export function createMarquee(element, options = {}) {
  if (!element || element.nodeType !== 1) {
    throw new TypeError('wake-marquee: createMarquee expects an element');
  }
  if (isInitialised(element)) {
    throw new Error('wake-marquee: this element is already a marquee, call destroy() first');
  }
  return new Marquee(element, options).prime();
}

/**
 * Find every `[data-wake-marquee]` in `root` and start it, reading each
 * element's own `data-wake-*` attributes for its options.
 *
 * Already-initialised elements are skipped, so this is safe to call again
 * after new content arrives.
 *
 * @param {object} [init]
 * @param {ParentNode} [init.root=document] Where to look.
 * @param {MarqueeOptions} [init.defaults] Applied under each element's own
 *   attributes, so the markup always wins.
 * @returns {Marquee[]} Only the instances this call created.
 */
export function initMarquees({ root = document, defaults = {} } = {}) {
  const created = [];
  for (const el of root.querySelectorAll(`[${ATTRIBUTE}]`)) {
    if (isInitialised(el)) continue;
    created.push(new Marquee(/** @type {HTMLElement} */ (el), { ...defaults, ...readOptions(el) }));
  }
  // Every row is built before any row is measured. Interleaving the two would
  // make each construction invalidate the layout the next one has to read,
  // which is one forced reflow per marquee at the worst possible moment.
  for (const marquee of created) marquee.prime();
  return created;
}

/**
 * The marquee running on an element, or `null` if there is none.
 *
 * `initMarquees()` returns only the instances that call created, which is the
 * right answer for something safe to call repeatedly and the wrong one for
 * anybody who needs a handle later: the second call over the same content
 * returns an empty array, because every row is already running. Without a way
 * back in, a declarative integration is a one-way door: `wake-marquee/astro`
 * starts the rows for you and there is nothing to pause, refresh or destroy.
 *
 * @param {Element | null | undefined} element
 * @returns {Marquee | null}
 *
 * @example
 * const row = getMarquee(document.querySelector('#logos'))
 * row?.pause()
 */
export function getMarquee(element) {
  return (element && byElement.get(element)) || null;
}

export { DEFAULTS as defaults, Marquee };
