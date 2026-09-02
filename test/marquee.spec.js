import { test, expect } from '@playwright/test';

const DEMO = '/demo/index.html';

/**
 * Average travel speed of a row's lanes, in pixels per second.
 *
 * The loop offset wraps at the lane width, so a raw difference between two
 * samples is off by a whole period whenever a wrap falls between them. The
 * result is folded back into (-period/2, period/2], which is correct as long
 * as the row travels less than half a period in the sample window: at the
 * speeds here that is several seconds, and this samples for a fraction of one.
 */
async function travel(page, selector, ms = 350) {
  return page.evaluate(
    async ([sel, duration]) => {
      const lane = document.querySelector(`${sel} .wake-lane`);
      // The layout width, so the fold below still works for a row whose
      // container is rotated: the screen reports its thickness there, and
      // folding against 44px instead of 480px puts every sample in a
      // different repeat.
      const period = parseFloat(getComputedStyle(lane).width);
      const read = () => new DOMMatrix(getComputedStyle(lane).transform).m41;

      const t0 = performance.now();
      const a = read();
      await new Promise((r) => setTimeout(r, duration));
      const t1 = performance.now();
      const b = read();

      const raw = b - a;
      const folded = ((((raw + period / 2) % period) + period) % period) - period / 2;
      return folded / ((t1 - t0) / 1000);
    },
    [selector, ms],
  );
}

/** Park a section in the middle of the viewport and let the row settle. */
async function settle(page, selector, ms = 1200) {
  await page.evaluate((sel) => {
    document.querySelector(sel).scrollIntoView({ block: 'center', behavior: 'instant' });
  }, selector);
  await page.waitForTimeout(ms);
}

/**
 * Walk the whole page so every row has been seen once. Lanes are cloned on
 * first sight, so a row that has never been on screen has none, by design.
 */
async function scrollThroughPage(page) {
  const steps = await page.evaluate(() => Math.ceil(document.body.scrollHeight / window.innerHeight));
  for (let i = 0; i <= steps; i++) {
    await page.evaluate((n) => window.scrollTo(0, n * window.innerHeight * 0.9), i);
    await page.waitForTimeout(120);
  }
}

/** Nudge the scroll and wait for the eased reversal to finish turning. */
async function nudge(page, delta, ms = 1400) {
  await page.evaluate((d) => window.scrollBy(0, d), delta);
  await page.waitForTimeout(ms);
}

test.describe('the loop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO);
    await page.evaluate(() => document.fonts.ready);
  });

  test('travels left at roughly the speed it was given', async ({ page }) => {
    await settle(page, '#logos');
    const speed = await travel(page, '#logos-row');
    // data-wake-speed="55", travelling left, so negative.
    expect(speed).toBeLessThan(-35);
    expect(speed).toBeGreaterThan(-75);
  });

  test('travels right when told to', async ({ page }) => {
    await settle(page, '#reverse');
    await nudge(page, 30);
    expect(await travel(page, '#reverse-on')).toBeGreaterThan(30);
  });

  test('turns around when the reader scrolls back', async ({ page }) => {
    await settle(page, '#reverse');

    await nudge(page, 40);
    const down = await travel(page, '#reverse-on');

    await nudge(page, -40);
    const up = await travel(page, '#reverse-on');

    expect(down).toBeGreaterThan(20);
    expect(up).toBeLessThan(-20);
    await expect(page.locator('#reverse-on')).toHaveAttribute('data-wake-travel', 'reversed');
  });

  test('reverse: false keeps its heading through a scroll back', async ({ page }) => {
    await settle(page, '#reverse');

    await nudge(page, 40);
    const down = await travel(page, '#reverse-off');

    await nudge(page, -40);
    const up = await travel(page, '#reverse-off');

    // Same sign, comparable magnitude: the scroll direction changed nothing.
    expect(down).toBeLessThan(-20);
    expect(up).toBeLessThan(-20);
    expect(Math.abs(up - down)).toBeLessThan(25);
  });

  test('holds still while the pointer rests on it', async ({ page }) => {
    await settle(page, '#hover');
    expect(Math.abs(await travel(page, '#hover-row'))).toBeGreaterThan(30);

    await page.locator('#hover-row').hover();
    await page.waitForTimeout(900);
    expect(Math.abs(await travel(page, '#hover-row'))).toBeLessThan(6);

    await page.mouse.move(0, 0);
    await page.waitForTimeout(900);
    expect(Math.abs(await travel(page, '#hover-row'))).toBeGreaterThan(30);
  });
});

