/**
 * Side-effect entry point: start every `[data-wake-marquee]` on the page.
 *
 *   import 'wake-marquee/auto'
 *
 * Each element is configured by its own `data-wake-*` attributes, so this is
 * the whole integration for a page that has no build step to speak of. Reach
 * for `createMarquee` instead when you want a handle to pause, refresh or
 * tear down.
 *
 * @module wake-marquee/auto
 */

import { initMarquees } from './marquee.js';

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initMarquees(), { once: true });
  } else {
    initMarquees();
  }
}

export { initMarquees };
