/**
 * Deterministic chemistry experiment definitions and state machine.
 *
 * This module contains no Three.js or webcam code. The 3D scene reports where
 * an instrument was released; the state machine decides whether that counts as
 * a valid step. Keeping the rules here makes them testable without a browser.
 */

export type ExperimentId = "precipitation" | "limestone";

export type ExperimentEffect = "precipitate" | "bubbles";

export type ExperimentPhase = "idle" | "ready" | "running" | "animating" | "complete";

export type FeedbackTone = "idle" | "info" | "success" | "error" | "complete";

export interface ExperimentStep {
  readonly id: string;
  /** Scene instrument id that must be carried. */
  readonly reagentId: string;
  readonly reagentName: string;
  /** Scene target id the instrument must be released over. */
  readonly targetId: string;
  readonly targetName: string;
  readonly prompt: string;
  readonly success: string;
}

export interface ExperimentDefinition {
  readonly id: ExperimentId;
  readonly title: string;
  readonly subtitle: string;
  readonly equation: string;
  readonly objective: string;
  readonly safety: string;
  readonly effect: ExperimentEffect;
  readonly resultTitle: string;
  readonly resultText: string;
  /** Liquid colour after each successful addition, by step index. */
  readonly liquidColors: readonly number[];
  readonly steps: readonly ExperimentStep[];
}

export interface ExperimentFeedback {
  readonly text: string;
  readonly tone: FeedbackTone;
}

export interface ExperimentSnapshot {
  readonly experimentId: ExperimentId | null;
  readonly phase: ExperimentPhase;
  readonly stepIndex: number;
  readonly totalSteps: number;
  readonly step: ExperimentStep | null;
  readonly feedback: ExperimentFeedback;
  readonly completed: boolean;
  /** True only while releasing an instrument can be evaluated. */
  readonly canInteract: boolean;
  readonly progress: number;
}

export interface TransferResult {
  readonly accepted: boolean;
  readonly isFinal: boolean;
  readonly reason:
    | "accepted"
    | "no-experiment"
    | "not-running"
    | "wrong-reagent"
    | "wrong-target";
  readonly message: string;
  readonly stepIndex: number;
}

export const EXPERIMENTS: Readonly<Record<ExperimentId, ExperimentDefinition>> = {
  precipitation: {
    id: "precipitation",
    title: "White precipitate",
    subtitle: "Barium chloride + sulfuric acid",
    equation: "BaCl₂ + H₂SO₄ → BaSO₄↓ + 2HCl",
    objective:
      "Add barium chloride solution to the beaker, then add dilute sulfuric acid to form a white BaSO₄ precipitate.",
    safety: "Wear goggles. Barium salts are toxic; handle the solutions over the tray.",
    effect: "precipitate",
    resultTitle: "BaSO₄ precipitate formed",
    resultText:
      "A dense white precipitate of barium sulfate has settled in the beaker. This is a positive test for sulfate ions.",
    liquidColors: [0xcfe8ff, 0xeef2f6],
    steps: [
      {
        id: "bacl2",
        reagentId: "bacl2",
        reagentName: "BaCl₂ solution",
        targetId: "beaker",
        targetName: "the beaker",
        prompt: "Pick up the BaCl₂ bottle and release it over the beaker.",
        success: "Barium chloride solution is in the beaker.",
      },
      {
        id: "h2so4",
        reagentId: "h2so4",
        reagentName: "dilute H₂SO₄",
        targetId: "beaker",
        targetName: "the beaker",
        prompt: "Now pick up the dilute H₂SO₄ bottle and release it over the same beaker.",
        success: "Sulfate ions are meeting barium ions in the beaker.",
      },
    ],
  },

  limestone: {
    id: "limestone",
    title: "Limestone fizz",
    subtitle: "Calcium carbonate + hydrochloric acid",
    equation: "CaCO₃ + 2HCl → CaCl₂ + CO₂↑ + H₂O",
    objective:
      "Add limestone chips to the flask, then pour dilute hydrochloric acid over them and watch the CO₂ bubbles.",
    safety: "Keep the flask mouth open. Never stopper a vessel while gas is being produced.",
    effect: "bubbles",
    resultTitle: "Carbon dioxide released",
    resultText:
      "The limestone fizzes and slowly dissolves. The gas escaping from the flask is carbon dioxide.",
    liquidColors: [0xdff3ff, 0xd9f7e5],
    steps: [
      {
        id: "caco3",
        reagentId: "caco3",
        reagentName: "CaCO₃ limestone chips",
        targetId: "flask",
        targetName: "the Erlenmeyer flask",
        prompt: "Pick up the limestone jar and release it over the Erlenmeyer flask.",
        success: "Limestone chips are resting in the flask.",
      },
      {
        id: "hcl",
        reagentId: "hcl",
        reagentName: "dilute HCl",
        targetId: "flask",
        targetName: "the flask",
        prompt: "Now pick up the dilute HCl bottle and release it over the flask.",
        success: "Acid is reacting with the limestone.",
      },
    ],
  },
};

export function getExperiment(id: ExperimentId): ExperimentDefinition {
  return EXPERIMENTS[id];
}

