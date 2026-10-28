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
import { ChemistryScene } from "./lab/scene";
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
  const elements = {
    statusBadge: requireElement<HTMLDivElement>("#status-badge"),
    cameraDetail: requireElement<HTMLSpanElement>("#camera-detail"),
    videoShell: requireElement<HTMLDivElement>("#video-shell"),
    video: requireElement<HTMLVideoElement>("#webcam"),
    landmarks: requireElement<HTMLCanvasElement>("#landmarks"),
    videoPlaceholder: requireElement<HTMLDivElement>("#video-placeholder"),
    cameraError: requireElement<HTMLDivElement>("#camera-error"),
    cameraErrorMessage: requireElement<HTMLParagraphElement>(
      "#camera-error-message",
    ),
    retryCamera: requireElement<HTMLButtonElement>("#retry-camera"),
    retryCamera2: requireElement<HTMLButtonElement>("#retry-camera-2"),
    cameraSelect: requireElement<HTMLSelectElement>("#camera-select"),
    retrySetup: requireElement<HTMLButtonElement>("#retry-setup"),
    appError: requireElement<HTMLDivElement>("#app-error"),
    appErrorMessage: requireElement<HTMLSpanElement>("#app-error-message"),
    sceneContainer: requireElement<HTMLDivElement>("#scene-container"),
    sceneSubtitle: requireElement<HTMLSpanElement>("#scene-subtitle"),
    interactionStatus: requireElement<HTMLElement>("#interaction-status"),
    targetStatus: requireElement<HTMLElement>("#target-status"),
    sceneInstruction: requireElement<HTMLElement>("#scene-instruction"),
    completionBanner: requireElement<HTMLDivElement>("#completion-banner"),
    completionTitle: requireElement<HTMLElement>("#completion-title"),
    completionText: requireElement<HTMLElement>("#completion-text"),
    phasePill: requireElement<HTMLElement>("#phase-pill"),
    selection: requireElement<HTMLDivElement>("#experiment-selection"),
    runPanel: requireElement<HTMLDivElement>("#experiment-run"),
    experimentTitle: requireElement<HTMLElement>("#experiment-title"),
    experimentEquation: requireElement<HTMLElement>("#experiment-equation"),
    experimentObjective: requireElement<HTMLElement>("#experiment-objective"),
    experimentProgress: requireElement<HTMLElement>("#experiment-progress"),
    experimentProgressLabel: requireElement<HTMLElement>(
      "#experiment-progress-label",
    ),
    experimentSteps: requireElement<HTMLOListElement>("#experiment-steps"),
    experimentFeedback: requireElement<HTMLElement>("#experiment-feedback"),
    experimentSafety: requireElement<HTMLElement>("#experiment-safety"),
    restartExperiment: requireElement<HTMLButtonElement>("#restart-experiment"),
    chooseExperiment: requireElement<HTMLButtonElement>("#choose-experiment"),
    debugTracking: requireElement<HTMLElement>("#debug-tracking"),
    debugGesture: requireElement<HTMLElement>("#debug-gesture"),
    debugSelected: requireElement<HTMLElement>("#debug-selected"),
    debugPosition: requireElement<HTMLElement>("#debug-position"),
    debugAim: requireElement<HTMLElement>("#debug-aim"),
    debugDepth: requireElement<HTMLElement>("#debug-depth"),
    debugPinch: requireElement<HTMLElement>("#debug-pinch"),
    debugCursor: requireElement<HTMLElement>("#debug-cursor"),
    debugLastAction: requireElement<HTMLElement>("#debug-last-action"),
  };

  let sceneView: ChemistryScene;
  try {
    sceneView = new ChemistryScene(elements.sceneContainer);
  } catch (error) {
    setStatus(elements.statusBadge, "3D scene unavailable", "error");
    setText(elements.debugTracking, "WebGL error");
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
  };

  interaction = new InteractionController(sceneView, {
    onGrab: (object) => {
      const grabbedAt = object.mesh.getWorldPosition(new THREE.Vector3());
      lastAction = `grabbed ${object.id ?? object.name} @ ${formatPosition({
        x: grabbedAt.x,
        y: grabbedAt.y,
        z: grabbedAt.z,
      })}`;
      const state = engine.getSnapshot();
      if (state.experimentId && state.phase === "running") {
        setTargetStatus(elements, sceneView, true);
      }
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
  };

  const chooseExperiment = (): void => {
    sessionToken += 1;
    lastAction = "choose experiment";
    interaction.reset();
    engine.clear();
    sceneView.showSelectionScene();
    renderExperimentUI(engine.getSnapshot(), elements);
  };

  elements.selection.addEventListener("click", (event) => {
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
  elements.chooseExperiment.addEventListener("click", chooseExperiment);

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
    elements.retryCamera2.disabled = true;
    elements.cameraSelect.disabled = true;
    hideAppError(elements);
    hideCameraError(elements);

    try {
      if (!tracker.hasCamera) {
        setStatus(elements.statusBadge, "Starting camera…", "loading");
        setText(elements.cameraDetail, "Requesting camera permission…");
        setText(elements.debugTracking, "Starting camera…");
        elements.videoPlaceholder.hidden = false;
        await tracker.startCamera();
        cameraReady = true;
        syncVideoAspect();
        lastVideoTime = -1;
        lastVideoFrameAt = performance.now();
        elements.videoPlaceholder.hidden = true;
        setText(elements.cameraDetail, "Camera ready");
        await refreshCameraList();
      }

      if (!modelReady) {
        setStatus(elements.statusBadge, "Loading hand model…", "loading");
        setText(elements.cameraDetail, "Camera ready · loading model…");
        setText(elements.debugTracking, "Loading hand model…");
        await tracker.loadModel();
        modelReady = true;
      }

      if (cameraReady && modelReady) {
        trackingStopped = false;
        lastVideoFrameAt = performance.now();
        setStatus(elements.statusBadge, "No hand detected", "warn");
        setText(elements.cameraDetail, "Camera ready · model ready");
        setText(elements.debugTracking, "No hand detected");
        elements.cameraSelect.disabled = false;
      }
    } catch (error) {
      if (error instanceof CameraAccessError) {
        cameraReady = false;
        elements.videoPlaceholder.hidden = true;
        showCameraError(elements, error.message);
        setStatus(elements.statusBadge, "Camera unavailable", "error");
        setText(elements.cameraDetail, "Camera unavailable");
        setText(elements.debugTracking, "Camera error");
      } else {
        modelReady = false;
        setStatus(elements.statusBadge, "Model error", "error");
        setText(elements.cameraDetail, "Camera ready · model failed");
        setText(elements.debugTracking, "Model error");
        showAppError(elements, errorMessage(error));
      }
    } finally {
      initializing = false;
      elements.retrySetup.disabled = false;
      elements.retryCamera.disabled = false;
      elements.retryCamera2.disabled = false;
    }
  };

  const switchCamera = async (): Promise<void> => {
    if (!cameraReady || !modelReady || initializing) {
      return;
    }
    const deviceId = elements.cameraSelect.value || undefined;
    setStatus(elements.statusBadge, "Switching camera…", "loading");
    setText(elements.cameraDetail, "Switching camera…");
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
      setStatus(elements.statusBadge, "No hand detected", "warn");
      setText(elements.cameraDetail, "Camera ready · model ready");
      await refreshCameraList();
    } catch (error) {
      cameraReady = false;
      const message =
        error instanceof CameraAccessError
          ? error.message
          : `The selected camera could not be opened: ${errorMessage(error)}`;
      showCameraError(elements, message);
      setStatus(elements.statusBadge, "Camera unavailable", "error");
      setText(elements.cameraDetail, "Camera unavailable");
      setText(elements.debugTracking, "Camera error");
    } finally {
      elements.cameraSelect.disabled = cameraReady && modelReady;
    }
  };

  const updateLiveState = (
    hand: TrackedHand | null,
    snapshot: Readonly<InteractionSnapshot>,
  ): void => {
    if (hand) {
      setStatus(elements.statusBadge, "Hand detected", "ok");
      setText(
        elements.debugTracking,
        hand.handedness ? `Detected (${hand.handedness})` : "Detected",
      );
    } else {
      setStatus(elements.statusBadge, "No hand detected", "warn");
      setText(elements.debugTracking, "No hand detected");
    }

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
        : `${snapshot.depthOffset >= 0 ? "+" : ""}${snapshot.depthOffset.toFixed(2)} · span ${snapshot.palmRatio.toFixed(2)}×`,
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

    const state = engine.getSnapshot();
    if (state.phase === "animating") {
      setInteractionStatus(elements, "Pouring…", "held");
    } else {
      setInteractionStatus(elements, snapshot.status, snapshot.tone);
    }
    setTargetStatus(elements, sceneView, Boolean(snapshot.selectedName));
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
        setStatus(elements.statusBadge, "Tracking error", "error");
        setText(elements.debugTracking, "Tracking error");
        showAppError(
          elements,
          `Hand tracking stopped: ${errorMessage(error)}. Retry setup to restart tracking.`,
        );
      }
    }

    sceneView.update(dt);
    sceneView.render();
  };

  elements.retryCamera.addEventListener("click", () => {
    void initialize();
  });
  elements.retryCamera2.addEventListener("click", () => {
    void initialize();
  });
  elements.retrySetup.addEventListener("click", () => {
    void initialize();
  });
  elements.cameraSelect.addEventListener("change", () => {
    void switchCamera();
  });

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("pagehide", handlePageHide);
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
  setStatus(elements.statusBadge, "Initializing…", "loading");
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
    elements.selection.hidden = false;
    elements.runPanel.hidden = true;
    setText(elements.sceneSubtitle, "Interactive bench");
    setText(
      elements.sceneInstruction,
      "Choose an experiment from the right-hand panel to begin.",
    );
    setPhase(elements.phasePill, "Select", "idle");
    elements.completionBanner.hidden = true;
    return;
  }

  const definition = getExperiment(snapshot.experimentId);
  elements.selection.hidden = true;
  elements.runPanel.hidden = false;
  setText(elements.sceneSubtitle, definition.title);
  setText(elements.experimentTitle, definition.title);
  setText(elements.experimentEquation, definition.equation);
  setText(elements.experimentObjective, definition.objective);
  setText(elements.experimentSafety, `Safety: ${definition.safety}`);

  const progress = Math.round(snapshot.progress * 100);
  elements.experimentProgress.style.width = `${progress}%`;
  setText(
    elements.experimentProgressLabel,
    snapshot.completed
      ? "All validated steps complete"
      : `${Math.min(snapshot.stepIndex, snapshot.totalSteps)} of ${snapshot.totalSteps} validated steps`,
  );

  setText(elements.experimentFeedback, snapshot.feedback.text);
  elements.experimentFeedback.dataset.tone = snapshot.feedback.tone;

  if (snapshot.completed) {
    setPhase(elements.phasePill, "Complete", "complete");
    elements.completionBanner.hidden = false;
    setText(elements.completionTitle, definition.resultTitle);
    setText(elements.completionText, definition.resultText);
    setText(
      elements.sceneInstruction,
      "Experiment complete. Restart it or choose another experiment.",
    );
  } else {
    elements.completionBanner.hidden = true;
    if (snapshot.phase === "animating") {
      setPhase(elements.phasePill, "Pouring…", "busy");
      setText(
        elements.sceneInstruction,
        "Keep the hand visible — the validated pour is playing.",
      );
    } else if (snapshot.phase === "running") {
      setPhase(
        elements.phasePill,
        `Step ${snapshot.stepIndex + 1}/${snapshot.totalSteps}`,
        "active",
      );
      setText(
        elements.sceneInstruction,
        snapshot.step?.prompt ?? "Carry the next reagent to the target.",
      );
    } else {
      setPhase(elements.phasePill, "Ready", "idle");
      setText(
        elements.sceneInstruction,
        snapshot.step?.prompt ?? "Choose a reagent and release it over the target.",
      );
    }
  }

  renderSteps(elements.experimentSteps, definition, snapshot);
}