test.describe('how fast it goes', () => {
  test('a percentage speed is measured against the container, and follows it', async ({ page }) => {
    // The reason the relative form exists. A pixel speed is a physical unit
    // on a page whose elements are not physically constant, so one value is
    // calm on a desktop and hectic on a phone. The fixed row is the control:
    // same section, same scroll position, only the option differs.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(DEMO);
    await settle(page, '#pace');

    const wide = {
      relative: await travel(page, '#pace-relative'),
      fixed: await travel(page, '#pace-fixed'),
      width: await page.evaluate(() => document.querySelector('#pace-relative').getBoundingClientRect().width),
    };

    // data-wake-speed="8%", travelling left, so 8% of the container per
    // second and negative. Asserted against the width as rendered rather than
    // against a number written down here, which the next layout change breaks.
    expect(Math.abs(wide.relative)).toBeGreaterThan(wide.width * 0.055);
    expect(Math.abs(wide.relative)).toBeLessThan(wide.width * 0.105);

    await page.setViewportSize({ width: 640, height: 720 });
    await settle(page, '#pace');
    // The resize moves the scroll on its own: the page reflows taller and the
    // browser holds the anchored element in place, which lands as about a
    // hundred pixels backwards and turns both rows around. The scrollIntoView
    // that follows corrects by a single pixel, far too little to reliably turn
    // them back, so a quarter of the runs measured the row travelling the
    // other way and read a correct half speed as a negative one. Ask for a
    // direction instead of inheriting whatever the reflow left behind.
    await nudge(page, 40);

    const narrow = {
      relative: await travel(page, '#pace-relative'),
      fixed: await travel(page, '#pace-fixed'),
    };

    // Half the container, half the speed: the resize has to reach the running
    // loop, not just the next row anybody builds.
    expect(narrow.relative / wide.relative).toBeGreaterThan(0.35);
    expect(narrow.relative / wide.relative).toBeLessThan(0.7);
    expect(narrow.fixed / wide.fixed).toBeGreaterThan(0.8);
    expect(narrow.fixed / wide.fixed).toBeLessThan(1.25);
  });
});

test.describe('an unlayered reset', () => {
  /**
   * Put a plain global reset in front of the library's stylesheet, the way a
   * hand-written one in a consuming project sits. It has to land before the
   * document is parsed: the demo's module script runs before DOMContentLoaded,
   * and by then the row has been measured.
   */
  const withReset = (page) =>
    page.addInitScript(() => {
      const add = () => {
        const style = document.createElement('style');
        style.textContent = '*, *::before, *::after { margin: 0; padding: 0 }';
        document.head.append(style);
      };
      if (document.head) add();
      else
        new MutationObserver((_, observer) => {
          if (document.head) {
            add();
            observer.disconnect();
          }
        }).observe(document, { childList: true, subtree: true });
    });

  /** @returns {string[]} */
  const warnings = (page) => {
    const said = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().includes('wake-marquee')) said.push(message.text());
    });
    return said;
  };

  test('that collapses the spacing says so, rather than failing quietly', async ({ page }) => {
    // Specificity says the library wins, 0,1,0 against 0,0,0. Cascade layers
    // say otherwise: every unlayered declaration beats every layered one. The
    // row still loops, --wake-gap still reads correctly in the devtools, and
    // the items sit flush. It reads as a mistake in the consuming project.
    await withReset(page);
    const said = warnings(page);

    await page.goto(DEMO);
    await settle(page, '#logos', 400);

    // The fixture has to reproduce the bug, or the assertion below proves
    // nothing at all.
    const spacing = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('#logos-row img')).marginInlineEnd),
    );
    expect(spacing).toBe(0);

    expect(said.length).toBe(1);
    expect(said[0]).toContain('@layer');
  });

  test('once for the page, not once for every row on it', async ({ page }) => {
    await withReset(page);
    const said = warnings(page);
    await page.goto(DEMO);
    await scrollThroughPage(page);
    expect(said.length).toBe(1);
  });

  test('and no warning at all when the spacing survives', async ({ page }) => {
    // The demo declares --wake-gap on every row and nothing overrides it. A
    // library that cries wolf here is worse than one that says nothing.
    const said = warnings(page);
    await page.goto(DEMO);
    await scrollThroughPage(page);
    expect(said).toEqual([]);
  });
});