const IDLE_FEEDBACK: ExperimentFeedback = {
  text: "Choose an experiment to begin.",
  tone: "idle",
};

/**
 * Explicit experiment state. The only ways to advance are:
 *  - start a predefined experiment;
 *  - attempt a transfer with the expected reagent and target;
 *  - finish the pour/reaction animation.
 */
export class ExperimentEngine {
  private definition: ExperimentDefinition | null = null;
  private phase: ExperimentPhase = "idle";
  private stepIndex = 0;
  private feedback: ExperimentFeedback = IDLE_FEEDBACK;

  start(id: ExperimentId): ExperimentSnapshot {
    this.definition = getExperiment(id);
    this.phase = "running";
    this.stepIndex = 0;
    this.feedback = {
      text: `Step 1 of ${this.definition.steps.length}: ${this.currentStep()?.prompt ?? ""}`,
      tone: "info",
    };
    return this.getSnapshot();
  }

  /** Re-run the current experiment from its initial scene state. */
  restart(): ExperimentSnapshot {
    if (!this.definition) {
      return this.getSnapshot();
    }
    return this.start(this.definition.id);
  }

  /** Leave the experiment and return to the selection screen. */
  clear(): ExperimentSnapshot {
    this.definition = null;
    this.phase = "idle";
    this.stepIndex = 0;
    this.feedback = IDLE_FEEDBACK;
    return this.getSnapshot();
  }

  /**
   * Evaluate a release. The scene is responsible for mapping the release
   * position to a target id; a release outside every target passes null.
   */
  attemptTransfer(
    reagentId: string,
    targetId: string | null,
  ): TransferResult {
    if (!this.definition) {
      return this.result(false, false, "no-experiment", "Choose an experiment first.");
    }
    if (this.phase !== "running") {
      const message =
        this.phase === "animating"
          ? "Wait for the current pour to finish."
          : this.phase === "complete"
            ? "This experiment is already complete. Restart it to try again."
            : "Start the experiment before moving instruments.";
      this.feedback = { text: message, tone: "error" };
      return this.result(false, false, "not-running", message);
    }

    const expected = this.currentStep();
    if (!expected) {
      return this.result(false, false, "not-running", "No experiment step is active.");
    }

    if (reagentId !== expected.reagentId) {
      const reagent = this.definition.steps.find(
        (step) => step.reagentId === reagentId,
      );
      const message = reagent
        ? `Not yet — ${expected.reagentName} must go into ${expected.targetName} first.`
        : "That instrument is not part of this experiment.";
      this.feedback = { text: message, tone: "error" };
      return this.result(false, false, "wrong-reagent", message);
    }

    if (targetId === null) {
      const message = `Release ${expected.reagentName} over ${expected.targetName}.`;
      this.feedback = { text: message, tone: "error" };
      return this.result(false, false, "wrong-target", message);
    }

    if (targetId !== expected.targetId) {
      const message = `Wrong vessel — ${expected.reagentName} belongs in ${expected.targetName}.`;
      this.feedback = { text: message, tone: "error" };
      return this.result(false, false, "wrong-target", message);
    }

    const isFinal = this.stepIndex === this.definition.steps.length - 1;
    this.stepIndex += 1;
    this.phase = "animating";
    const message = isFinal
      ? "Conditions satisfied — the reaction is starting."
      : expected.success;
    this.feedback = { text: message, tone: "success" };
    return this.result(true, isFinal, "accepted", message);
  }

  /**
   * Called by the scene after the pour (and, on the final step, after the
   * reaction animation) finishes.
   */
  finishStep(): ExperimentSnapshot {
    if (!this.definition || this.phase !== "animating") {
      return this.getSnapshot();
    }

    if (this.stepIndex >= this.definition.steps.length) {
      this.phase = "complete";
      this.feedback = {
        text: `${this.definition.resultTitle}. ${this.definition.resultText}`,
        tone: "complete",
      };
    } else {
      this.phase = "running";
      const step = this.currentStep();
      this.feedback = {
        text: `Step ${this.stepIndex + 1} of ${this.definition.steps.length}: ${step?.prompt ?? ""}`,
        tone: "info",
      };
    }
    return this.getSnapshot();
  }

  getSnapshot(): ExperimentSnapshot {
    const step = this.currentStep();
    return {
      experimentId: this.definition?.id ?? null,
      phase: this.phase,
      stepIndex: this.stepIndex,
      totalSteps: this.definition?.steps.length ?? 0,
      step,
      feedback: this.feedback,
      completed: this.phase === "complete",
      canInteract: this.phase === "running",
      progress:
        this.definition && this.definition.steps.length > 0
          ? Math.min(1, this.stepIndex / this.definition.steps.length)
          : 0,
    };
  }

  private currentStep(): ExperimentStep | null {
    if (!this.definition) {
      return null;
    }
    return this.definition.steps[this.stepIndex] ?? null;
  }

  private result(
    accepted: boolean,
    isFinal: boolean,
    reason: TransferResult["reason"],
    message: string,
  ): TransferResult {
    return { accepted, isFinal, reason, message, stepIndex: this.stepIndex };
  }
}
