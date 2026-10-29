import "./style.css";
import * as THREE from "three";
import {
  CameraAccessError,
  HandTracker,
  type TrackedHand,
} from "./handTracking";
import {
  InteractionController,
  type InteractionSnapshot,
  type ObjectPosition,
  type ReleaseReason,
} from "./interaction";
import { ChemistryScene, type SceneViewPreset } from "./lab/scene";
import {
  ExperimentEngine,
  getExperiment,
  type ExperimentDefinition,
  type ExperimentId,
  type ExperimentSnapshot,
} from "./lab/experiments";
import type { SceneObject } from "./scene";
import type { Point3 } from "./types";

type StatusTone = "loading" | "ok" | "warn" | "error";

let disposeApp: (() => void) | null = null;

boot();

function boot(): void {
  const elements: AppElements = {
    statusBar: requireElement<HTMLDivElement>("#status-bar"),
    cameraDetail: requireElement<HTMLSpanElement>("#camera-detail"),
    trackingStatus: requireElement<HTMLElement>("#tracking-status"),
    heldStatusWrap: requireElement<HTMLDivElement>("#held-status-wrap"),
    heldStatus: requireElement<HTMLElement>("#held-status"),
    telemetryPanel: requireElement<HTMLDivElement>(".telemetry-panel"),
    telemetryCamera: requireElement<HTMLElement>("#telemetry-camera"),
    telemetryCameraSub: requireElement<HTMLElement>("#telemetry-camera-sub"),
    telemetryHand: requireElement<HTMLElement>("#telemetry-hand"),
    telemetryHandSub: requireElement<HTMLElement>("#telemetry-hand-sub"),
    telemetryDepth: requireElement<HTMLElement>("#telemetry-depth"),
    telemetryDepthSub: requireElement<HTMLElement>("#telemetry-depth-sub"),
    experimentName: requireElement<HTMLElement>("#experiment-name"),
    topProgress: requireElement<HTMLDivElement>("#top-progress"),
    progressStep: requireElement<HTMLElement>("#progress-step"),
    progressTotal: requireElement<HTMLElement>("#progress-total"),
    progressTrack: requireElement<HTMLDivElement>("#progress-track"),
    restartExperiment: requireElement<HTMLButtonElement>("#restart-experiment"),
    restartExperiment2: requireElement<HTMLButtonElement>(
      "#restart-experiment-2",
    ),
    settingsToggle: requireElement<HTMLButtonElement>("#settings-toggle"),
    settingsPopover: requireElement<HTMLDivElement>("#settings-popover"),
    appError: requireElement<HTMLDivElement>("#app-error"),
    appErrorMessage: requireElement<HTMLSpanElement>("#app-error-message"),
    retrySetup: requireElement<HTMLButtonElement>("#retry-setup"),
    sceneContainer: requireElement<HTMLDivElement>("#scene-container"),
    experimentSelection: requireElement<HTMLDivElement>(
      "#experiment-selection",
    ),
    experimentRun: requireElement<HTMLDivElement>("#experiment-run"),
    stepIcon: requireElement<HTMLDivElement>("#step-icon"),
    stepNumber: requireElement<HTMLElement>("#step-number"),
    stepEyebrow: requireElement<HTMLElement>("#step-eyebrow"),
    stepTitle: requireElement<HTMLElement>("#step-title"),
    sceneInstruction: requireElement<HTMLElement>("#scene-instruction"),
    targetStatus: requireElement<HTMLElement>("#target-status"),
    hintSymbol: requireElement<HTMLElement>("#hint-symbol"),
    actionEyebrow: requireElement<HTMLElement>("#action-eyebrow"),
    actionText: requireElement<HTMLElement>("#action-text"),
    experimentProgress: requireElement<HTMLElement>("#experiment-progress"),
    experimentProgressLabel: requireElement<HTMLElement>(
      "#experiment-progress-label",
    ),
    experimentProgressPercent: requireElement<HTMLElement>(
      "#experiment-progress-percent",
    ),
    experimentEquation: requireElement<HTMLElement>("#experiment-equation"),
    experimentSteps: requireElement<HTMLOListElement>("#experiment-steps"),
    experimentFeedback: requireElement<HTMLElement>("#experiment-feedback"),
    experimentSafety: requireElement<HTMLElement>("#experiment-safety"),
    chooseExperiment: requireElement<HTMLButtonElement>("#choose-experiment"),
    completionBanner: requireElement<HTMLDivElement>("#completion-banner"),
    completionTitle: requireElement<HTMLElement>("#completion-title"),
    completionText: requireElement<HTMLElement>("#completion-text"),
    videoShell: requireElement<HTMLDivElement>("#video-shell"),
    video: requireElement<HTMLVideoElement>("#webcam"),
    landmarks: requireElement<HTMLCanvasElement>("#landmarks"),
    videoPlaceholder: requireElement<HTMLDivElement>("#video-placeholder"),
    cameraError: requireElement<HTMLElement>("#camera-error"),
    cameraErrorMessage: requireElement<HTMLElement>("#camera-error-message"),
    retryCamera: requireElement<HTMLButtonElement>("#retry-camera"),
    cameraSelect: requireElement<HTMLSelectElement>("#camera-select"),
    previewToggle: requireElement<HTMLButtonElement>("#preview-toggle"),
    cameraPreview: requireElement<HTMLDivElement>("#camera-preview"),
    debugTracking: requireElement<HTMLElement>("#debug-tracking"),
    debugGesture: requireElement<HTMLElement>("#debug-gesture"),
    debugSelected: requireElement<HTMLElement>("#debug-selected"),
    debugPosition: requireElement<HTMLElement>("#debug-position"),
    debugAim: requireElement<HTMLElement>("#debug-aim"),
    debugDepth: requireElement<HTMLElement>("#debug-depth"),
    debugPinch: requireElement<HTMLElement>("#debug-pinch"),
    debugCursor: requireElement<HTMLElement>("#debug-cursor"),
    debugLastAction: requireElement<HTMLElement>("#debug-last-action"),
    viewButtons: Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-view]"),
    ),
  };

  let sceneView: ChemistryScene;
  try {
    sceneView = new ChemistryScene(elements.sceneContainer);
  } catch (error) {
    applyCameraStatus(elements, "3D scene unavailable", "error", "WebGL error");
    elements.retrySetup.hidden = true;
    showAppError(
      elements,
      `The Three.js laboratory could not start. WebGL is required. ${errorMessage(error)}`,
    );
    return;
  }

  const tracker = new HandTracker(elements.video, elements.landmarks);
  const engine = new ExperimentEngine();

  let sessionToken = 0;
  let interaction: InteractionController;
  let lastAction = "—";
  let lastInteraction: Readonly<InteractionSnapshot> | null = null;
  let lastHand: TrackedHand | null = null;
  let settingsOpen = false;
  let previewEnabled = false;

  const setSettingsOpen = (open: boolean): void => {
    settingsOpen = open;
    elements.settingsPopover.hidden = !open;
    elements.settingsToggle.classList.toggle("selected", open);
    elements.settingsToggle.setAttribute("aria-expanded", String(open));
  };

  const setPreviewEnabled = (enabled: boolean): void => {
    previewEnabled = enabled;
    elements.cameraPreview.hidden = !enabled;
    elements.previewToggle.setAttribute("aria-pressed", String(enabled));
    if (enabled) {
      syncVideoAspect();
    }
  };

  const handleRelease = (
    object: SceneObject,
    position: ObjectPosition,
    reason: ReleaseReason,
  ): Promise<void> | void => {
    if (reason !== "user") {
      lastAction = `release ${object.id ?? object.name}: ${reason}`;
      sceneView.returnToRest(object);
      return;
    }

    const state = engine.getSnapshot();
    if (!state.canInteract || !state.experimentId) {
      lastAction = `release ${object.id ?? object.name}: no experiment`;
      sceneView.returnToRest(object);
      return;
    }

    const definition = getExperiment(state.experimentId);
    const target = sceneView.findTargetAt(
      new THREE.Vector3(position.x, position.y, position.z),
    );
    const result = engine.attemptTransfer(
      object.id ?? object.name,
      target?.id ?? null,
    );

    if (!result.accepted) {
      lastAction = `rejected ${object.id ?? object.name}: ${result.reason}`;
      sceneView.rejectPlacement(object);
      renderExperimentUI(engine.getSnapshot(), elements);
      renderGuidance(
        engine.getSnapshot(),
        lastInteraction,
        lastHand,
        elements,
        sceneView,
      );
      return;
    }
    if (!target) {
      // Defensive: an accepted transfer always has a target. Never advance the
      // experiment without a real, scene-validated target.
      lastAction = `rejected ${object.id ?? object.name}: no target`;
      sceneView.returnToRest(object);
      return;
    }

    lastAction = `accepted ${object.id ?? object.name} → ${target.id}`;
    const completedStep = result.stepIndex - 1;
    const color = definition.liquidColors[completedStep] ?? 0xffffff;
    const token = sessionToken;
    renderExperimentUI(engine.getSnapshot(), elements);
    return continuePour(
      object,
      target.id,
      definition,
      completedStep,
      result.isFinal,
      color,
      token,
    );
  };

  const continuePour = async (
    object: SceneObject,
    targetId: string,
    definition: ExperimentDefinition,
    completedStep: number,
    isFinal: boolean,
    color: number,
    token: number,
  ): Promise<void> => {
    await sceneView.playPour(object, targetId, color);
    if (token !== sessionToken) {
      return;
    }
    sceneView.applyAddition(definition, completedStep);
    if (isFinal) {
      await sceneView.playReaction(definition.effect);
      if (token !== sessionToken) {
        return;
      }
    }
    engine.finishStep();
    renderExperimentUI(engine.getSnapshot(), elements);
    renderGuidance(
      engine.getSnapshot(),
      lastInteraction,
      lastHand,
      elements,
      sceneView,
    );
  };

  interaction = new InteractionController(sceneView, {
    onGrab: (object) => {
      const grabbedAt = object.mesh.getWorldPosition(new THREE.Vector3());
      lastAction = `grabbed ${object.id ?? object.name} @ ${formatPosition({
        x: grabbedAt.x,
        y: grabbedAt.y,
        z: grabbedAt.z,
      })}`;
    },
    onRelease: handleRelease,
  });

  const startExperiment = (id: ExperimentId): void => {
    sessionToken += 1;
    lastAction = `start ${id}`;
    interaction.reset();
    engine.start(id);
    sceneView.loadExperiment(getExperiment(id));
    renderExperimentUI(engine.getSnapshot(), elements);
    renderGuidance(
      engine.getSnapshot(),
      lastInteraction,
      lastHand,
      elements,
      sceneView,
    );
  };

  const restartExperiment = (): void => {
    const state = engine.getSnapshot();
    if (!state.experimentId) {
      return;
    }
    sessionToken += 1;
    lastAction = `restart ${state.experimentId}`;
    interaction.reset();
    engine.restart();
    sceneView.loadExperiment(getExperiment(state.experimentId));
    renderExperimentUI(engine.getSnapshot(), elements);
    renderGuidance(
      engine.getSnapshot(),
      lastInteraction,
      lastHand,
      elements,
      sceneView,
    );
  };

  const chooseExperiment = (): void => {
    sessionToken += 1;
    lastAction = "choose experiment";
    interaction.reset();
    engine.clear();
    sceneView.showSelectionScene();
    renderExperimentUI(engine.getSnapshot(), elements);
  };

  elements.experimentSelection.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-experiment]");
    const id = button?.dataset.experiment;
    if (id === "precipitation" || id === "limestone") {
      startExperiment(id);
    }
  });
  elements.restartExperiment.addEventListener("click", restartExperiment);
  elements.restartExperiment2.addEventListener("click", restartExperiment);
  elements.chooseExperiment.addEventListener("click", chooseExperiment);

  elements.settingsToggle.addEventListener("click", () => {
    setSettingsOpen(!settingsOpen);
  });
  elements.previewToggle.addEventListener("click", () => {
    setPreviewEnabled(!previewEnabled);
  });

  for (const button of elements.viewButtons) {
    button.addEventListener("click", () => {
      const preset = button.dataset.view as SceneViewPreset | undefined;
      if (!preset) {
        return;
      }
      sceneView.setViewPreset(preset);
      for (const item of elements.viewButtons) {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      }
    });
  }

  const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!settingsOpen) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (
      elements.settingsPopover.contains(target) ||
      elements.settingsToggle.contains(target)
    ) {
      return;
    }
    setSettingsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && settingsOpen) {
      setSettingsOpen(false);
      elements.settingsToggle.focus();
    }
  };

  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleKeyDown);

  let syntheticHand: TrackedHand | null = null;

  // Development-only bridge used by the browser verification harness. Vite
  // replaces import.meta.env.DEV with false in production, so this block is
  // removed from the built app. It drives the same release handler as a hand.
  if (import.meta.env.DEV) {
    const devWindow = window as typeof window & {
      __chemlabDev?: {
        startExperiment: (id: ExperimentId) => void;
        restartExperiment: () => void;
        chooseExperiment: () => void;
        setViewPreset: (preset: SceneViewPreset) => void;
        viewPreset: () => SceneViewPreset;
        snapshot: () => ExperimentSnapshot;
        instruments: () => ReturnType<ChemistryScene["getInstrumentInfo"]>;
        instrumentPosition: (
          id: string,
        ) => { x: number; y: number; z: number } | null;
        interaction: () => Readonly<InteractionSnapshot>;
        setSyntheticHand: (landmarks: readonly Point3[] | null) => void;
        setTimeScale: (scale: number) => void;
        runCurrentStep: () => Promise<{
          ok: boolean;
          reason?: string;
          snapshot: ExperimentSnapshot;
        }>;
      };
    };
    devWindow.__chemlabDev = {
      startExperiment,
      restartExperiment,
      chooseExperiment,
      setViewPreset: (preset) => sceneView.setViewPreset(preset),
      viewPreset: () => sceneView.getViewPreset(),
      snapshot: () => engine.getSnapshot(),
      instruments: () => sceneView.getInstrumentInfo(),
      instrumentPosition: (id) => sceneView.getInstrumentPosition(id),
      interaction: () => interaction.getSnapshot(),
      setSyntheticHand: (landmarks) => {
        syntheticHand = landmarks
          ? { landmarks, handedness: "Synthetic" }
          : null;
      },
      setTimeScale: (scale) => {
        timeScale = Number.isFinite(scale)
          ? Math.min(20, Math.max(0.1, scale))
          : 1;
      },
      runCurrentStep: async () => {
        const state = engine.getSnapshot();
        const step = state.step;
        if (!state.canInteract || !step) {
          return {
            ok: false,
            reason: `not-interactive:${state.phase}`,
            snapshot: state,
          };
        }
        const object = sceneView.getInstrumentObject(step.reagentId);
        const targetPosition = sceneView.getInstrumentPosition(step.targetId);
        if (!object || !targetPosition) {
          return {
            ok: false,
            reason: "missing-instrument-or-target",
            snapshot: state,
          };
        }
        await handleRelease(
          object,
          {
            x: targetPosition.x,
            y: Math.max(targetPosition.y, object.restY),
            z: targetPosition.z,
          },
          "user",
        );
        return { ok: true, snapshot: engine.getSnapshot() };
      },
    };
  }

  let rafId = 0;
  let disposed = false;
  let timeScale = 1;
  let initializing = false;
  let cameraReady = false;
  let modelReady = false;
  let trackingStopped = false;
  let lastVideoTime = -1;
  let lastVideoFrameAt = performance.now();
  let lastFrameAt = performance.now();

  const syncVideoAspect = (): void => {
    const width = tracker.videoWidth;
    const height = tracker.videoHeight;
    if (width > 0 && height > 0) {
      elements.videoShell.style.aspectRatio = `${width} / ${height}`;
      setText(elements.telemetryCameraSub, `${width}×${height}`);
    }
  };

  const refreshCameraList = async (): Promise<void> => {
    const cameras = await tracker.listCameras();
    const previous = elements.cameraSelect.value;
    elements.cameraSelect.replaceChildren();
    const fallback = document.createElement("option");
    fallback.value = "";
    fallback.textContent = "Default / built-in";
    elements.cameraSelect.appendChild(fallback);
    cameras.forEach((camera, index) => {
      const option = document.createElement("option");
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      elements.cameraSelect.appendChild(option);
    });
    const active = tracker.cameraDeviceId;
    const next = active ?? previous;
    if (next && cameras.some((camera) => camera.deviceId === next)) {
      elements.cameraSelect.value = next;
    }
    elements.cameraSelect.disabled = cameras.length <= 1;
  };

  const initialize = async (): Promise<void> => {
    if (initializing || disposed) {
      return;
    }

    initializing = true;
    elements.retrySetup.disabled = true;
    elements.retryCamera.disabled = true;
    elements.cameraSelect.disabled = true;
    hideAppError(elements);
    hideCameraError(elements);

    try {
      if (!tracker.hasCamera) {
        applyCameraStatus(
          elements,
          "Requesting camera access…",
          "loading",
          "Waiting for permission",
        );
        setText(elements.debugTracking, "Starting camera…");
        elements.videoPlaceholder.hidden = false;
        await tracker.startCamera();
        cameraReady = true;
        syncVideoAspect();
        lastVideoTime = -1;
        lastVideoFrameAt = performance.now();
        elements.videoPlaceholder.hidden = true;
        await refreshCameraList();
      } else {
        cameraReady = true;
      }

      if (!modelReady) {
        applyCameraStatus(
          elements,
          "Loading hand model…",
          "loading",
          "Local MediaPipe model",
        );
        setText(elements.debugTracking, "Loading hand model…");
        await tracker.loadModel();
        modelReady = true;
      }

      if (cameraReady && modelReady) {
        trackingStopped = false;
        lastVideoFrameAt = performance.now();
        applyCameraStatus(
          elements,
          "Camera ready",
          "ok",
          `${tracker.videoWidth}×${tracker.videoHeight}`,
        );
        setTrackingState(elements, null);
        elements.cameraSelect.disabled = false;
      }
    } catch (error) {
      if (error instanceof CameraAccessError) {
        cameraReady = false;
        elements.videoPlaceholder.hidden = true;
        showCameraError(elements, error.message);
        applyCameraStatus(
          elements,
          "Camera unavailable",
          "error",
          "Permission or device issue",
        );
        setText(elements.trackingStatus, "Tracking offline");
        setText(elements.debugTracking, "Camera error");
        setSettingsOpen(true);
      } else {
        modelReady = false;
        applyCameraStatus(
          elements,
          "Hand model failed",
          "error",
          "Model could not load",
        );
        setText(elements.debugTracking, "Model error");
        showAppError(elements, errorMessage(error));
        setSettingsOpen(true);
      }
    } finally {
      initializing = false;
      elements.retrySetup.disabled = false;
      elements.retryCamera.disabled = false;
    }
  };

  const switchCamera = async (): Promise<void> => {
    if (!cameraReady || !modelReady || initializing) {
      return;
    }
    const deviceId = elements.cameraSelect.value || undefined;
    applyCameraStatus(
      elements,
      "Switching camera…",
      "loading",
      "Opening device",
    );
    elements.cameraSelect.disabled = true;
    interaction.reset();
    hideCameraError(elements);
    try {
      await tracker.startCamera(deviceId);
      cameraReady = true;
      trackingStopped = false;
      lastVideoTime = -1;
      lastVideoFrameAt = performance.now();
      syncVideoAspect();
      elements.videoPlaceholder.hidden = true;
      applyCameraStatus(
        elements,
        "Camera ready",
        "ok",
        `${tracker.videoWidth}×${tracker.videoHeight}`,
      );
      setTrackingState(elements, null);
      await refreshCameraList();
    } catch (error) {
      cameraReady = false;
      const message =
        error instanceof CameraAccessError
          ? error.message
          : `The selected camera could not be opened: ${errorMessage(error)}`;
      showCameraError(elements, message);
      applyCameraStatus(
        elements,
        "Camera unavailable",
        "error",
        "Permission or device issue",
      );
      setText(elements.trackingStatus, "Tracking offline");
      setText(elements.debugTracking, "Camera error");
      setSettingsOpen(true);
    } finally {
      elements.cameraSelect.disabled = cameraReady && modelReady;
    }
  };

  const updateLiveState = (
    hand: TrackedHand | null,
    snapshot: Readonly<InteractionSnapshot>,
  ): void => {
    lastHand = hand;
    lastInteraction = snapshot;
    setTrackingState(elements, hand);

    setText(elements.debugGesture, snapshot.gesture);
    setText(elements.debugSelected, snapshot.selectedName ?? "None");
    setText(
      elements.debugPosition,
      snapshot.objectPosition
        ? formatPosition(snapshot.objectPosition)
        : "—",
    );
    setText(
      elements.debugAim,
      snapshot.cursorPosition ? formatPosition(snapshot.cursorPosition) : "—",
    );
    setText(
      elements.debugDepth,
      snapshot.palmRatio === null
        ? "—"
        : `${snapshot.depthOffset >= 0 ? "+" : ""}${snapshot.depthOffset.toFixed(2)} · ${snapshot.palmRatio.toFixed(2)}×`,
    );
    setText(
      elements.debugPinch,
      snapshot.pinchRatio === null ? "—" : snapshot.pinchRatio.toFixed(2),
    );
    elements.debugPinch.title =
      "Grab closes below 0.32; release opens above 0.48";
    setText(
      elements.debugCursor,
      snapshot.cursorVisible ? "Visible" : "Hidden",
    );
    setText(elements.debugLastAction, lastAction);

    if (snapshot.selectedName) {
      elements.heldStatusWrap.hidden = false;
      setText(elements.heldStatus, `Holding ${snapshot.selectedName}`);
    } else {
      elements.heldStatusWrap.hidden = true;
    }

    if (snapshot.objectPosition) {
      setText(
        elements.telemetryDepth,
        `${snapshot.depthOffset >= 0 ? "+" : ""}${snapshot.depthOffset.toFixed(2)}`,
      );
      elements.telemetryDepth.dataset.tone = "ok";
      setText(
        elements.telemetryDepthSub,
        snapshot.palmRatio === null
          ? "Depth active"
          : `Palm ${snapshot.palmRatio.toFixed(2)}×`,
      );
    } else {
      setText(elements.telemetryDepth, "—");
      delete elements.telemetryDepth.dataset.tone;
      setText(elements.telemetryDepthSub, "Grab to enable");
    }

    renderGuidance(
      engine.getSnapshot(),
      snapshot,
      hand,
      elements,
      sceneView,
    );
  };

  const loop = (now: number): void => {
    if (disposed) {
      return;
    }
    rafId = requestAnimationFrame(loop);
    const dt =
      Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000)) * timeScale;
    lastFrameAt = now;

    if (cameraReady && modelReady && !trackingStopped) {
      try {
        const hasNewVideoFrame =
          elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          elements.video.currentTime !== lastVideoTime;

        if (hasNewVideoFrame) {
          lastVideoTime = elements.video.currentTime;
          lastVideoFrameAt = now;
          const hand = syntheticHand ?? tracker.detect(now);
          updateLiveState(hand, interaction.update(hand, now));
        } else if (now - lastVideoFrameAt > 500) {
          // Camera paused or stopped delivering frames. Treat it as a
          // tracking loss so a held instrument can never stay stuck.
          updateLiveState(null, interaction.update(null, now));
        }
      } catch (error) {
        trackingStopped = true;
        interaction.reset();
        applyCameraStatus(
          elements,
          "Tracking error",
          "error",
          "Restart the camera",
        );
        setText(elements.trackingStatus, "Tracking stopped");
        setText(elements.debugTracking, "Tracking error");
        showAppError(
          elements,
          `Hand tracking stopped: ${errorMessage(error)}. Retry setup to restart tracking.`,
        );
        setSettingsOpen(true);
      }
    }

    sceneView.update(dt);
    sceneView.render();
  };

  elements.retryCamera.addEventListener("click", () => {
    void initialize();
  });
  elements.retrySetup.addEventListener("click", () => {
    void initialize();
  });
  elements.cameraSelect.addEventListener("change", () => {
    void switchCamera();
  });
  elements.video.addEventListener("loadedmetadata", syncVideoAspect);

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("pagehide", handlePageHide);
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleKeyDown);
    elements.video.removeEventListener("loadedmetadata", syncVideoAspect);
    interaction.reset();
    tracker.dispose();
    sceneView.dispose();
  };

  // Keep the app intact when the page enters the back/forward cache; only
  // release the camera and WebGL context when the page is really going away.
  const handlePageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) {
      dispose();
    }
  };

  window.addEventListener("pagehide", handlePageHide);
  disposeApp = dispose;

  renderExperimentUI(engine.getSnapshot(), elements);
  applyCameraStatus(
    elements,
    "Starting camera…",
    "loading",
    "Requesting access",
  );
  setTrackingState(elements, null);
  rafId = requestAnimationFrame(loop);
  void initialize();
}