test.describe('starting up', () => {
  /**
   * Sample the row's pattern phase every frame from before the first script
   * runs. All lanes are identical, so the visible quantity is the position of
   * the pattern modulo the lane width, not where lane 0 happens to be: the
   * loop legitimately shifts lane 0 by a whole period, and that is invisible.
   */
  test('the row never jumps as it starts', async ({ page }) => {
    await page.addInitScript(() => {
      window.__samples = [];
      const tick = () => {
        const root = document.querySelector('#logos-row');
        if (root) {
          const lane = root.querySelector('.wake-lane');
          // The third item, not the first: item 1 sits flush at the left
          // edge whatever the spacing is, so it cannot see a --wake-gap that
          // arrives late. Item 3 has two gaps in front of it.
          const items = root.querySelectorAll('img');
          window.__samples.push({
            left: items[2] ? items[2].getBoundingClientRect().left : null,
            period: lane ? lane.getBoundingClientRect().width : 0,
          });
        }
        if (window.__samples.length < 30) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.goto(DEMO);
    await page.waitForTimeout(900);

    const jumps = await page.evaluate(() => {
      const samples = window.__samples.filter((s) => s.left !== null);
      const period = samples.map((s) => s.period).find((p) => p > 0);
      const phase = (left) => (((left % period) + period) % period);
      const out = [];
      for (let i = 1; i < samples.length; i++) {
        const raw = phase(samples[i].left) - phase(samples[i - 1].left);
        // Fold a wrap across the period boundary back onto the short way round.
        out.push(Math.abs((((raw + period / 2) % period) + period) % period - period / 2));
      }
      return out;
    });

    expect(jumps.length).toBeGreaterThan(20);
    // At 55 px/s a frame moves under a pixel. The failures this catches are
    // the overhang (a tenth of the container) and the first transform landing
    // on the wrong phase: both tens to hundreds of pixels.
    expect(Math.max(...jumps)).toBeLessThan(8);
  });

  test('a row below the fold does not jump when it comes into view', async ({ page }) => {
    // The commoner case: prime() skips rows that are off screen, so this one
    // is started by the IntersectionObserver instead.
    //
    // Measured against the container, which is what the reader actually sees,
    // and reached by scrolling in small steps rather than jumping. The wake is
    // a function of scroll position, so a jump moves the row legitimately and
    // a long way; only a smooth approach makes an illegitimate jump stand out.
    await page.addInitScript(() => {
      window.__samples = [];
      const tick = () => {
        const root = document.querySelector('#wake-strong');
        if (root) {
          const lane = root.querySelector('.wake-lane');
          const item = root.querySelector('.word');
          window.__samples.push({
            x: item.getBoundingClientRect().left - root.getBoundingClientRect().left,
            period: lane ? lane.getBoundingClientRect().width : 0,
            live: root.hasAttribute('data-wake-active'),
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.goto(DEMO);
    const target = await page.evaluate(
      () => document.querySelector('#wake').getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.4,
    );
    for (let y = 0; y < target; y += 40) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(24);
    }
    await page.waitForTimeout(400);

    const result = await page.evaluate(() => {
      const samples = window.__samples;
      const period = samples.map((s) => s.period).find((p) => p > 0);
      const phase = (x) => (((x % period) + period) % period);
      let worst = 0;
      let activated = false;
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].live) activated = true;
        const raw = phase(samples[i].x) - phase(samples[i - 1].x);
        const folded = Math.abs((((raw + period / 2) % period) + period) % period - period / 2);
        worst = Math.max(worst, folded);
      }
      return { worst, activated, frames: samples.length };
    });

    expect(result.activated).toBe(true);
    expect(result.frames).toBeGreaterThan(30);
    // A 40px scroll step moves the wake about 9px at wake: 18, and the loop
    // adds well under a pixel. The failure this catches is the overhang being
    // applied without the transform that cancels it: a full amplitude, ~190px.
    expect(result.worst).toBeLessThan(25);
  });

  test('a row loaded mid-passage starts where the static row was', async ({ page }) => {
    // An anchor link, or a reload at a restored scroll position, drops the
    // reader in the middle of a row's passage across the viewport. There the
    // overhang and the wake do not cancel each other, unlike a row entering
    // from the bottom where they very nearly do, and the first frame lands up
    // to a full amplitude away from where the static row was drawn.
    await page.addInitScript(() => {
      window.__samples = [];
      const tick = () => {
        const root = document.querySelector('#wake-strong');
        if (root) {
          const lane = root.querySelector('.wake-lane');
          window.__samples.push({
            x: root.querySelector('.word').getBoundingClientRect().left - root.getBoundingClientRect().left,
            period: lane ? lane.getBoundingClientRect().width : 0,
          });
        }
        if (window.__samples.length < 25) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.goto(`${DEMO}#wake`);
    await page.waitForTimeout(700);

    const result = await page.evaluate(() => {
      const samples = window.__samples;
      const period = samples.map((s) => s.period).find((p) => p > 0);
      const phase = (x) => (((x % period) + period) % period);
      let worst = 0;
      for (let i = 1; i < samples.length; i++) {
        const raw = phase(samples[i].x) - phase(samples[i - 1].x);
        worst = Math.max(worst, Math.abs((((raw + period / 2) % period) + period) % period - period / 2));
      }
      // How far into its passage the row was when it started, so a change in
      // the demo's layout that moves this back to the edges is visible rather
      // than quietly making the test prove nothing.
      const rect = document.querySelector('#wake-strong').getBoundingClientRect();
      const progress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
      return { worst, progress };
    });

    // Guard the guard: at progress near 0 or 1 this test cannot fail.
    expect(result.progress).toBeGreaterThan(0.25);
    expect(result.progress).toBeLessThan(0.9);
    expect(result.worst).toBeLessThan(8);
  });

  test('a lane that resizes under a running row holds its phase', async ({ page }) => {
    // An image with no width/height, or a web font swapping in, changes the
    // lane width while the row is moving. The offset is measured in periods,
    // so it has to be restated in the new one or the row jumps by the
    // difference the moment the content settles.
    await page.goto(DEMO);
    await settle(page, '#logos', 500);

    const jump = await page.evaluate(async () => {
      const root = document.querySelector('#logos-row');
      const lane = root.querySelector('.wake-lane');
      const phase = () => {
        const period = lane.getBoundingClientRect().width;
        const left = root.querySelector('img').getBoundingClientRect().left;
        return { phase: (((left % period) + period) % period) / period, period };
      };

      const before = phase();
      // Widen every item, the way a late font or an unsized image would.
      root.style.setProperty('--wake-gap', '9rem');
      window.marquees.find((m) => m.element.id === 'logos-row').refresh();
      const after = phase();

      // Compare as a fraction of the period, since the period itself moved.
      const raw = after.phase - before.phase;
      return { drift: Math.abs(((raw + 0.5) % 1 + 1) % 1 - 0.5), grew: after.period > before.period };
    });

    expect(jump.grew).toBe(true);
    // Restating the offset is an approximation: the wake displacement is in
    // absolute pixels and does not scale with the period, so a few percent of
    // drift survives. Without it this lands around 0.35 of a period, which is
    // the row visibly leaping a third of its own content.
    expect(jump.drift).toBeLessThan(0.05);
  });

  test('a row on screen is running before the first frame is painted', async ({ page }) => {
    // prime() does the measuring, the cloning and the first transform inside
    // initMarquees(), rather than leaving them to three separate observer
    // callbacks. Without it the reader watches the row assemble itself.
    await page.goto(DEMO);
    const atInit = await page.evaluate(() => {
      const root = document.querySelector('#logos-row');
      return {
        lanes: root.querySelectorAll('.wake-lane').length,
        transformed: root.querySelector('.wake-lane').style.transform !== '',
      };
    });
    expect(atInit.lanes).toBeGreaterThan(1);
    expect(atInit.transformed).toBe(true);
  });
});

test.describe('items that arrive late', () => {
  /**
   * Rewrite the logo row into the shape that actually breaks, and answer it
   * slowly: `<img>` with no width and no height, one wordmark at a time.
   *
   * That is the ordinary markup for a logo strip, and it is the one case
   * where the loop period is unknowable at the moment the row would start.
   * An unloaded image with no dimensions lays out zero pixels wide, so the
   * lane measures its gaps and nothing else, and every logo that lands
   * afterwards restates the period under a row that is already moving.
   *
   * The rewrite has to happen before the demo's module script runs, which is
   * after the document is parsed, so it watches for the row rather than
   * waiting for an event.
   */
  const withSlowUnsizedLogos = async (page) => {
    await page.route('**/slow-logo-*.svg', async (route) => {
      const index = Number(/slow-logo-(\d+)/.exec(route.request().url())[1]);
      const width = 90 + index * 20;
      await new Promise((resolve) => setTimeout(resolve, 120 + index * 80));
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body:
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48">` +
          `<rect width="${width}" height="48" fill="#999"/></svg>`,
      });
    });

    await page.addInitScript(() => {
      const strip = (row) => {
        row.querySelectorAll('img').forEach((img, i) => {
          img.removeAttribute('width');
          img.removeAttribute('height');
          img.src = `/slow-logo-${i}.svg`;
        });
      };
      const now = document.querySelector('#logos-row');
      if (now) strip(now);
      else
        new MutationObserver((_, observer) => {
          const row = document.querySelector('#logos-row');
          if (row) {
            strip(row);
            observer.disconnect();
          }
        }).observe(document, { childList: true, subtree: true });
    });
  };

  /** Sample the row's phase every frame, and whether it is running yet. */
  const watch = (page) =>
    page.addInitScript(() => {
      window.__samples = [];
      const tick = () => {
        const root = document.querySelector('#logos-row');
        const lane = root?.querySelector('.wake-lane');
        const item = root?.querySelector('img');
        if (lane && item) {
          window.__samples.push({
            left: item.getBoundingClientRect().left,
            period: lane.getBoundingClientRect().width,
            // Before the handover the row is a static clipped flex row and is
            // allowed to reflow as its content lands. Only what happens after
            // it starts moving is the library's to answer for.
            running: lane.style.transform !== '',
          });
        }
        if (window.__samples.length < 400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  test('do not lurch the row sideways as they land', async ({ page }) => {
    await withSlowUnsizedLogos(page);
    await watch(page);

    await page.goto(DEMO);
    await settle(page, '#logos', 2500);

    const result = await page.evaluate(() => {
      const samples = window.__samples.filter((s) => s.period > 0);
      const jumps = [];
      for (let i = 1; i < samples.length; i++) {
        if (!samples[i].running || !samples[i - 1].running) continue;
        const period = samples[i].period;
        const phase = (left) => ((left % period) + period) % period;
        const raw = phase(samples[i].left) - phase(samples[i - 1].left);
        jumps.push(Math.abs(((((raw + period / 2) % period) + period) % period) - period / 2));
      }
      const running = samples.filter((s) => s.running);
      return {
        jumps,
        // The fixture has to reproduce the conditions, or this proves nothing:
        // the row must have started on a period several times what it would
        // have measured with every image still in flight.
        started: running.length,
        period: running.at(-1)?.period ?? 0,
        widest: Math.max(...samples.map((s) => s.period)),
      };
    });

    expect(result.started).toBeGreaterThan(30);
    expect(result.period).toBe(result.widest);
    // At 55 px/s a frame moves under a pixel. Starting on the provisional
    // period instead lands this between 100 and 220: the row visibly yanking
    // sideways once for every logo that arrives.
    expect(Math.max(...result.jumps)).toBeLessThan(8);
  });

  test('say so once, because the markup is where this is fixed', async ({ page }) => {
    const said = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().includes('wake-marquee')) said.push(message.text());
    });

    await withSlowUnsizedLogos(page);
    await page.goto(DEMO);
    await scrollThroughPage(page);

    expect(said.length).toBe(1);
    expect(said[0]).toContain('width and height');
  });
});

test.describe('the seam never shows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO);
    await page.evaluate(() => document.fonts.ready);
  });

  test('the lanes always cover the track', async ({ page }) => {
    // The shared transform sits in [-period, 0), so lane 0 covers everything
    // left of the origin and the rest have to span the whole track. Anything
    // less and a gap crosses the row once per period.
    await scrollThroughPage(page);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-wake-marquee]')].map((root) => {
        const lanes = [...root.querySelectorAll('.wake-lane')];
        // The row's own coordinate system, which is where the lanes are
        // translated. Off the screen instead, the rotated rows in #frame
        // report their thickness for their width, and the sum comes out as
        // 360px of content covering a 60px track: true, and about nothing.
        const width = (el) => parseFloat(getComputedStyle(el).width);
        const period = width(lanes[0]);
        return {
          id: root.id,
          lanes: lanes.length,
          covered: (lanes.length - 1) * period,
          track: width(root.querySelector('.wake-track')),
        };
      }),
    );

    // Every row in the document, not a number written down here: a new demo
    // section should be covered by this the moment it is added.
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      expect(row.lanes, `${row.id} was never measured`).toBeGreaterThan(1);
      expect(row.covered, `${row.id} coverage`).toBeGreaterThanOrEqual(row.track);
    }
  });

  test('the lanes butt up against each other with no gap anywhere', async ({ page }) => {
    // The arithmetic test above says there is enough content. This one says it
    // is in the right places: lanes touching edge to edge, the leftmost one
    // starting at or before the track and the rightmost ending at or after it.
    // #few-items is the hard case, with a lane a fraction of the container and
    // six copies of it to place.
    await scrollThroughPage(page);

    const rows = await page.evaluate(() => {
      const width = (el) => parseFloat(getComputedStyle(el).width);
      // Does this row's own axis still line up with the screen's? The edge to
      // edge assertions below are about where lanes land in view, and that is
      // a different question once the container has been turned on its side.
      const upright = (el) => {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          if (getComputedStyle(n).transform !== 'none') return false;
        }
        return true;
      };
      return [...document.querySelectorAll('[data-wake-marquee]')].map((root) => {
        const lanes = [...root.querySelectorAll('.wake-lane')].map((l) => l.getBoundingClientRect());
        const trackEl = root.querySelector('.wake-track');
        const track = trackEl.getBoundingClientRect();
        return {
          id: root.id,
          upright: upright(root),
          count: lanes.length,
          // What laneCount() is supposed to have worked out, from the geometry
          // as rendered rather than from the number it was given.
          needed: Math.ceil(width(trackEl) / width(root.querySelector('.wake-lane'))) + 2,
          narrow: width(root.querySelector('.wake-lane')) < width(trackEl),
          // Positive means a hole between two lanes.
          worstSeam: Math.max(...lanes.slice(1).map((r, i) => r.left - lanes[i].right)),
          leadsTrack: lanes[0].left - track.left,
          trailsTrack: lanes[lanes.length - 1].right - track.right,
        };
      });
    });

    // Splitting the rows is only honest if the page really has both kinds.
    expect(rows.some((r) => !r.upright)).toBe(true);

    for (const row of rows.filter((r) => r.upright)) {
      expect(row.worstSeam, `${row.id} seam`).toBeLessThan(1);
      expect(row.leadsTrack, `${row.id} left edge`).toBeLessThanOrEqual(1);
      expect(row.trailsTrack, `${row.id} right edge`).toBeGreaterThanOrEqual(-1);
    }

    // The count is derived, not configured: enough to cover the track, and
    // not a copy more than the rounding spare calls for.
    for (const row of rows) {
      expect(row.count, `${row.id} lane count`).toBeGreaterThanOrEqual(row.needed);
      expect(row.count, `${row.id} lane count`).toBeLessThanOrEqual(row.needed + 1);
    }

    // The point of the three-item section: its lane really is narrower than
    // the track, so the repeat count is doing work rather than staying at 2.
    const few = rows.find((r) => r.id === 'few-items');
    expect(few.narrow).toBe(true);
    expect(few.count).toBeGreaterThan(3);
  });

  test('a row nobody has scrolled to has done no work at all', async ({ page }) => {
    // The counterpart to the test above, and the reason it has to walk the
    // page first: cloning on first sight is what keeps a page of ten rows
    // from building ten of them before the reader has seen one.
    const untouched = await page.evaluate(() => {
      const root = document.querySelector('#hover-row');
      return { lanes: root.querySelectorAll('.wake-lane').length, active: root.hasAttribute('data-wake-active') };
    });
    expect(untouched.lanes).toBe(1);
    expect(untouched.active).toBe(false);
  });

  test('the wake never spends more than its overhang', async ({ page }) => {
    // The track is exactly `wake` percent wider on each side. Displace it
    // further and the audience sees where the row stops.
    await scrollThroughPage(page);
    const height = page.viewportSize().height;
    for (const y of [0, 0.5, 1, 1.5, 2, 2.5, 3].map((f) => f * height)) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(120);

      const worst = await page.evaluate(() => {
        let worst = 0;
        for (const root of document.querySelectorAll('[data-wake-marquee]')) {
          const track = root.querySelector('.wake-track');
          if (!track) continue;
          const wake = Number(root.dataset.wake ?? 8);
          // Worked out from the markup, so this stays independent of what the
          // library measured, but in the layout rather than off the screen:
          // the overhang is a CSS percentage, and the browser resolves those
          // against the untransformed box.
          const amplitude = (wake * parseFloat(getComputedStyle(root).width)) / 100;
          const x = new DOMMatrix(getComputedStyle(track).transform).m41;
          worst = Math.max(worst, Math.abs(x) - amplitude);
        }
        return worst;
      });

      expect(worst, `overshoot at scrollY ${y}`).toBeLessThan(1);
    }
  });

  test('the page never scrolls sideways', async ({ page }) => {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${width}px`).toBe(0);
    }
  });
});

test.describe('a container that carries a transform', () => {
  /**
   * The #frame section puts four rows around a block, two of them under
   * `rotate(±90deg)`. A transform moves the box on screen and leaves the
   * layout alone, while the loop is written entirely in the layout: the lanes
   * are translated inside the row's own axis, and the overhang is a CSS
   * percentage the browser resolves against the untransformed box. Read the
   * geometry off the screen instead and a row turned on its side runs on
   * numbers wrong by its own aspect ratio, without anything failing loudly.
   */
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO);
    await page.evaluate(() => document.fonts.ready);
    await settle(page, '#frame');
  });

  /** The four frame rows, measured where the loop is written. */
  const geometry = (page) =>
    page.evaluate(() =>
      ['frame-top', 'frame-right', 'frame-bottom', 'frame-left'].map((id) => {
        const el = document.getElementById(id);
        const width = (n) => parseFloat(getComputedStyle(n).width);
        const track = el.querySelector('.wake-track');
        return {
          id,
          layout: width(el),
          screen: el.getBoundingClientRect().width,
          period: width(el.querySelector('.wake-lane')),
          lanes: el.querySelectorAll('.wake-lane').length,
          track: width(track),
          overhang: -parseFloat(getComputedStyle(track).marginInlineStart),
        };
      }),
    );

  test('is a row the screen and the layout disagree about', async ({ page }) => {
    // The premise the rest of this block rests on. Without it every test
    // below would pass on an upright page and prove nothing at all.
    const [top, right, bottom, left] = await geometry(page);
    for (const side of [right, left]) {
      expect(side.screen, `${side.id} on screen`).toBeLessThan(side.layout / 4);
    }
    for (const flat of [top, bottom]) {
      expect(flat.screen, `${flat.id} on screen`).toBeCloseTo(flat.layout, 0);
    }
  });

  test('builds enough lanes to cover the edge it runs along', async ({ page }) => {
    // The reported symptom. Measured off the screen a row turned on its side
    // asks laneCount() for ceil(44 / 44) + 2 lanes however long the edge is,
    // and the last two thirds of it run empty.
    for (const row of await geometry(page)) {
      expect(row.track, `${row.id} track`).toBeCloseTo(row.layout + row.overhang * 2, 0);
      expect((row.lanes - 1) * row.period, `${row.id} coverage`).toBeGreaterThanOrEqual(row.track);
    }
  });

  test('resolves a percentage speed against that same edge', async ({ page }) => {
    // The half of it a plain number survives: resolveSpeed() ignores the
    // width unless the speed is a percentage, so this is the only form that
    // ever notices which box was measured.
    for (const row of await geometry(page)) {
      const measured = Math.abs(await travel(page, `#${row.id}`));
      const asked = row.layout * 0.08; // data-wake-speed="8%" on all four
      expect(measured, `${row.id} px/s`).toBeGreaterThan(asked * 0.85);
      expect(measured, `${row.id} px/s`).toBeLessThan(asked * 1.15);
    }
  });

  test('spends the whole of its overhang on the wake, and no more', async ({ page }) => {
    // The upper bound has its own test across the page, and it held right
    // through the bug: an amplitude measured off the screen errs small, so a
    // rotated row quietly kept a tenth of the wake it was given. This is the
    // other side of the same invariant. Swept past the viewport, every row
    // should reach the reserve that was set aside for it.
    const rows = await geometry(page);
    const ids = rows.map((r) => r.id);
    const worst = Object.fromEntries(ids.map((id) => [id, 0]));
    const height = page.viewportSize().height;
    const frameTop = await page.evaluate(
      () => document.querySelector('.frame').getBoundingClientRect().top + window.scrollY,
    );

    for (const f of [-1.1, -0.75, -0.4, 0, 0.4, 0.75, 1.1, 1.3]) {
      await page.evaluate((to) => window.scrollTo(0, Math.max(0, to)), frameTop + f * height);
      await page.waitForTimeout(120);
      const now = await page.evaluate(
        (list) =>
          Object.fromEntries(
            list.map((id) => {
              const track = document.querySelector(`#${id} .wake-track`);
              return [id, Math.abs(new DOMMatrix(getComputedStyle(track).transform).m41)];
            }),
          ),
        ids,
      );
      for (const id of ids) worst[id] = Math.max(worst[id], now[id]);
    }

    for (const row of rows) {
      expect(worst[row.id], `${row.id} wake reach`).toBeGreaterThan(row.overhang * 0.9);
      expect(worst[row.id], `${row.id} wake overshoot`).toBeLessThan(row.overhang + 1);
    }
  });
});

