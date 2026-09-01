import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, normalizeOptions, readOptions } from '../src/marquee.js';

describe('normalizeOptions', () => {
  test('fills in every default', () => {
    const options = normalizeOptions();
    assert.equal(options.direction, 'left');
    assert.equal(options.speed, 60);
    assert.equal(options.wake, 8);
    assert.equal(options.reverse, true);
    assert.equal(options.respectMotionPreference, true);
  });

  test('treats an explicit undefined as absent', () => {
    // Framework wrappers pass every prop through, set or not. Without this,
    // <WakeMarquee /> with no speed would produce speed: undefined and the
    // row would advance by NaN pixels a frame, which is to say never.
    const options = normalizeOptions({ speed: undefined, wake: undefined, direction: undefined });
    assert.equal(options.speed, defaults.speed);
    assert.equal(options.wake, defaults.wake);
    assert.equal(options.direction, defaults.direction);
  });

  test('accepts the values that mean "off"', () => {
    const options = normalizeOptions({ speed: 0, wake: 0, reverse: false });
    assert.equal(options.speed, 0);
    assert.equal(options.wake, 0);
    assert.equal(options.reverse, false);
  });

  test('rejects options that would fail silently at runtime', () => {
    assert.throws(() => normalizeOptions({ direction: 'up' }), RangeError);
    assert.throws(() => normalizeOptions({ speed: -10 }), RangeError);
    assert.throws(() => normalizeOptions({ speed: Number.NaN }), RangeError);
    assert.throws(() => normalizeOptions({ wake: -1 }), RangeError);
    // ease is a rate in a divisor position; zero never converges.
    assert.throws(() => normalizeOptions({ ease: 0 }), RangeError);
  });

  test('leaves the frozen defaults alone', () => {
    normalizeOptions({ speed: 999 });
    assert.equal(defaults.speed, 60);
  });
});

describe('readOptions', () => {
  /** @param {Record<string, string>} dataset */
  const el = (dataset) => /** @type {any} */ ({ dataset });

  test('reads the numeric attributes', () => {
    const options = readOptions(el({ wakeSpeed: '80', wake: '14', wakeEase: '2.5' }));
    assert.deepEqual(options, { speed: 80, wake: 14, ease: 2.5 });
  });

  test('reads the string attributes', () => {
    const options = readOptions(el({ wakeDirection: 'right', wakeGap: '4rem', wakeFade: '6rem' }));
    assert.deepEqual(options, { direction: 'right', gap: '4rem', fade: '6rem' });
  });

  test('treats a bare boolean attribute as true', () => {
    // data-wake-pause-on-hover with no value reads as '', which is falsy.
    // Testing by truthiness would silently ignore the attribute.
    assert.equal(readOptions(el({ wakePauseOnHover: '' })).pauseOnHover, true);
  });

  test('only data-wake-reverse="false" turns the reversal off', () => {
    assert.equal(readOptions(el({ wakeReverse: 'false' })).reverse, false);
    assert.equal(readOptions(el({ wakeReverse: 'true' })).reverse, true);
    assert.equal(readOptions(el({ wakeReverse: '' })).reverse, true);
  });

  test('an element with no attributes asks for nothing', () => {
    assert.deepEqual(readOptions(el({})), {});
  });

  test('what it reads survives normalisation', () => {
    const options = normalizeOptions(readOptions(el({ wakeDirection: 'right', wakeSpeed: '80' })));
    assert.equal(options.direction, 'right');
    assert.equal(options.speed, 80);
    assert.equal(options.wake, defaults.wake);
  });
});