// -------------------------------------------------------------------------
// Experiment panel rendering
// -------------------------------------------------------------------------

function renderExperimentUI(
  snapshot: ExperimentSnapshot,
  elements: AppElements,
): void {
  if (!snapshot.experimentId) {
    elements.experimentSelection.hidden = false;
    elements.experimentRun.hidden = true;
    elements.topProgress.hidden = true;
    elements.restartExperiment.disabled = true;
    elements.restartExperiment2.disabled = true;
    elements.completionBanner.hidden = true;
    setText(elements.experimentName, "Choose an experiment");
    return;
  }

  const definition = getExperiment(snapshot.experimentId);
  elements.experimentSelection.hidden = true;
  elements.experimentRun.hidden = false;
  elements.topProgress.hidden = false;
  elements.restartExperiment.disabled = false;
  elements.restartExperiment2.disabled = false;
  setText(elements.experimentName, definition.title);
  setText(elements.experimentEquation, definition.equation);
  setText(elements.experimentSafety, `Safety: ${definition.safety}`);
  setText(elements.experimentFeedback, snapshot.feedback.text);
  elements.experimentFeedback.dataset.tone = snapshot.feedback.tone;

  renderTopProgress(snapshot, elements);
  renderSteps(elements.experimentSteps, definition, snapshot);
  renderProgress(snapshot, elements);
  renderGuidance(
    snapshot,
    null,
    null,
    elements,
    null,
  );

  if (snapshot.completed) {
    elements.completionBanner.hidden = false;
    setText(elements.completionTitle, definition.resultTitle);
    setText(elements.completionText, definition.resultText);
  } else {
    elements.completionBanner.hidden = true;
  }
}

