# Verification Report

## Environment

| Item | Value |
| --- | --- |
| OS | Linux (Fedora 7.2.9 kernel, x86_64) |
| Node.js / npm | 22.23.1 / 10.9.8 |
| Vite / TypeScript | 8.3.5 / 7.0.2 |
| Three.js | 0.186.1 |
| MediaPipe tasks-vision | 1.1.1 |
| Electron / electron-builder | 45.1.0 / 26.18.0 |
| Browser checks | Playwright Chromium, headless, fake media device |
| Desktop checks | Electron development tree and unpacked Linux package |

No physical webcam, real hand, Windows machine, or Windows installer was
available. Those areas are listed as gaps, not as passes.

## Commands

| Check | Command | Result |
| --- | --- | --- |
| Strict TypeScript | `npm run typecheck` | **Pass** |
| Automated tests | `npm test` | **Pass** — 3 test files |
| Production build | `npm run build` | **Pass** — only the expected >500 kB chunk warning |
| Electron development launch | Playwright `_electron` against `electron/main.cjs` | **Pass** |
| Packaged Linux launch | `npx electron-builder --linux --dir`, then Playwright `_electron` | **Pass** |

### Build output

```text
dist/index.html                   8.22 kB │ gzip:   2.29 kB
dist/assets/index-*.css          11.12 kB │ gzip:   3.27 kB
dist/assets/index-*.js          872.20 kB │ gzip: 223.92 kB
dist/models/hand_landmarker.task  ~7.5 MB
dist/mediapipe/wasm/             ~26 MB
```

The chunk-size warning is expected for a bundle containing Three.js and the
MediaPipe tasks API. It is not a build failure.

## Automated test coverage

### `tests/logic-check.test.ts`

- Pinch close/release thresholds, 100 ms confirmation, hysteresis, and re-arm.
- One Euro smoothing, step response, and reset.
- Cursor mapping, hover, grab, release, and re-grab.
- Stable palm-anchor calculation and direct anchor→world mapping.
- Asymmetric pinch regression: the thumb moves to a stationary index, hover is
  retained, and the grab succeeds.
- X/Y/Z movement, lift, upper Y clamp, relative depth in both directions, and
  depth clamp.
- Grab-offset preservation on all axes.
- World-space movement through a transformed parent group.
- Empty-space pinch and status feedback.
- Tracking-loss grace, dropping a held object, cursor hiding, and recovery
  without an immediate re-grab.

### `tests/experiment-check.test.ts`

- Both experiments start in `running` with the correct step count.
- Wrong reagent, wrong vessel, and empty-space release are rejected without
  advancing.
- Correct first step enters `animating`, blocks a second transfer, then returns
  to `running` after `finishStep()`.
- The final step does not complete until the reaction finishes.
- Completed experiments reject further transfers.
- Restart resets phase, step, completion, and progress.
- Limestone uses the `bubbles` effect.
- Gesture bridge: a synthetic asymmetric pinch, carry, and release over the
  target advances exactly one step; tracking loss releases the object and does
  not advance.

### `tests/static-server.test.ts`

- Serves `index.html`, JavaScript, CSS, WASM, and `.task` files with the correct
  MIME types.
- Supports `HEAD` and rejects `POST` with `405` and an `Allow` header.
- Returns `404` for missing files.
- A raw percent-encoded parent path cannot escape the served root.
- Returns a valid loopback URL and origin.

## Browser scenarios

All browser checks used Playwright Chromium with
`--use-fake-device-for-media-stream` and granted camera permission. The fake
camera supplies a synthetic image, not a hand.

| Scenario | Expected | Result |
| --- | --- | --- |
| Cold load | Progress from `Starting camera…` to `Camera ready · model ready` and `No hand detected` | **Pass** |
| Local assets | Model and WASM load from the app origin; no external requests | **Pass** |
| Selection screen | Test tube, beaker, and Na₂CO₃ bottle render; both experiment cards visible | **Pass** |
| Start precipitation | Beaker, BaCl₂, and H₂SO₄ instruments load; step 1 and 0% progress shown | **Pass** |
| Start limestone | Flask, limestone jar, and HCl load; step 1 shown | **Pass** |
| Precipitation step 1 | Pour animation; beaker gains liquid; progress 50%; step 2 becomes current | **Pass** |
| Precipitation step 2 | Reaction plays only after the final validated step; liquid becomes cloudy; white particles settle | **Pass** |
| Precipitation completion | `Complete` pill, 100% progress, both steps checked, BaSO₄ result banner | **Pass** |
| Limestone step 1 | Limestone chips appear in the flask; progress 50% | **Pass** |
| Limestone step 2 | Chips dissolve and CO₂ bubbles rise; liquid appears | **Pass** |
| Limestone completion | `Complete` pill, 100% progress, CO₂ result banner | **Pass** |
| Transfer after completion | Rejected with `not-interactive:complete`; no state change | **Pass** |
| Restart | Scene rebuilds empty; phase returns to step 1; progress 0% | **Pass** |
| Choose another | Scene returns to selection; selection panel visible | **Pass** |
| Camera permission denied | `Camera unavailable`; permission explanation; retry visible | **Pass** |
| No camera found | `Camera unavailable`; “No camera was found”; retry visible | **Pass** |
| Model file 404 | Model error banner with the failing URL and retry control | **Pass** |
| Retry after model failure | Second model request succeeds; status reaches `No hand detected` | **Pass** |
| Retry after camera denial | Retry opens the camera and loads the model | **Pass** |
| Completion banner placement | Banner sits above the scene instruction and does not cover the reaction vessel | **Pass** |

### End-to-end experiment observations

The dev-only bridge used the same `handleRelease` path as the hand controller.
Scene time was accelerated only to compensate for headless software WebGL
rendering at roughly 1–2 fps; production time is unchanged.

