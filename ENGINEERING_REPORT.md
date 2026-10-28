# Engineering Report — ChemLab 3D Gesture Lab MVP

## 1. Summary

This MVP integrates the existing webcam hand-tracking prototype with the
vendored `chemlab-3d` model/reaction library. The result is a single offline
application in which one hand controls a 3D cursor, pinches reagent bottles,
carries them in three dimensions, and releases them over a target vessel to
perform one of two deterministic chemistry experiments.

The hand pipeline remains the original MediaPipe HandLandmarker + One Euro
filter + pinch hysteresis implementation. Chemistry rules are isolated in a
framework-free state machine. The Three.js scene consumes only small scene
interfaces, and `main.ts` is the orchestration boundary between gestures,
experiments, and rendering.

Verified in this environment:

- strict TypeScript, all automated tests, and production build;
- both experiments end-to-end through the real release/pour/reaction path;
- a real-app synthetic-hand regression covering asymmetric pinch, 3D carry,
  depth, release, tracking loss, and restart;
- camera denial, missing camera, model failure, and retry paths;
- Electron development launch and an unpacked Linux package;
- local-only asset loading with no external requests.

Not verified:

- a physical webcam or real hand;
- Windows x64 installer creation, installation, signing, or camera permission;
- Firefox, Safari, mobile, or long-duration operation.

## 2. Integration boundary

### Hand tracking (preserved)

`src/handTracking.ts` still configures MediaPipe with a local model and local
WASM, uses `runningMode: "VIDEO"`, one hand, CPU delegate, and returns 21
smoothed landmarks. `src/filter.ts` and `src/gesture.ts` are unchanged in
behavior. Camera switching was added through `startCamera(deviceId?)`,
`listCameras()`, and `cameraDeviceId`.

### Interaction controller (extended)

`src/interaction.ts` now exposes:

```ts
interface InteractionEvents {
  onGrab?: (object: SceneObject) => void;
  onRelease?: (object, position, reason: "user" | "lost" | "reset") => void;
}
```

The chemistry layer never sees MediaPipe. It receives a grabbed object, a final
position, and a release reason. `grabbable: false` instruments (vessels) are
skipped during picking. Tracking loss releases a held object with reason
`"lost"`, which is deliberately not treated as a valid experiment action.

### Grab failure: confirmed root cause and fix

The reported failure was reproducible with the real `ChemistryScene` and
synthetic landmarks. Pinch detection, confirmation, raycasting, transforms, and
release all worked; the first failing stage was **object selection on the grab
confirmation frame**.

The old cursor used the midpoint of the thumb tip and index tip. That midpoint
is stable for a symmetric pinch, but a real pinch usually moves one fingertip
more than the other. When the thumb travels to a stationary index, the midpoint
moves by half the closure distance. By the time the pinch was confirmed
(100 ms), the cursor had drifted off the bottle. `tryGrab()` then re-picked at
the shifted cursor, missed the bottle, and never emitted `onGrab`. The observed
symptom was exactly `Hovering BaCl₂` on the open frame, then `No object
grabbed` after the pinch.

Fixes in `src/interaction.ts`:

1. **Stable aiming anchor.** The cursor now uses the average of the four knuckle
   landmarks (MediaPipe 5, 9, 13, 17). Fingertips remain pinch-only inputs, so
   closing a pinch cannot move the aim point.
2. **Hover before grab.** On the confirmation frame the controller refreshes the
   hover first, then grabs that same hovered grabbable object (falling back to a
   cursor pick). This removes the double-pick race.
3. **World-space transforms.** Grab offset and movement are computed with
   `getWorldPosition()` and converted back through `parent.worldToLocal()`, so
   objects under a transformed group would still move correctly.
4. **2D palm span.** Depth uses palm width/length in image space only.
   MediaPipe's wrist-relative, non-metric `z` is deliberately ignored.
5. **Diagnostics.** The HUD exposes aim XYZ, depth delta with palm-span ratio,
   pinch value and thresholds, selected/hovered object, cursor visibility, and
   the last grab/reject/release action. The dev bridge accepts
   `setSyntheticHand()` for real-app regression runs.

Depth remains relative to the grab pose: `clamp(span / grabSpan, 0.55, 1.8)`
scaled by `3.2` world units. It is a stable proximity signal, not metric depth.

### Chemistry layer (new)

`src/lab/experiments.ts` is pure TypeScript with no Three.js or DOM imports. It
defines experiment metadata and an `ExperimentEngine` with explicit phases:

```text
idle → running → animating → running (next step) → animating → complete
```

Only `attemptTransfer(reagentId, targetId)` can advance a step, and only while
`phase === "running"`. A mismatch returns a structured reason
(`wrong-reagent`, `wrong-target`, `not-running`, `no-experiment`) and feedback,
without changing the step index. `finishStep()` is called only after the scene's
pour (and final reaction) animation resolves.

## 3. File changes