function renderGuidance(
  snapshot: ExperimentSnapshot,
  interaction: Readonly<InteractionSnapshot> | null,
  hand: TrackedHand | null,
  elements: AppElements,
  sceneView: ChemistryScene | null,
): void {
  if (!snapshot.experimentId) {
    return;
  }
  const definition = getExperiment(snapshot.experimentId);
  const total = snapshot.totalSteps;
  const completed = snapshot.completed;
  const currentStep = completed
    ? total
    : Math.min(
        snapshot.stepIndex + (snapshot.phase === "animating" ? 0 : 1),
        total,
      );

  setText(elements.stepNumber, String(currentStep));
  elements.stepIcon.classList.toggle("success", completed);

  const heldName = interaction?.selectedName ?? null;
  const hoveredName = interaction?.hoveredName ?? null;
  const targetUnder =
    heldName && sceneView ? sceneView.targetUnderHeld() : null;

  if (completed) {
    setText(elements.stepEyebrow, "ALL STEPS VERIFIED");
    setText(elements.stepTitle, definition.resultTitle);
    setText(elements.sceneInstruction, definition.resultText);
    setHintMode(elements, "complete");
    setText(elements.actionEyebrow, "ENDPOINT REACHED");
    setText(elements.actionText, "Restart or choose another experiment");
    elements.targetStatus.hidden = true;
    return;
  }

  if (snapshot.phase === "animating") {
    setText(elements.stepEyebrow, `STEP ${currentStep} OF ${total}`);
    setText(elements.stepTitle, "Observe the reaction");
    setText(
      elements.sceneInstruction,
      "Validated. Keep your hand visible while the pour and reaction play.",
    );
    setHintMode(elements, "working");
    setText(elements.actionEyebrow, "REACTION IN PROGRESS");
    setText(elements.actionText, "Stabilising the vessel…");
    elements.targetStatus.hidden = true;
    return;
  }

  setText(elements.stepEyebrow, `STEP ${currentStep} OF ${total}`);

  if (!hand) {
    setText(elements.stepTitle, "Show your hand");
    setText(
      elements.sceneInstruction,
      snapshot.step?.prompt ?? "Hold one hand up to the camera to begin.",
    );
    setHintMode(elements, "hand");
    setText(elements.actionEyebrow, "START");
    setText(elements.actionText, "Hold one hand 40–80 cm from the camera");
  } else if (heldName) {
    if (targetUnder) {
      setText(elements.stepTitle, "Release to pour");
      setText(
        elements.sceneInstruction,
        `Release ${heldName} over ${snapshot.step?.targetName ?? "the highlighted vessel"} now.`,
      );
      setText(elements.actionEyebrow, "RELEASE");
      setText(elements.actionText, "Open your pinch over the green target");
    } else {
      setText(elements.stepTitle, "Carry to the target");
      setText(
        elements.sceneInstruction,
        `Move ${heldName} over ${snapshot.step?.targetName ?? "the highlighted vessel"}. Depth is the third axis.`,
      );
      setText(elements.actionEyebrow, "CARRY");
      setText(
        elements.actionText,
        `Move toward ${snapshot.step?.targetName ?? "the target"}`,
      );
    }
    setHintMode(elements, "hand");
  } else if (hoveredName) {
    setText(elements.stepTitle, "Pinch to grab");
    setText(
      elements.sceneInstruction,
      snapshot.step?.prompt ?? "Pinch thumb and index together to pick it up.",
    );
    setHintMode(elements, "hand");
    setText(elements.actionEyebrow, "GRAB");
    setText(elements.actionText, `Pinch to lift ${hoveredName}`);
  } else {
    setText(elements.stepTitle, "Aim at a reagent");
    setText(
      elements.sceneInstruction,
      snapshot.step?.prompt ?? "Move your hand to aim at the highlighted reagent.",
    );
    setHintMode(elements, "hand");
    setText(elements.actionEyebrow, "AIM");
    setText(
      elements.actionText,
      `Aim at ${snapshot.step?.reagentName ?? "the highlighted instrument"}`,
    );
  }

  if (heldName) {
    elements.targetStatus.hidden = false;
    if (targetUnder) {
      setText(
        elements.targetStatus,
        "Release now — the vessel is highlighted green.",
      );
      elements.targetStatus.dataset.tone = "ready";
    } else {
      setText(
        elements.targetStatus,
        "Carry the instrument over the highlighted vessel.",
      );
      elements.targetStatus.dataset.tone = "moving";
    }
  } else {
    elements.targetStatus.hidden = true;
  }
}