test.describe('accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO);
    await settle(page, '#logos', 400);
  });

  test('the row is announced once, not once per clone', async ({ page }) => {
    // Eight brands, however many lanes it took to fill the track.
    const named = page.getByRole('img', { name: 'NORDLICHT' });
    await expect(named).toHaveCount(1);
    await expect(page.getByLabel('Brands we stock')).toBeVisible();
  });

  test('clones are inert and out of the accessibility tree', async ({ page }) => {
    const state = await page.evaluate(() =>
      [...document.querySelectorAll('[data-wake-marquee]')].flatMap((root) =>
        [...root.querySelectorAll('.wake-lane')]
          .slice(1)
          .map((lane) => ({ inert: lane.inert, hidden: lane.getAttribute('aria-hidden') })),
      ),
    );

    expect(state.length).toBeGreaterThan(0);
    for (const lane of state) {
      expect(lane.inert).toBe(true);
      expect(lane.hidden).toBe('true');
    }
  });

  test('every image in the row actually rendered', async ({ page }) => {
    // The demo is the fixture, so a broken asset here is a broken test suite:
    // an <img> that fails to decode still has a bounding box and still passes
    // every geometry assertion above it.
    const state = await page.evaluate(() => {
      const images = [...document.querySelectorAll('#logos-row img')];
      return {
        // Finished loading but no intrinsic size: that is a broken asset. An
        // unfinished one is just a lazy original still off to the right.
        broken: images.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.alt),
        loaded: images.filter((i) => i.complete && i.naturalWidth > 0).length,
      };
    });
    expect(state.broken).toEqual([]);
    expect(state.loaded).toBeGreaterThan(8);
  });

  test('clones never lazy-load themselves into a hole in the row', async ({ page }) => {
    // A clone starts off to the right of the track and is translated in. A
    // lazy image there never reaches its loading threshold, so it arrives as
    // a gap. The original keeps its lazy attribute; only copies are eager.
    const loading = await page.evaluate(() => {
      const lanes = [...document.querySelectorAll('#logos-row .wake-lane')];
      return {
        original: lanes[0].querySelector('img').getAttribute('loading'),
        clones: lanes.slice(1).map((l) => l.querySelector('img').getAttribute('loading')),
      };
    });

    expect(loading.original).toBe('lazy');
    expect(loading.clones.length).toBeGreaterThan(0);
    expect(new Set(loading.clones)).toEqual(new Set(['eager']));
  });
});

