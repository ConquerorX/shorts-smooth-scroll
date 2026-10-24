# Shorts Smooth Scroll

<img src="icons/icon128.png" width="88" align="right" alt="Shorts Smooth Scroll icon" />

[![Manifest V3](https://img.shields.io/badge/manifest-v3-c00?style=flat-square)](manifest.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-23%20passing-brightgreen?style=flat-square)](#testing)
[![YouTube](https://img.shields.io/badge/verified%20on-youtube.com%2Fshorts-c00?style=flat-square)](#verified-on-the-real-site)

**English** · [Türkçe](README.tr.md)

A tiny extension that fixes janky YouTube Shorts scrolling in Chromium browsers
(Chrome, Edge, Brave, Opera, Vivaldi).

One wheel notch = exactly one Short. No skipped videos, no stalls, no bouncing
between two reels.

## The problem

Scrolling Shorts on desktop feels broken in a very specific way: sometimes
nothing moves, sometimes it jumps two videos, sometimes it stops halfway. That is
not one slow component — it is **three mechanisms fighting over the same scroll**:

1. **Chromium's smooth wheel animation** turns a single notch into a pixel-based
   animated scroll.
2. **`scroll-snap-type: y mandatory`** starts its *own* snap animation in the
   middle of that animation and cancels the first one.
3. **YouTube's own scroll handling** swaps the active video and mounts a new reel
   element while all of that is still in flight.

The result: the scroll position never belongs to any one mechanism, so it stalls,
overshoots, or snaps back. Firefox feels better mostly because its wheel
animation and snapping collide less aggressively.

This extension removes the collision instead of tuning it: it takes over the
wheel gesture, animates the scroll itself, and temporarily disables scrolling
snap while it does so.

## Features

- **Deterministic stepping.** A wheel *gesture* maps to exactly one video. Chromium
  sometimes delivers one notch as a single event and sometimes as 3–4 small
  events — the gesture machine is immune to that split.
- **Genuinely smooth motion.** Frame-rate independent exponential approach, so
  dropped frames change the step size, not the duration. No overshoot, no bounce.
- **Seamless chaining.** Start a new gesture mid-animation and the target moves;
  the motion continues without stopping, restarting, or jumping.
- **Hands off everything else.** Nested scroll areas (comment panel, description),
  `Ctrl`+wheel zoom, touch input and the rest of the page behave natively.
- **Two modes and three speeds**, with a live preview on any open Shorts tab.
- **Localized UI** (English + Turkish) via `chrome.i18n`; add a folder to add a language.
- **No network access, no analytics, no background service worker.** One content
  script on `youtube.com`, `storage` permission only.

## Install

The extension is not on the Chrome Web Store — load it as an unpacked extension.

1. Clone or download this repository.
2. Open `chrome://extensions` (`edge://extensions`, `brave://extensions`,
   `opera://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the repository folder (the one containing
   `manifest.json`).
5. Open a Shorts tab. Existing tabs pick up setting changes instantly.

To update after pulling changes, press the reload (⟳) button on the extension card.

## Settings

Click the toolbar icon:

| Setting | Values | Default |
| --- | --- | --- |
| **Enabled** | on / off | on |
| **Scroll mode** | *One gesture = one short* / *Smooth* | one gesture = one short |
| **Animation** | Fast (240 ms) / Normal (420 ms) / Soft (620 ms) | Normal |

- **One gesture = one short** — every wheel gesture lands on exactly one video.
  A fast flick still moves one step; keep spinning and steps repeat at a steady
  cadence (like key repeat).
- **Smooth** — native scrolling runs during the gesture (snap is muted), then the
  feed glides to the nearest video when the gesture ends. This is the closest to
  Firefox's feel.

Settings live in `chrome.storage.sync`, so they follow your Chrome profile.

## How it works

### Real DOM (October 2026)

```
#shorts-container              <- the scroll container, scroll-snap-type: y mandatory
  #shorts-inner-container      <- overflow: visible
    div.reel-video-in-sequence-new   (720px)   <- one per Short
      #reel-overlay-container
        ytd-reel-video-renderer   <- only exists inside the active video
```

Notice that `ytd-reel-video-renderer` is **not** the list of items anymore — it
only exists inside the currently playing Short. The extension therefore never
depends on tag or class names: it finds the deepest scrollable element under
`ytd-shorts` and treats children taller than half the viewport as "pages"
(zero-height template divs are filtered out). This also means a mismatch between
item height and container height (720 px vs 744 px on the live site) doesn't
drift.

### Scroll pipeline

```
wheel (capture, passive: false)
  ├─ ignore: ctrl+wheel, nested scroller under the cursor, clicks outside the feed
  ├─ flow mode  → mute snap during the gesture, align to nearest item on settle
  └─ step mode  → preventDefault
        gesture machine: 1 gesture → 1 step (30px threshold, 150ms quiet gap,
                          one extra step per 420ms while spinning)
        resolve target: nearest item offset + direction (falls back to a
                        viewport-sized step if the DOM is unrecognizable)
        glide: x += (target - x) * (1 - e^(-λ·dt)), λ = 4560 / duration
        per frame: scroll-snap + scroll-behavior forced to none, restored on finish
```

Why exponential approach instead of a fixed easing curve:

- it is **frame-rate independent** (a 30 fps hitch produces a bigger step, not a
  longer animation);
- changing the target mid-flight keeps the current velocity — chained gestures
  never stop and restart;
- it never overshoots, so you never see the next video peek in.

### Verified on the real site

Tested against live `youtube.com/shorts` (October 2026): three wheel notches moved
the feed `0 → 720 → 1440 → 2160` — exactly the item boundaries — with zero
backwards jumps and no console errors.

## Localization

All UI strings live in `_locales/<lang>/messages.json` and are read through
`chrome.i18n`, including the manifest name and description:

```
_locales/
  en/messages.json   (default_locale)
  tr/messages.json
```

Adding a language is a single folder plus a `messages.json` copy. Popup markup
uses `data-i18n` keys, so no code changes are needed.

## Testing

```bash
npm install
npm test              # 23 tests: unit + DOM e2e + real extension in real Chrome
npm run test:unit     # pure logic, no browser
npm run test:e2e      # fixture page, real wheel events
```

| File | What it proves |
| --- | --- |
| `test/core.test.js` | Gesture machine (split notches, trackpad accumulation, direction flips, repeat cadence), geometry, lambda/smoothing math |
| `test/e2e.test.js` | Real wheel events against a DOM that mirrors the live Shorts layout: one notch = one video, split notch ≠ two videos, fast bursts don't skip, comments panel isn't hijacked, smooth mode aligns, animation is monotonic and lands exactly, mid-flight retargeting chains |
| `test/extension.test.js` | The unpacked extension is loaded by real Chrome, takes over scrolling on a `youtube.com` origin, and its popup localizes + persists settings |

Notes:

- Chrome 137+ removed the `--load-extension` switch, so the extension test loads
  the unpacked folder through the DevTools Protocol (`Extensions.loadUnpacked`).
  That still validates that Chrome parses and accepts the manifest.
- Tests use `puppeteer-core` with the Chrome you already have (override with
  `CHROME_PATH`), so no second browser download.

## Project structure

```
manifest.json            MV3 definition, i18n keys, icons
_locales/{en,tr}/        UI translations
src/core.js              pure logic: gesture machine, offsets, smoothing math
src/content.js           DOM layer: discovery, wheel capture, animation, modes
src/popup.html|.js       settings UI (localized)
icons/                   generated PNGs
scripts/make-icons.js    icon generator (no image dependencies)
test/                    unit, e2e and real-extension tests + fixture
```

## Debug API

Open the console on any Shorts tab:

```js
__shortsSmoothScroll.state()                      // container, item count, animating
__shortsSmoothScroll.getConfig()                  // { enabled, mode, duration }
__shortsSmoothScroll.configure({ duration: 620 }) // soft
__shortsSmoothScroll.configure({ mode: 'flow' })
__shortsSmoothScroll.step(1)                      // programmatic single step
```

## Limitations

- **Touch screens and mobile are out of scope.** There is no wheel event, and
  native snapping already works well there.
- Keyboard navigation (`↑` / `↓`) is left to YouTube's own handler.
- If YouTube renames every container and stops using a real scroll container, the
  extension simply stops interfering (`findScroller` / `findItems` in
  `src/content.js` are the two places to update).
- Memory growth in a long Shorts session is YouTube's own issue; this extension
  changes scroll behavior, not the video pipeline.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nothing changed on an open tab | Reload the tab (`Ctrl`+`R`); content scripts only inject on page load |
| Too floaty / too snappy | Switch **Animation** between Fast / Normal / Soft |
| Comment panel feels weird | It should stay native; if not, open an issue with the DOM dump from `__shortsSmoothScroll.state()` |
| Scrolling is dead on Shorts | Disable the extension to confirm, then reload — and please report the YouTube DOM version |

## License

[MIT](LICENSE)