function renderTopProgress(
  snapshot: ExperimentSnapshot,
  elements: AppElements,
): void {
  elements.progressTrack.replaceChildren();
  for (let index = 0; index < snapshot.totalSteps; index += 1) {
    const segment = document.createElement("i");
    if (index < snapshot.stepIndex) {
      segment.className = "active";
    } else if (index === snapshot.stepIndex && !snapshot.completed) {
      segment.className = "current";
    }
    elements.progressTrack.appendChild(segment);
  }
  setText(elements.progressStep, String(snapshot.stepIndex));
  setText(elements.progressTotal, String(snapshot.totalSteps));
}

function renderProgress(
  snapshot: ExperimentSnapshot,
  elements: AppElements,
): void {
  const percent = Math.round(snapshot.progress * 100);
  elements.experimentProgress.style.width = `${percent}%`;
  setText(elements.experimentProgressPercent, `${percent}%`);
  if (snapshot.completed) {
    setText(elements.experimentProgressLabel, "All steps verified");
  } else {
    setText(
      elements.experimentProgressLabel,
      `${snapshot.stepIndex} of ${snapshot.totalSteps} validated steps`,
    );
  }
}

function renderSteps(
  list: HTMLOListElement,
  definition: ExperimentDefinition,
  snapshot: ExperimentSnapshot,
): void {
  list.replaceChildren();
  definition.steps.forEach((step, index) => {
    const item = document.createElement("li");
    const done = snapshot.completed || index < snapshot.stepIndex;
    const current =
      !snapshot.completed &&
      (index === snapshot.stepIndex ||
        (snapshot.phase === "animating" && index === snapshot.stepIndex - 1));
    item.className = done ? "done" : current ? "current" : "pending";

    const marker = document.createElement("span");
    marker.className = "step-marker";
    marker.textContent = done ? "✓" : String(index + 1);

    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${step.reagentName} → ${step.targetName}`;
    const copy = document.createElement("span");
    copy.textContent = step.prompt;
    body.append(title, copy);
    item.append(marker, body);
    list.appendChild(item);
  });
}

function setHintMode(elements: AppElements, mode: string): void {
  if (elements.hintSymbol.dataset.mode !== mode) {
    elements.hintSymbol.dataset.mode = mode;
  }
}

// -------------------------------------------------------------------------
// Small DOM helpers
// -------------------------------------------------------------------------

type AppElements = {
  statusBar: HTMLDivElement;
  cameraDetail: HTMLSpanElement;
  trackingStatus: HTMLElement;
  heldStatusWrap: HTMLDivElement;
  heldStatus: HTMLElement;
  telemetryPanel: HTMLDivElement;
  telemetryCamera: HTMLElement;
  telemetryCameraSub: HTMLElement;
  telemetryHand: HTMLElement;
  telemetryHandSub: HTMLElement;
  telemetryDepth: HTMLElement;
  telemetryDepthSub: HTMLElement;
  experimentName: HTMLElement;
  topProgress: HTMLDivElement;
  progressStep: HTMLElement;
  progressTotal: HTMLElement;
  progressTrack: HTMLDivElement;
  restartExperiment: HTMLButtonElement;
  restartExperiment2: HTMLButtonElement;
  settingsToggle: HTMLButtonElement;
  settingsPopover: HTMLDivElement;
  appError: HTMLDivElement;
  appErrorMessage: HTMLSpanElement;
  retrySetup: HTMLButtonElement;
  sceneContainer: HTMLDivElement;
  experimentSelection: HTMLDivElement;
  experimentRun: HTMLDivElement;
  stepIcon: HTMLDivElement;
  stepNumber: HTMLElement;
  stepEyebrow: HTMLElement;
  stepTitle: HTMLElement;
  sceneInstruction: HTMLElement;
  targetStatus: HTMLElement;
  hintSymbol: HTMLElement;
  actionEyebrow: HTMLElement;
  actionText: HTMLElement;
  experimentProgress: HTMLElement;
  experimentProgressLabel: HTMLElement;
  experimentProgressPercent: HTMLElement;
  experimentEquation: HTMLElement;
  experimentSteps: HTMLOListElement;
  experimentFeedback: HTMLElement;
  experimentSafety: HTMLElement;
  chooseExperiment: HTMLButtonElement;
  completionBanner: HTMLDivElement;
  completionTitle: HTMLElement;
  completionText: HTMLElement;
  videoShell: HTMLDivElement;
  video: HTMLVideoElement;
  landmarks: HTMLCanvasElement;
  videoPlaceholder: HTMLDivElement;
  cameraError: HTMLElement;
  cameraErrorMessage: HTMLElement;
  retryCamera: HTMLButtonElement;
  cameraSelect: HTMLSelectElement;
  previewToggle: HTMLButtonElement;
  cameraPreview: HTMLDivElement;
  debugTracking: HTMLElement;
  debugGesture: HTMLElement;
  debugSelected: HTMLElement;
  debugPosition: HTMLElement;
  debugAim: HTMLElement;
  debugDepth: HTMLElement;
  debugPinch: HTMLElement;
  debugCursor: HTMLElement;
  debugLastAction: HTMLElement;
  viewButtons: HTMLButtonElement[];
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

function setCameraStatusValue(tone: StatusTone): string {
  switch (tone) {
    case "ok":
      return "Ready";
    case "loading":
      return "Starting";
    case "warn":
      return "Ready";
    case "error":
      return "Offline";
  }
}

function applyCameraStatus(
  elements: AppElements,
  label: string,
  tone: StatusTone,
  sub: string,
): void {
  setText(elements.cameraDetail, label);
  elements.statusBar.dataset.tone = tone;
  elements.telemetryPanel.dataset.tone = tone;
  setText(elements.telemetryCamera, setCameraStatusValue(tone));
  elements.telemetryCamera.dataset.tone = tone;
  setText(elements.telemetryCameraSub, sub);
}

function setTrackingState(
  elements: AppElements,
  hand: TrackedHand | null,
): void {
  if (hand) {
    setText(
      elements.trackingStatus,
      hand.handedness
        ? `Hand detected · ${hand.handedness}`
        : "Hand detected",
    );
    if (elements.statusBar.dataset.tone !== "error") {
      elements.statusBar.dataset.tone = "ok";
    }
    setText(elements.debugTracking, "Detected");
    setText(elements.telemetryHand, "Detected");
    elements.telemetryHand.dataset.tone = "ok";
    setText(elements.telemetryHandSub, hand.handedness ?? "1 hand tracked");
  } else {
    setText(elements.trackingStatus, "Searching for hand…");
    setText(elements.debugTracking, "No hand detected");
    setText(elements.telemetryHand, "Searching");
    elements.telemetryHand.dataset.tone = "warn";
    setText(elements.telemetryHandSub, "Show one hand");
    const tone = elements.statusBar.dataset.tone;
    if (tone !== "error" && tone !== "loading") {
      elements.statusBar.dataset.tone = "warn";
    }
  }
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function showAppError(elements: AppElements, message: string): void {
  setText(elements.appErrorMessage, message);
  elements.appError.hidden = false;
}

function hideAppError(elements: AppElements): void {
  elements.appError.hidden = true;
}

function showCameraError(elements: AppElements, message: string): void {
  setText(elements.cameraErrorMessage, message);
  elements.cameraError.hidden = false;
}

function hideCameraError(elements: AppElements): void {
  elements.cameraError.hidden = true;
}

function formatPosition(position: {
  x: number;
  y: number;
  z: number;
}): string {
  return `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeApp?.();
  });
}
