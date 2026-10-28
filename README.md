# ChemLab 3D — Gesture Chemistry Lab

An offline MVP that combines a webcam hand-tracking pipeline with a Three.js
chemistry bench. One hand moves a cursor, a pinch grabs a reagent bottle, and
releasing it over the highlighted vessel performs a validated experiment step.

The hand-tracking layer is the original MediaPipe + One Euro + pinch-hysteresis
pipeline. The chemistry layer is new and reuses the reagent bottles, glassware,
and limestone model from the vendored `chemlab-3d` sources.

![stack](https://img.shields.io/badge/MediaPipe-HandLandmarker-00a67e)
![stack](https://img.shields.io/badge/Three.js-0.186-000000)
![stack](https://img.shields.io/badge/TypeScript-strict-3178c6)

## What works

- Local, single-hand MediaPipe tracking with 21 landmarks and a mirrored webcam
  preview. Camera frames never leave the machine.
- Pinch-to-grab with separate close/release thresholds, a 100 ms confirmation
  delay, and hysteresis to suppress noisy repeated gestures.
- 3D carry: hand left/right → X, hand height → Y, and apparent palm-span change
  → relative Z depth. The grab offset is preserved on every axis.
- Two guided experiments with explicit state machines:
  - **White precipitate** — BaCl₂ + H₂SO₄ → BaSO₄↓ + 2HCl.
  - **Limestone fizz** — CaCO₃ + 2HCl → CaCl₂ + CO₂↑ + H₂O.
- Release validation against the actual instrument and vessel, with distinct
  feedback for wrong reagent, wrong vessel, empty-space release, and release
  during an animation.
- Pour animation, liquid colour changes, a settling white precipitate, limestone
  chips, and CO₂ bubbles.
- Selection screen, current-step guidance, progress bar, completion result,
  restart, and return to experiment selection.
- Camera device picker for built-in and external USB webcams.
- Explicit handling for camera denial, no camera, busy/unsupported camera,
  model-load failure with retry, tracking loss, stale camera frames, and page
  shutdown.
- Local model and WASM assets; no runtime CDN or model download.
- Electron desktop shell that serves the production build from
  `http://127.0.0.1` so Chromium grants camera access without a remote server.
- Windows x64 NSIS packaging configuration. It has **not** been built or tested
  on Windows in this environment; see [Desktop app](#desktop-app-electron).

## Requirements

- **Node.js 22 or newer** and npm.
- A webcam for gesture interaction.
- A Chromium-based browser with WebGL and WebAssembly (verified with
  Playwright Chromium). Recent Firefox/Safari builds were not tested.
- A secure context in a browser: `localhost`/`127.0.0.1`, or HTTPS. Plain
  `http://192.168.x.x` will not receive camera access.
- About 35 MB of local MediaPipe model/WASM assets.

## Install and run in a browser

```bash
npm install
npm run dev
```

Open the URL Vite prints (normally <http://localhost:5173/>), allow camera
access, and wait for `Camera ready · model ready`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite development server with HMR |
| `npm run typecheck` | Strict TypeScript check, no emit |
| `npm test` | Gesture/interaction, experiment, and Electron-server checks |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run preview` | Serve the production build over local HTTP |
| `npm run electron:start` | Build, then launch the Electron desktop shell |
| `npm run dist:win` | Build the Windows x64 NSIS installer (must run on Windows) |
| `npm run dist:linux` | Build a Linux AppImage |

## Desktop app (Electron)

`electron/main.cjs` starts a read-only loopback HTTP server for `dist/`, creates
a sandboxed `BrowserWindow` with Node integration disabled, limits media
permission to that local origin, blocks external navigation, and loads the same
renderer as the browser build. `electron/static-server.cjs` is independently
covered by `npm test`.

```bash
npm run electron:start
```

This builds the renderer first. The desktop app has no internet dependency and
was launched successfully from both the development tree and an unpacked Linux
package.

### Windows x64 packaging status

`npm run dist:win` uses `electron-builder` with the `nsis` target and `x64`
architecture, writing artifacts to `release/`. The configuration was validated
by building and launching an unpacked **Linux** package, but:

- The Windows installer was **not** built. This Linux environment has no Wine
  installation, and a Windows build was not run.
- The installer was **not** installed, signed, or launched on Windows.
- Camera permission behavior on Windows (OS privacy settings, antivirus, and
  code-signing reputation) was **not** tested.

Before distributing a Windows build:

1. Run `npm ci && npm run dist:win` on Windows 10/11 x64 (or a Windows CI
   runner with Wine).
2. Install the generated NSIS artifact and verify the camera permission prompt,
   MediaPipe model/WASM loading, both experiments, and uninstall.
3. Add an application icon and code-signing certificate if required.
4. Re-test with the target webcam and machine, not only a fake device.

## Using the lab

1. Hold **one hand** roughly 40–80 cm from the camera with the thumb and index
   fingertip visible.
2. Choose **White precipitate** or **Limestone fizz** in the right panel.
3. Move the cyan ring over a reagent bottle. Hovering highlights it amber.
4. **Pinch** thumb and index together and hold briefly. The ring turns green
   and the bottle is carried.
5. Carry the bottle over the highlighted vessel. The target turns green and the
   scene says `Release now`.
6. **Release the pinch** over the target. A valid release plays the pour; an
   invalid release returns the bottle and shows corrective feedback.
7. After the final validated step, the reaction animation plays, the result
   banner appears, and the experiment is marked complete.
8. Use **Restart** to reset the same experiment or **Choose another** to return
   to selection.

While a held object is being carried, the right side of the scene shows whether
the release point is over a valid target. Tracking loss during a hold returns
the instrument to the bench and never advances an experiment.

### Hand-to-world mapping

| Hand signal | World axis | Mapping |
| --- | --- | --- |
| Mirrored palm-anchor X | X | central 70% of the image (`0.15`–`0.85`) → `-2.9`…`+2.9` |
| Palm-anchor Y | Y | `(0.5 - y) × 5.5`; higher in frame is higher in the scene |
| Palm span ÷ span at grab | Z | `(clamped ratio - 1) × 3.2`; larger span (closer hand) → `+Z` |

The aiming anchor is the average of the four knuckle landmarks (index, middle,
ring, and pinky MCPs; MediaPipe indices 5, 9, 13, 17). The fingertips are used
**only** for pinch detection. This matters: closing a pinch moves the thumb
and/or index tips, so a thumb/index midpoint cursor drifts away from the object
the user aimed at exactly when the grab is confirmed. The knuckles stay put.

On the confirmation frame the hover is refreshed first and the currently
hovered grabbable object is grabbed, with a cursor pick as fallback. This keeps
selection stable even if the mapped cursor moves slightly during the pinch.

Palm span is the average of index-MCP↔pinky-MCP width and wrist↔middle-MCP
length, both measured in 2D image space. MediaPipe's landmark `z` is
wrist-relative, not metric, so it is deliberately excluded. The ratio is
clamped to `0.55`–`1.8`. Depth is **relative to the grab pose**, not a metric
depth measurement, and is re-referenced on every grab.

The pinch ratio is `distance(thumb tip, index tip) / palm size`. A pinch starts
below **0.32**, is confirmed after **100 ms**, and releases above **0.48**.
Thresholds live in `src/gesture.ts`.

## Experiments

| Experiment | Equation | Step 1 | Step 2 | Final effect |
| --- | --- | --- | --- | --- |
| White precipitate | BaCl₂ + H₂SO₄ → BaSO₄↓ + 2HCl | BaCl₂ bottle → beaker | dilute H₂SO₄ bottle → same beaker | cloudy liquid and white BaSO₄ particles settle |
| Limestone fizz | CaCO₃ + 2HCl → CaCl₂ + CO₂↑ + H₂O | limestone jar → Erlenmeyer flask | dilute HCl bottle → same flask | chips dissolve and CO₂ bubbles rise |

Both experiments are data-driven in `src/lab/experiments.ts`. The engine only
advances after a release whose reagent **and** target match the current step.
The scene validates the target independently with its own raycast/position
check before the engine is asked to accept the transfer.

## Architecture

```text
index.html                     lab layout, webcam panel, experiment guide
src/main.ts                    boot, camera lifecycle, rAF loop, UI, orchestration
src/handTracking.ts            getUserMedia, camera switching, MediaPipe, smoothing
src/gesture.ts                 pinch thresholds, confirmation, hysteresis, re-arm
src/interaction.ts             hand→world mapping, grab/carry/release, loss recovery
src/scene.ts                   shared scene interfaces + original demo scene
src/filter.ts                  One Euro filter
src/lab/experiments.ts         experiment definitions and deterministic state machine
src/lab/models.ts              reagent/glassware wrappers, liquids, bubbles, precipitate
src/lab/scene.ts               lab room, instruments, picking, highlights, animations
src/style.css                  responsive dark lab UI
electron/main.cjs              sandboxed desktop window and permission policy
electron/static-server.cjs     read-only loopback server for dist/
tests/logic-check.test.ts      gesture, filter, and interaction checks
tests/experiment-check.test.ts state machine, validation, and gesture bridge
tests/static-server.test.ts    MIME types, HEAD/POST, traversal guard
public/models/                 local hand_landmarker.task
public/mediapipe/wasm/         local SIMD and non-SIMD MediaPipe WASM
```

Data flow per frame:

```text
webcam frame
  → MediaPipe HandLandmarker (VIDEO, one hand, CPU)
  → One Euro landmark smoothing
  → pinch recognizer
  → mapped palm-anchor X/Y and palm-span depth ratio
  → camera ray through the projected cursor
  → hover / grab / carry
  → release position
  → scene target lookup
  → ExperimentEngine.attemptTransfer(reagentId, targetId)
  → pour animation → apply addition → final reaction animation
  → completion UI
```

The hand pipeline only emits `onGrab`, `onRelease(object, position, reason)`,
and a small snapshot for the HUD. It has no chemistry imports. `main.ts` is the
only place that joins the gesture events to the experiment engine and scene.

### Why the scene is served over HTTP in Electron

`getUserMedia` requires a secure context. `file://` is not a reliable secure
origin for camera access, so the desktop shell serves `dist/` on
`127.0.0.1` with an ephemeral port. The server is read-only, rejects path
traversal, and is closed before the app quits.

### Why the chemlab room builder is not reused directly

The vendored `chemlab-3d` project includes a room builder that fetches remote
Wikipedia portraits. This MVP reuses its **model and reaction builders** but
builds a custom lab room, so the app stays fully offline.

## Offline assets and privacy

- Camera frames are processed locally. There is no upload, recording, or remote
  inference.
- `public/models/hand_landmarker.task` and `public/mediapipe/wasm/` are bundled
  with the app and copied into `dist/` by Vite.
- Browser verification observed no requests outside the app origin.
- MediaPipe is Apache-2.0 licensed; Three.js is MIT licensed. Model usage is
  subject to the upstream MediaPipe model terms.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

All three pass. Browser verification covered:

- cold load with a fake camera, model/WASM loading from local assets;
- camera denied, no camera, model 404, and retry recovery;
- both experiments driven through the real release handler, pour, reaction,
  progress, completion, restart, and return-to-selection;
- an interaction regression run in the real app with synthetic landmarks: an
  asymmetric (thumb-only) pinch grabbed the real reagent bottle, carried it in
  X/Y and relative depth, released it over the beaker to advance the experiment,
  dropped safely on tracking loss, and re-armed after restart;
- a release in empty space followed by moving the hand: the instrument settled
  back at rest instead of continuing to follow the free hand;
- visual screenshots after each step and after completion for both experiments;
- production Electron launch, packaged Electron launch, and zero external
  requests.

The mapping, pinch thresholds, drag offset, depth clamp, transformed-parent
handling, empty-pinch rejection, and loss recovery are also covered by
`npm test`. Physical webcam testing, real-hand gesture testing, Firefox/Safari,
Windows packaging, and Windows camera permissions were **not** performed. See
[VERIFICATION.md](VERIFICATION.md) for the detailed matrix and
[ENGINEERING_REPORT.md](ENGINEERING_REPORT.md) for the implementation report.

The production JavaScript chunk is about 873 kB (224 kB gzip). Vite warns that
it exceeds 500 kB; this is expected for a Three.js + MediaPipe bundle. The
local model and WASM assets add roughly 34 MB.

## Known limitations

- **One hand, one gesture.** No multi-hand, complex gestures, or calibration.
- **Depth is relative, not metric.** Palm-span change is a proximity signal, not
  a distance measurement. It can drift with hand rotation or noisy landmarks and
  is re-referenced on every grab; it is not MediaPipe's `z` value.
- **Aiming uses knuckles.** The cursor follows the knuckle centre rather than the
  fingertips, so it stays stable during a pinch but is less precise for very
  small targets than a fingertip cursor.
- **No physical webcam validation.** Gesture and depth logic were tested with
  synthetic landmarks, unit tests, and the in-app interaction bridge, not a real
  hand in front of a camera.
- **No collision or physics.** A carried bottle can pass through other objects;
  only the release target is validated.
- **One release target at a time.** Each experiment has one destination vessel.
- **Desktop-focused.** Responsive layout exists, but mobile camera/orientation
  behavior and touch were not tested.
- **Chromium-first.** Standard web APIs are used, but Firefox/Safari device
  coverage is untested.
- **Windows packaging is unverified.** The NSIS configuration exists, but the
  installer was not built or tested on Windows here.
- **Large static payload.** The local model and both WASM variants are about
  34 MB; first load is not instant, and there is no CDN fallback by design.

## Development-only verification hook

In `npm run dev`, `window.__chemlabDev` exposes experiment start/restart/select,
snapshot reading, instrument listing/positions, the interaction snapshot, and
`runCurrentStep()`. It also accepts `setSyntheticHand(landmarks | null)`, which
replaces the tracker output only in the dev build so browser tests can drive the
real scene and interaction loop without a physical hand. `runCurrentStep()` calls
the same release handler used by the hand controller, so it exercises the real
orchestration and animations. `setTimeScale()` accelerates scene time for slow
headless software-WebGL verification. `import.meta.env.DEV` is false in the
production build, and the packaged-app check confirmed the hook is absent.

## Out of scope

General chemistry simulation, stoichiometry, arbitrary reagents, physics
collisions, metric depth sensing, full 3D hand reconstruction, user accounts,
persistence, multi-hand gestures, localization, and production-grade
accessibility were not part of this MVP. Windows packaging is scaffolded but
not verified.
# ChemLab3D