Precipitation:

```text
instruments: beaker (target), bacl2, h2so4
step 1: ok, phase running, stepIndex 1, progress 50%
step 2: ok, phase complete, stepIndex 2, progress 100%
complete: "BaSO₄ precipitate formed…", banner visible, both steps checked
extra step after completion: rejected (not-interactive:complete)
restart: phase Step 1/2, progress 0%, completion hidden
```

Limestone:

```text
instruments: flask (target), caco3, hcl
step 1: ok, phase running, stepIndex 1, progress 50%
step 2: ok, phase complete, stepIndex 2, progress 100%
complete: "Carbon dioxide released…", banner visible, both steps checked
extra step after completion: rejected (not-interactive:complete)
restart: phase Step 1/2, progress 0%, completion hidden
```

Screenshots collected during verification showed:

- BaCl₂ and H₂SO₄ bottles around a beaker labelled `drop target`;
- the beaker filling after step 1;
- a cloudy white beaker with settled particles after step 2;
- limestone chips in the jar and flask after step 1;
- bubbles and dissolving chips after step 2;
- the result banner below the vessels, leaving the reaction visible.

### Synthetic-hand interaction regression in the real app

The dev bridge injected 21 synthetic landmarks into the live `main.ts` loop, so
the real MediaPipe-independent interaction path, `ChemistryScene` raycasting,
instrument hierarchy, and experiment handler ran unchanged. This is not a
physical-webcam test, but it is a real-app test rather than an isolated unit
test.

Observed sequence for the precipitation experiment:

```text
open hand over BaCl₂          gesture Idle,    hovered BaCl₂, selected none
asymmetric pinch (thumb only) gesture Holding, selected BaCl₂ at (-2.05, 1.04, 0.10)
carry to beaker + closer      selected BaCl₂ at (0.00, 1.29, 1.22), depth +1.12
open pinch over beaker        selected none, stepIndex 1, feedback accepted
move hand after release       selected none; bottle follows the pour animation
```

Depth-only check on H₂SO₄ while holding, at a different bench position:

```text
palm span 1.45×   depth +1.44   object z  1.54
palm span 0.70×   depth -0.96   object z -0.86
```

Safety and reset checks:

```text
release in empty space, then move hand to (-2.05, 2.60):
  selected none; instrument settles back at rest (2.05, 1.04, 0.10),
  proving it no longer follows the hand
tracking loss while holding:
  selected none, status "No hand", instrument returns to rest, no step advance
restart:
  selected none, aim/depth cleared, reagent back at rest, re-grab succeeds
```

The diagnostic HUD reported `Aim XYZ`, `Depth ΔZ` (offset and palm-span ratio),
pinch value, cursor visibility, and the last grab/reject/release action during
these runs.

## Desktop and packaging checks

### Development Electron launch

- Window loaded `http://127.0.0.1:<ephemeral>/`.
- Camera and model initialized (`No hand detected`, `Camera ready · model
  ready`).
- Both experiment cards rendered; starting **Limestone fizz** loaded the flask,
  jar, and HCl instruments.
- Model, WASM, CSS, and JavaScript came from the loopback origin.
- No external requests and no page errors.
- The dev hook is present only in development.

### Packaged Linux build

`npx electron-builder --linux --dir` completed and produced
`release/linux-unpacked`.

| Check | Result |
| --- | --- |
| App starts from packaged `app.asar` | **Pass** |
| Camera/model initialize | **Pass** |
| Local server serves assets from inside asar | **Pass** |
| Model and WASM requested from loopback origin | **Pass** |
| No external requests | **Pass** |
| Dev hook absent in packaged build | **Pass** |
| `app.isPackaged` is true | **Pass** |

The asar contains the `dist` build and Electron files but no `node_modules`,
because Three.js and MediaPipe are bundled by Vite. The packaged asar is about
34 MB.

## Gaps and unverified behavior

- **No physical webcam.** The fake camera produced an image but no hand. Real
  hand detection, handedness, landmark quality, pinch thresholds, relative
  depth direction with a real hand, tracking loss, and camera switching between
  physical devices were not tested. The synthetic-hand regression above
  validates the code path but cannot predict real-hand jitter, lighting, or
  occlusion.
- **No real-hand experiment completion.** Experiment completion was driven
  through synthetic landmarks and the dev bridge, not by pinching in front of a
  camera. The gesture-to-experiment bridge is covered by synthetic landmark
  tests and the real-app synthetic-hand run.
- **No Windows build or installer test.** `npm run dist:win` was not executed.
  No Windows machine, Wine, code signing, or Windows camera privacy settings
  were available. The Linux unpacked build validates the packaging
  configuration only.
- **No Firefox, Safari, mobile, or touch testing.** Browser coverage is
  Chromium-first.
- **No performance measurement on real hardware.** Headless software WebGL was
  slow; the app is expected to be much faster with GPU acceleration, but frame
  rate and detection latency were not measured on a target laptop.
- **No collision/physics validation.** Instruments can overlap or pass through
  each other; only the release target is validated.
- **No long-duration soak test.** Repeated restarts, camera hot-plug, sleep/
  resume, and multi-hour tracking were not exercised.
- **No accessibility audit.** Keyboard-only operation is not supported for the
  gesture interaction, and the 3D labels are not exposed to assistive
  technology.

## How to reproduce

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

For the desktop shell:

```bash
npm run electron:start
```

For a Linux unpacked package:

```bash
npx electron-builder --linux --dir
```

For Windows x64, run on Windows or a suitable CI runner:

```bash
npm run dist:win
```

The Windows installer path is generated under `release/`, but this report does
not claim that it was built or tested.