function renderSteps(
  list: HTMLOListElement,
  definition: ExperimentDefinition,
  snapshot: ExperimentSnapshot,
): void {
  list.replaceChildren();
  definition.steps.forEach((step, index) => {
    const item = document.createElement("li");
    const done =
      snapshot.completed || index < snapshot.stepIndex;
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

function setTargetStatus(
  elements: AppElements,
  sceneView: ChemistryScene,
  hasHeldObject: boolean,
): void {
  if (!hasHeldObject) {
    elements.targetStatus.hidden = true;
    return;
  }
  const target = sceneView.targetUnderHeld();
  if (target) {
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
  elements.targetStatus.hidden = false;
}

// -------------------------------------------------------------------------
// Small DOM helpers
// -------------------------------------------------------------------------

type AppElements = {
  statusBadge: HTMLDivElement;
  cameraDetail: HTMLSpanElement;
  videoShell: HTMLDivElement;
  video: HTMLVideoElement;
  landmarks: HTMLCanvasElement;
  videoPlaceholder: HTMLDivElement;
  cameraError: HTMLDivElement;
  cameraErrorMessage: HTMLParagraphElement;
  retryCamera: HTMLButtonElement;
  retryCamera2: HTMLButtonElement;
  cameraSelect: HTMLSelectElement;
  retrySetup: HTMLButtonElement;
  appError: HTMLDivElement;
  appErrorMessage: HTMLSpanElement;
  sceneContainer: HTMLDivElement;
  sceneSubtitle: HTMLSpanElement;
  interactionStatus: HTMLElement;
  targetStatus: HTMLElement;
  sceneInstruction: HTMLElement;
  completionBanner: HTMLDivElement;
  completionTitle: HTMLElement;
  completionText: HTMLElement;
  phasePill: HTMLElement;
  selection: HTMLDivElement;
  runPanel: HTMLDivElement;
  experimentTitle: HTMLElement;
  experimentEquation: HTMLElement;
  experimentObjective: HTMLElement;
  experimentProgress: HTMLElement;
  experimentProgressLabel: HTMLElement;
  experimentSteps: HTMLOListElement;
  experimentFeedback: HTMLElement;
  experimentSafety: HTMLElement;
  restartExperiment: HTMLButtonElement;
  chooseExperiment: HTMLButtonElement;
  debugTracking: HTMLElement;
  debugGesture: HTMLElement;
  debugSelected: HTMLElement;
  debugPosition: HTMLElement;
  debugAim: HTMLElement;
  debugDepth: HTMLElement;
  debugPinch: HTMLElement;
  debugCursor: HTMLElement;
  debugLastAction: HTMLElement;
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

function setStatus(
  badge: HTMLElement,
  text: string,
  tone: StatusTone,
): void {
  setText(badge, text);
  if (badge.dataset.tone !== tone) {
    badge.dataset.tone = tone;
  }
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function setInteractionStatus(
  elements: AppElements,
  text: string,
  tone: string,
): void {
  setText(elements.interactionStatus, text);
  if (elements.interactionStatus.dataset.tone !== tone) {
    elements.interactionStatus.dataset.tone = tone;
  }
}

function setPhase(element: HTMLElement, text: string, tone: string): void {
  setText(element, text);
  if (element.dataset.tone !== tone) {
    element.dataset.tone = tone;
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