| Path | Role |
| --- | --- |
| `src/lab/experiments.ts` | Experiment definitions, messages, effects, state machine |
| `src/lab/models.ts` | Reagent/glassware wrappers, beaker/flask geometry, liquid, precipitate, bubbles, labels |
| `src/lab/scene.ts` | Lab room, instrument placement, picking, highlights, pour/reaction animations, target validation |
| `src/main.ts` | Camera lifecycle, gesture→engine→scene orchestration, UI rendering, dev bridge |
| `src/interaction.ts` | Scene interface, stable knuckle aiming anchor, world-space grab/carry/release, release reasons, diagnostics |
| `src/handTracking.ts` | Camera enumeration and switching; local model/WASM loading unchanged |
| `src/style.css` | Three-column lab layout, responsive panels, completion banner |
| `index.html` | Webcam panel, 3D scene, experiment selection/guide, status UI, interaction diagnostics |
| `electron/main.cjs` | Sandboxed window, local server, media permission policy, navigation guards |
| `electron/static-server.cjs` | Read-only loopback static server with MIME/traversal handling |
| `tests/experiment-check.test.ts` | State machine, asymmetric-pinch gesture bridge tests |
| `tests/static-server.test.ts` | Electron server tests |
| `tests/logic-check.test.ts` | Gesture/filter/interaction tests, palm anchor, asymmetric pinch, transformed parent |
| `README.md` | Current usage, architecture, limits, packaging status |
| `VERIFICATION.md` | Detailed test matrix and gaps |
| `ENGINEERING_REPORT.md` | This report |

## 4. Interaction flow

```text
webcam frame
  → MediaPipe detects 21 landmarks
  → One Euro smoothing
  → pinch recognizer (Idle / Pinching / Holding)
  → interaction controller maps knuckle-anchor X/Y, palm-span depth
  → cursor raycast against grabbable instruments
  → pinch confirms grab of the refreshed hover target
  → carried object follows mapped hand + preserved grab offset
  → pinch release emits onRelease(object, position, "user")
  → main.ts finds the vessel at the release position
  → ExperimentEngine.attemptTransfer(object.id, target.id)
       accepted → phase animating, stepIndex advances
       rejected → feedback, bottle returns to bench
  → scene.playPour(object, targetId, liquidColor)
  → scene.applyAddition(definition, completedStep)
  → if final: scene.playReaction(effect)
  → engine.finishStep()
  → UI progress / completion / restart
```

If tracking is lost while carrying, the interaction controller waits 300 ms,
drops the object with reason `"lost"`, and `main.ts` returns it to the bench.
The experiment cannot advance from a loss. If the camera stops producing frames
for 500 ms, the same loss path is used. `Restart` and `Choose another` increment a
session token; any in-flight pour/reaction then resolves against a stale token
and is ignored after the scene has been rebuilt.

## 5. Experiments

### White precipitate

- Equation: `BaCl₂ + H₂SO₄ → BaSO₄↓ + 2HCl`
- Instruments: BaCl₂ bottle, dilute H₂SO₄ bottle, beaker.
- Step 1: BaCl₂ → beaker; liquid appears.
- Step 2: H₂SO₄ → same beaker; liquid becomes cloudy and white particles settle.
- Completion text: positive sulfate test, BaSO₄ precipitate.

### Limestone fizz

- Equation: `CaCO₃ + 2HCl → CaCl₂ + CO₂↑ + H₂O`
- Instruments: limestone jar, dilute HCl bottle, Erlenmeyer flask.
- Step 1: limestone jar → flask; chips appear.
- Step 2: HCl → same flask; chips shrink and CO₂ bubbles rise.
- Completion text: limestone fizzes and dissolves, gas is CO₂.

Both experiments share the same engine and validation path but have separate
definitions, target vessels, liquid colors, effects, safety text, and results.
Wrong order, wrong vessel, empty release, and release during animation are all
non-progressing feedback states.

## 6. Scene and visual design

- Custom room, bench, shelf, window, lights, and tray. The vendored
  `createLabRoom` was not used because it performs remote Wikipedia fetches.
- Reused `LIQUID_ITEMS`, `GLASSWARE_ITEMS`, and `REACTION_ITEMS` from
  `chemlab-3d/src/lab-models.js` and `lab-reactions.js`.
- Models are re-centred at their own origin so the pinch offset is preserved.
- Billboard labels are raycast-disabled so they never block a grab.
- Target vessels show a pulsing ring, turn green when the carried object is
  over them, and flash red on an invalid release.
- Pour animation moves the bottle over the vessel, tilts it, draws a stream,
  and returns it to its home position.
- Final effects are pre-built and hidden until the validated final step:
  - 55 settling precipitate particles plus a cloudy liquid layer;
  - 34 rising bubbles plus shrinking limestone chips.
- Completion banner was moved below the vessels so the reaction remains
  visible.

## 7. Resilience and error handling

| Condition | Behavior |
| --- | --- |
| Camera permission denied | Camera panel explains how to allow it; retry available |
| No camera / busy / unsupported settings | Specific message; retry available |
| Model 404 or initialization failure | Error banner with URL/message; `Retry setup` |
| Camera stops producing frames | Treated as tracking loss after 500 ms |
| Hand disappears while holding | 300 ms grace, then drop with reason `lost` |
| Repeated pinch / noisy threshold | 100 ms confirmation and 0.32/0.48 hysteresis |
| Release during pour/reaction | `not-running` feedback; no state change |
| Frozen/duplicate video frame | Detection only runs on a new `currentTime` |
| Restart during an animation | Session token invalidates the old async chain; scene rebuilt |
| Page hide / HMR dispose | Interaction reset, camera tracks stopped, WebGL disposed |
| External navigation in Electron | Blocked; HTTP(S) links open in the system browser |
| Permission request outside app origin | Denied |

