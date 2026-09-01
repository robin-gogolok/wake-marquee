/**
 * The arithmetic behind a wake-marquee, with no DOM in sight.
 *
 * Everything here is a pure function of numbers. That is not tidiness for its
 * own sake: the loop in `marquee.js` runs sixty times a second across every
 * instance on the page, and the only way to know its maths is right is to be
 * able to run it without a browser. Every function below has a unit test.
 *
 * @module wake-marquee/motion
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * How many lanes it takes to cover the track without a gap, worst case.
 *
 * The shared transform on the lanes always sits in `[-period, 0)`, so lane 0
 * covers everything left of the origin and the remaining lanes have to span
 * the full track width. That is `ceil(trackWidth / period) + 1`, plus one
 * spare so a sub-pixel rounding error at the right edge cannot open a seam.
 *
 * @param {number} trackWidth Width of the moving layer in px.
 * @param {number} period Width of one lane in px, the loop's repeat distance.
 * @param {number} [buffer=1] Extra lanes held back against rounding.
 * @returns {number} Lane count, at least 1.
 */
export function laneCount(trackWidth, period, buffer = 1) {
  if (!(period > 0) || !Number.isFinite(trackWidth)) return 1;
  return Math.ceil(trackWidth / period) + 1 + buffer;
}

/**
 * Move the loop on by one frame and wrap it back into `[0, period)`.
 *
 * The wrap is a double modulo rather than a plain one, because JavaScript's
 * `%` keeps the sign of the dividend: `-5 % 100` is `-5`, not `95`. A single
 * modulo would therefore hand back a negative offset the moment the marquee
 * runs backwards, and the lanes would jump a full period sideways.
 *
 * @param {number} offset Current offset in px.
 * @param {number} velocity Signed speed in px per second.
 * @param {number} dt Frame time in seconds.
 * @param {number} period Loop repeat distance in px.
 * @returns {number} Offset in `[0, period)`.
 */
export function advance(offset, velocity, dt, period) {
  if (!(period > 0)) return 0;
  const next = offset + velocity * dt;
  return ((next % period) + period) % period;
}

/**
 * Ease the direction factor towards its target, framerate independently.
 *
 * A plain `current += (target - current) * 0.1` per frame is the usual lerp,
 * and it is wrong here: it converges at whatever rate the display happens to
 * refresh at, so the same reversal is twice as fast on a 120 Hz screen. The
 * exponential form asks how much of the remaining distance should be closed
 * over `dt` seconds, which is the same answer at any framerate.
 *
 * @param {number} current Direction factor in `[-1, 1]`.
 * @param {number} target Where it is heading, usually -1, 0 or 1.
 * @param {number} dt Frame time in seconds.
 * @param {number} ease Convergence rate per second; higher snaps harder.
 * @returns {number}
 */
export function easeDirection(current, target, dt, ease) {
  return current + (target - current) * (1 - Math.exp(-dt * ease));
}

/**
 * How far through its own passage across the viewport an element is.
 *
 * 0 when its top edge is about to enter from below, 1 when its bottom edge
 * has just left at the top. The denominator is `viewport + height` because
 * that is the full distance the element travels while any part of it is on
 * screen, which keeps a tall block and a thin one on the same scale.
 *
 * @param {number} top Element top relative to the viewport, in px.
 * @param {number} height Element height in px.
 * @param {number} viewport Viewport height in px.
 * @returns {number} Progress in `[0, 1]`.
 */
export function viewProgress(top, height, viewport) {
  const travel = viewport + height;
  if (!(travel > 0)) return 0;
  return clamp((viewport - top) / travel, 0, 1);
}

/**
 * The wake: how far the moving layer is pushed against its own direction of
 * travel at a given point in the element's passage across the viewport.
 *
 * `1 - 2 * progress` runs from +1 to -1, so the layer is displaced one full
 * amplitude one way as the element enters and the other way as it leaves,
 * passing through zero at the centre. The result is bounded by `amplitude`,
 * which is exactly the overhang the track is given on each side. That bound
 * is the whole point: overshoot it and the audience sees the end of the row.
 *
 * @param {number} progress Passage progress in `[0, 1]`.
 * @param {number} amplitude Maximum displacement in px.
 * @param {number} dirSign Base travel direction, +1 right or -1 left.
 * @returns {number} Displacement in px, within `[-amplitude, amplitude]`.
 */
export function wakeOffset(progress, amplitude, dirSign) {
  return -dirSign * amplitude * (1 - 2 * progress);
}

/**
 * Clamp a frame delta to something a physics step can survive.
 *
 * A backgrounded tab, a long task or a breakpoint in the devtools all hand
 * the next frame a delta measured in seconds. Integrating that would teleport
 * the loop. Capping it means a stall costs a little drift, never a jump.
 *
 * @param {number} ms Milliseconds since the previous frame.
 * @param {number} [max=0.1] Cap in seconds.
 * @returns {number} Seconds, never negative, never above `max`.
 */
export function frameDelta(ms, max = 0.1) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms / 1000, max);
}
