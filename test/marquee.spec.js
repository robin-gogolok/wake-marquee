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
      const period = lane.getBoundingClientRect().width;
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
        const period = lanes[0].getBoundingClientRect().width;
        return {
          id: root.id,
          covered: (lanes.length - 1) * period,
          track: root.querySelector('.wake-track').getBoundingClientRect().width,
        };
      }),
    );

    expect(rows.length).toBe(6);
    for (const row of rows) {
      expect(row.covered, `${row.id} coverage`).toBeGreaterThanOrEqual(row.track);
    }
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
          const amplitude = (wake * root.getBoundingClientRect().width) / 100;
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
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll('#logos-row img')]
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.alt),
    );
    expect(broken).toEqual([]);
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
    // The library set --wake-gap and --wake-fade from those attributes, so
    // both come back off and no empty style attribute is left behind.
    expect(after.inlineStyle ?? '').toBe('');
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