test.describe('lifecycle', () => {
  test('an off-screen row is not promoted to its own layer', async ({ page }) => {
    await page.goto(DEMO);
    await settle(page, '#logos', 300);
    // will-change is a standing request for compositor memory. A page with
    // eight rows should not hold eight layers for the seven nobody can see.
    const active = await page.evaluate(() =>
      [...document.querySelectorAll('[data-wake-marquee]')].map((r) => r.hasAttribute('data-wake-active')),
    );
    expect(active).toContain(false);
  });

  test('the handle can be found again from the element alone', async ({ page }) => {
    // What the declarative integrations leave behind. wake-marquee/astro and
    // wake-marquee/auto start the rows and keep nothing, and initMarquees()
    // returns only the instances that call created, so asking again over the
    // same content hands back an empty array rather than the running rows.
    await page.goto(DEMO);
    await settle(page, '#logos', 400);

    const found = await page.evaluate(async () => {
      const { getMarquee, initMarquees } = await import('/demo/wake-marquee.js');
      const element = document.querySelector('#logos-row');
      const handle = getMarquee(element);
      handle.pause();

      return {
        same: handle === window.marquees.find((m) => m.element.id === 'logos-row'),
        // The workaround that is not one, kept here so the reason this export
        // exists stays visible.
        secondPass: initMarquees().length,
        paused: getMarquee(element).paused,
        // An element that is not a marquee, and the null a missing selector
        // hands over: neither may throw.
        plain: getMarquee(document.querySelector('h1')),
        missing: getMarquee(document.querySelector('#not-on-this-page')),
        gone: (handle.destroy(), getMarquee(element)),
      };
    });

    expect(found.same).toBe(true);
    expect(found.secondPass).toBe(0);
    expect(found.paused).toBe(true);
    expect(found.plain).toBe(null);
    expect(found.missing).toBe(null);
    expect(found.gone).toBe(null);
  });

  test('destroy puts the markup back the way it was found', async ({ page }) => {
    await page.goto(DEMO);
    await settle(page, '#logos', 400);

    const after = await page.evaluate(() => {
      const root = document.querySelector('#logos-row');
      const before = { images: root.querySelectorAll('img').length, tracks: root.querySelectorAll('.wake-track').length };
      window.marquees.find((m) => m.element.id === 'logos-row').destroy();
      return {
        before,
        images: root.querySelectorAll('img').length,
        tracks: root.querySelectorAll('.wake-track').length,
        lanes: root.querySelectorAll('.wake-lane').length,
        // The markup declared this attribute, so destroy has no business
        // taking it away: the stylesheet still needs it for the static row.
        attribute: root.hasAttribute('data-wake-marquee'),
        travel: root.hasAttribute('data-wake-travel'),
        firstAlt: root.querySelector('img')?.alt,
      };
    });

    expect(after.before.tracks).toBe(1);
    expect(after.before.images).toBeGreaterThan(8);
    expect(after.tracks).toBe(0);
    expect(after.lanes).toBe(0);
    expect(after.images).toBe(8);
    expect(after.attribute).toBe(true);
    expect(after.travel).toBe(false);
    expect(after.firstAlt).toBe('NORDLICHT');
  });

  test('destroy leaves the configuration the markup declared', async ({ page }) => {
    // Every data-wake-* attribute is an option as well as a hook. Taking one
    // away on destroy would quietly change the row the next initMarquees()
    // builds, which is the sort of bug that only shows up on the second run.
    await page.goto(DEMO);
    await settle(page, '#logos', 400);

    const after = await page.evaluate(() => {
      const root = document.querySelector('#logos-row');
      window.marquees.find((m) => m.element.id === 'logos-row').destroy();
      return {
        attributes: [...root.attributes].map((a) => a.name).filter((n) => n.startsWith('data-wake')).sort(),
        inlineStyle: root.getAttribute('style'),
      };
    });

    expect(after.attributes).toEqual(['data-wake', 'data-wake-fade', 'data-wake-gap', 'data-wake-marquee', 'data-wake-speed']);
    // The demo declares both custom properties in its own style attribute, so
    // the static row is laid out correctly before the script runs. The library
    // never set them and must not take them away.
    expect(after.inlineStyle).toBe('--wake-gap:4.5rem;--wake-fade:7rem');
  });
});

test.describe('reduced motion', () => {
  test('every row stands still, transforms cleared', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(DEMO);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    await settle(page, '#logos', 600);
    expect(Math.abs(await travel(page, '#logos-row'))).toBeLessThan(1);

    const transforms = await page.evaluate(() =>
      [...document.querySelectorAll('#logos-row .wake-lane, #logos-row .wake-track')].map(
        (el) => el.style.transform,
      ),
    );
    for (const transform of transforms) expect(transform).toBe('');
  });

  test('the row is still a row, just a static one', async ({ page }) => {
    // The resting state has to look deliberate: items in a line, clipped at
    // the edge. Not a stack, and not a page that scrolls sideways.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(DEMO);
    await settle(page, '#logos', 400);

    const layout = await page.evaluate(() => {
      const images = [...document.querySelectorAll('#logos-row img')].slice(0, 3);
      const tops = images.map((i) => Math.round(i.getBoundingClientRect().top));
      return {
        sameLine: new Set(tops).size === 1,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(layout.sameLine).toBe(true);
    expect(layout.overflow).toBe(0);
  });
});
