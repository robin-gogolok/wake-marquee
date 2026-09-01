import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  clamp,
  easeDirection,
  frameDelta,
  laneCount,
  resolveSpeed,
  viewProgress,
  wakeOffset,
} from '../src/motion.js';

describe('laneCount', () => {
  test('covers the track with a period to spare on each side', () => {
    // Lane 0 covers everything left of the origin, so a track exactly one
    // period wide still needs three lanes: the lead, the visible one, and the
    // rounding spare.
    assert.equal(laneCount(100, 100), 3);
    assert.equal(laneCount(250, 100), 5);
  });

  test('rounds a fractional fit upwards, never down', () => {
    // 201 / 100 is 2.01 lanes of coverage. Truncating leaves a 1px seam that
    // crosses the row once per period.
    assert.equal(laneCount(201, 100), 5);
  });

  test('never returns a count that cannot be rendered', () => {
    assert.equal(laneCount(500, 0), 1);
    assert.equal(laneCount(Number.NaN, 100), 1);
    assert.equal(laneCount(500, -20), 1);
  });
});

describe('advance', () => {
  test('wraps into [0, period) travelling forwards', () => {
    assert.equal(advance(90, 100, 0.2, 100), 10);
  });

  test('wraps into [0, period) travelling backwards', () => {
    // The bug this guards: JavaScript's % keeps the sign of the dividend, so a
    // single modulo returns -10 here and the lanes jump a full period sideways
    // the first time the reader scrolls up.
    assert.equal(advance(10, -100, 0.2, 100), 90);
  });

  test('holds still on a zero delta', () => {
    assert.equal(advance(42, 100, 0, 100), 42);
  });

  test('survives a period it cannot use', () => {
    assert.equal(advance(42, 100, 0.1, 0), 0);
  });
});

describe('easeDirection', () => {
  test('converges towards the target without overshooting', () => {
    let value = 1;
    for (let i = 0; i < 200; i++) value = easeDirection(value, -1, 1 / 60, 5);
    assert.ok(value > -1.000001 && value < -0.999);
  });

  test('reaches the same place at 60 and at 120 frames per second', () => {
    // The whole reason for the exponential form. A naive per-frame lerp would
    // land these two a long way apart, and the same reversal would be twice as
    // fast on a 120 Hz display.
    let slow = 1;
    let fast = 1;
    for (let i = 0; i < 30; i++) slow = easeDirection(slow, -1, 1 / 60, 5);
    for (let i = 0; i < 60; i++) fast = easeDirection(fast, -1, 1 / 120, 5);
    assert.ok(Math.abs(slow - fast) < 1e-9, `${slow} vs ${fast}`);
  });

  test('a zero delta changes nothing', () => {
    assert.equal(easeDirection(0.5, -1, 0, 5), 0.5);
  });
});

describe('viewProgress', () => {
  test('runs 0 to 1 across the element passing the viewport', () => {
    // Top edge level with the bottom of the viewport: the passage begins.
    assert.equal(viewProgress(800, 200, 800), 0);
    // Bottom edge level with the top: it ends.
    assert.equal(viewProgress(-200, 200, 800), 1);
    // Halfway is halfway, whatever the element's height.
    assert.equal(viewProgress(300, 200, 800), 0.5);
  });

  test('stays in range beyond the viewport in both directions', () => {
    assert.equal(viewProgress(5000, 200, 800), 0);
    assert.equal(viewProgress(-5000, 200, 800), 1);
  });

  test('does not divide by zero in a viewport that has no height', () => {
    assert.equal(viewProgress(0, 0, 0), 0);
  });
});

describe('wakeOffset', () => {
  test('never exceeds the overhang the track was given', () => {
    // This is the invariant that keeps the ends of the row off screen. The
    // track is exactly `amplitude` wider on each side, so a displacement past
    // that shows the audience where the content stops.
    for (let p = 0; p <= 1; p += 0.05) {
      for (const sign of [1, -1]) {
        assert.ok(Math.abs(wakeOffset(p, 40, sign)) <= 40 + 1e-9, `progress ${p}, sign ${sign}`);
      }
    }
  });

  test('crosses zero at the centre of the passage', () => {
    assert.equal(wakeOffset(0.5, 40, -1), 0);
  });

  test('pulls against the direction of travel', () => {
    // Travelling left (-1), the row is held back to the right as it enters.
    assert.ok(wakeOffset(0, 40, -1) > 0);
    assert.ok(wakeOffset(1, 40, -1) < 0);
    // Travelling right, the other way round.
    assert.ok(wakeOffset(0, 40, 1) < 0);
    assert.ok(wakeOffset(1, 40, 1) > 0);
  });

  test('is inert at zero amplitude', () => {
    // Math.abs, because the sign of a zero displacement is meaningless here
    // and assert.equal is strict enough to tell -0 from 0.
    assert.equal(Math.abs(wakeOffset(0, 0, -1)), 0);
    assert.equal(Math.abs(wakeOffset(1, 0, -1)), 0);
    assert.equal(Math.abs(wakeOffset(0.5, 0, 1)), 0);
  });
});

describe('frameDelta', () => {
  test('converts to seconds', () => {
    assert.equal(frameDelta(16.667), 0.016667);
  });

  test('caps a stalled frame instead of integrating it', () => {
    // A backgrounded tab hands back seconds. Integrating that teleports the
    // loop; capping costs a little drift and nothing else.
    assert.equal(frameDelta(5000), 0.1);
  });

  test('treats a missing or backwards clock as no time passing', () => {
    assert.equal(frameDelta(0), 0);
    assert.equal(frameDelta(-16), 0);
    assert.equal(frameDelta(Number.NaN), 0);
  });
});

describe('clamp', () => {
  test('bounds on both sides and passes the middle through', () => {
    assert.equal(clamp(-1, 0, 1), 0);
    assert.equal(clamp(2, 0, 1), 1);
    assert.equal(clamp(0.5, 0, 1), 0.5);
  });
});

describe('resolveSpeed', () => {
  test('passes a pixel speed straight through', () => {
    assert.equal(resolveSpeed(60, 1440), 60);
    assert.equal(resolveSpeed(0, 1440), 0);
  });

  test('reads a percentage as that fraction of the container per second', () => {
    assert.equal(resolveSpeed('10%', 1440), 144);
    assert.equal(resolveSpeed('7.5%', 400), 30);
    assert.equal(resolveSpeed('0%', 1440), 0);
  });

  test('a percentage crosses the container in the same time at any width', () => {
    // The whole point of the relative form: 1440 / 144 and 390 / 39 are both
    // ten seconds, where a fixed 144 px/s would cross the phone in under three.
    const desktop = 1440 / resolveSpeed('10%', 1440);
    const phone = 390 / resolveSpeed('10%', 390);
    assert.equal(desktop, phone);
  });

  test('an unmeasurable container stands still rather than running at NaN', () => {
    // A display:none ancestor measures zero. A NaN velocity would put the
    // offset beyond recovery, and it never comes back once it is there.
    assert.equal(resolveSpeed('10%', 0), 0);
    assert.equal(resolveSpeed('nonsense', 1440), 0);
  });
});