## 8. Offline and privacy

- The MediaPipe model and both WASM variants are local under `public/`.
- Vite copies them to `dist/`; no CDN or model download is used at runtime.
- Browser verification recorded no requests outside the app origin.
- Electron serves the same build from loopback and recorded no external
  requests.
- Camera frames are processed in the renderer and are not uploaded, stored, or
  sent to a backend.

## 9. Desktop and Windows x64 packaging

`electron/main.cjs`:

- starts `electron/static-server.cjs` on `127.0.0.1` with an ephemeral port;
- creates a `BrowserWindow` with `contextIsolation`, `sandbox`, no Node
  integration, and `webSecurity`;
- grants `media` permission only to the local app origin;
- blocks navigation away from the app and opens external HTTP(S) links with the
  OS browser;
- closes the HTTP server before quitting.

`package.json` contains an `electron-builder` configuration for
`nsis`/`x64` at `release/`, plus `npm run electron:start`, `npm run dist:win`,
and `npm run dist:linux`.

Validated here:

- `npx electron-builder --linux --dir` produced an unpacked Linux app;
- the packaged app launched, initialized camera/model, served assets from
  `app.asar`, and made no external requests;
- the dev-only hook was absent from the packaged build.

Not validated:

- Windows NSIS build, installer, code signing, Windows camera privacy settings,
  antivirus behavior, or an installed Windows app.

## 10. Verification results

Commands:

```bash
npm run typecheck   # pass
npm test            # pass (gesture/filter/interaction, experiments, static server)
npm run build       # pass (expected >500 kB warning)
```

End-to-end browser results:

- precipitation: step 1 → 50%, step 2 → complete, progress 100%, BaSO₄ banner;
- limestone: step 1 → 50%, step 2 → complete, progress 100%, CO₂ banner;
- post-completion transfers rejected;
- restart resets phase/progress/scene;
- choose-another returns to selection;
- camera denial, no camera, model 404, model retry, and camera retry all behave
  as designed.

Real-app synthetic-hand interaction results:

- open hand over BaCl₂ hovered it with no selection; an asymmetric thumb-only
  pinch then grabbed it without a snap;
- carry reached `(0.00, 1.29, 1.22)` with depth `+1.12`;
- release over the beaker advanced the experiment to step 1 exactly once;
- H₂SO₄ depth moved from `+1.44` (span 1.45×) to `-0.96` (span 0.70×);
- release in empty space followed by a large hand move left the instrument at
  its rest position, not at the hand;
- tracking loss while holding dropped the instrument and did not advance the
  experiment;
- restart cleared selection/aim/depth and re-enabled grabbing.

Electron results:

- development and packaged apps load the local origin;
- model/WASM load locally;
- both experiment cards and limestone scene render;
- no external requests or page errors.

The full matrix and observed values are in [VERIFICATION.md](VERIFICATION.md).

## 11. Remaining issues and next steps

1. **Physical webcam validation.** Test with at least one real 640×480 webcam,
   different hand sizes, lighting, sleeves, and camera distances. Specifically
   exercise asymmetric (thumb-only and index-only) pinches, small targets near
   the knuckle anchor, and depth movement toward/away from the camera. Tune
   `src/gesture.ts` thresholds and depth scaling if needed.
2. **Windows x64 build.** Run `npm ci && npm run dist:win` on Windows 10/11
   x64, install the NSIS artifact, test camera permission and both experiments,
   add an icon/code-signing certificate, and verify uninstall.
3. **Frame-rate measurement.** Measure hand inference and render rate on the
   target laptop; consider lower shadow-map size, a lighter room, or GPU
   delegate if CPU inference cannot keep up.
4. **Accessibility.** The gesture path has no keyboard equivalent. Consider a
   pointer/keyboard fallback for users without a camera or with motor
   limitations.
5. **Collision/overlap.** Instruments can pass through one another. If future
   experiments add more vessels, add simple XZ separation or snap zones.
6. **Long-running robustness.** Exercise camera unplug/replug, laptop sleep,
   repeated restarts, and multi-hour sessions.
7. **Bundle size.** The single JS chunk is about 873 kB (224 kB gzip) and the
   local assets add about 34 MB. Code-splitting the MediaPipe/Three.js entry
   could improve first load if needed.

## 12. Run instructions

Browser:

```bash
npm install
npm run dev
# open http://localhost:5173/, allow camera access
```

Desktop:

```bash
npm run electron:start
```

Production checks:

```bash
npm run typecheck
npm test
npm run build
```

Windows installer (on Windows or a Windows CI runner):

```bash
npm ci
npm run dist:win
# artifact under release/
```

No claim is made that the Windows installer was produced or tested here.
