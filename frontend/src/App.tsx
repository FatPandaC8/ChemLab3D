import { useState, useEffect, useCallback, type ReactNode } from "react"
import { Lab3DScene, type ExperimentState } from "./components/Lab3DScene"

function Icon({
  children,
  size = 18,
  viewBox = "0 0 24 24",
}: {
  children: ReactNode
  size?: number
  viewBox?: string
}) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      height={size}
      viewBox={viewBox}
      width={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {children}
    </svg>
  )
}

function RotateIcon() {
  return (
    <Icon>
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
    </Icon>
  )
}

function SettingsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </Icon>
  )
}

function EyeIcon() {
  return (
    <Icon>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  )
}

function HandIcon() {
  return (
    <Icon size={16}>
      <path d="M8 11V7a1.5 1.5 0 0 1 3 0v3-5a1.5 1.5 0 0 1 3 0v5-3a1.5 1.5 0 0 1 3 0v4-2a1.5 1.5 0 0 1 3 0v4c0 4-2.7 7-7 7h-1.2c-2.3 0-3.8-1-5-2.8L4 13.5a1.5 1.5 0 0 1 2.3-1.9L8 13" />
    </Icon>
  )
}

function CheckIcon() {
  return (
    <Icon size={16}>
      <polyline points="20 6 9 17 4 12" />
    </Icon>
  )
}

function Button({
  children,
  className = "",
  label,
  onClick,
}: {
  children: ReactNode
  className?: string
  label?: string
  onClick?: () => void
}) {
  return (
    <button
      aria-label={label}
      className={`button ${className}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

export default function App() {
  const [labState, setLabState] = useState<ExperimentState>("ready")
  const [viewPreset, setViewPreset] =
    useState<"perspective" | "top" | "side" | "closeup">("perspective")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cameraPreviewEnabled, setCameraPreviewEnabled] = useState(false)
  const [handPos, setHandPos] = useState({ x: -0.3, y: 0.1, z: 0.2 })
  const [isPinching, setIsPinching] = useState(false)

  // Real-time reaction telemetry
  const [pH, setPH] = useState(3.1)
  const [temperature, setTemperature] = useState(21.4)
  const [titrantVolume, setTitrantVolume] = useState(0.0)

  // Step progression logic
  const getStep = useCallback((state: ExperimentState) => {
    switch (state) {
      case "ready":
      case "hand-detected":
        return 1
      case "held":
      case "invalid-placement":
        return 2
      case "correct-placement":
      case "reaction":
        return 3
      case "complete":
        return 4
      default:
        return 1
    }
  }, [])

  const step = getStep(labState)

  // Reaction timer effect
  useEffect(() => {
    if (labState !== "reaction") return

    const interval = window.setInterval(() => {
      setPH((prev) => Math.min(Number((prev + 0.18).toFixed(2)), 7.0))
      setTemperature((prev) => Math.min(Number((prev + 0.11).toFixed(1)), 23.8))
      setTitrantVolume((prev) =>
        Math.min(Number((prev + 1.2).toFixed(1)), 25.0),
      )
    }, 150)

    const completeTimer = window.setTimeout(() => {
      setLabState("complete")
      setPH(7.0)
      setTemperature(23.8)
      setTitrantVolume(25.0)
    }, 3800)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(completeTimer)
    }
  }, [labState])

  // Mouse move over 3D scene to guide spatial hand position
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    setHandPos((prev) => ({ ...prev, x: x * 1.2, y: y * 0.8 }))

    if (labState === "ready") {
      setLabState("hand-detected")
    }
  }

  const restartExperiment = () => {
    setLabState("ready")
    setPH(3.1)
    setTemperature(21.4)
    setTitrantVolume(0.0)
    setIsPinching(false)
    setHandPos({ x: -0.3, y: 0.1, z: 0.2 })
  }

  const handlePinchGrab = () => {
    setIsPinching(true)
    setLabState("held")
  }

  const handleAlignTarget = () => {
    setLabState("correct-placement")
  }

  const handleInvalidPlacement = () => {
    setLabState("invalid-placement")
  }

  const handlePourReaction = () => {
    setLabState("reaction")
  }

  return (
    <main className="app-shell" onMouseMove={handleMouseMove}>
      {/* 1. Compact Top Bar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <i />
            <b />
          </div>
          <div>
            <span className="brand-name">Virtual Chemistry Lab</span>
            <span className="experiment-name">
              Neutralization Titration & pH Indicator
            </span>
          </div>
        </div>

        {/* 3D Camera Angles */}
        <div className="view-presets" aria-label="3D View Angles">
          <span className="view-label">3D View</span>
          <Button
            className={`view-pill ${
              viewPreset === "perspective" ? "active" : ""
            }`}
            onClick={() => setViewPreset("perspective")}
          >
            Perspective
          </Button>
          <Button
            className={`view-pill ${viewPreset === "top" ? "active" : ""}`}
            onClick={() => setViewPreset("top")}
          >
            Top Down
          </Button>
          <Button
            className={`view-pill ${viewPreset === "side" ? "active" : ""}`}
            onClick={() => setViewPreset("side")}
          >
            Side Ortho
          </Button>
          <Button
            className={`view-pill ${viewPreset === "closeup" ? "active" : ""}`}
            onClick={() => setViewPreset("closeup")}
          >
            Vessel Focus
          </Button>
        </div>

        {/* Experiment Progress */}
        <div
          className="top-progress"
          aria-label={`Experiment progress: Step ${step} of 4`}
        >
          <div className="progress-copy">
            <span>Experiment progress</span>
            <strong>
              {step} <i>/ 4</i>
            </strong>
          </div>
          <div className="progress-track">
            {[1, 2, 3, 4].map((item) => (
              <i className={item <= step ? "active" : ""} key={item} />
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="top-actions">
          <Button className="restart-button" onClick={restartExperiment}>
            <RotateIcon />
            <span>Restart</span>
          </Button>
          <Button
            className={`icon-button ${settingsOpen ? "selected" : ""}`}
            label="Open tracking settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <SettingsIcon />
          </Button>
        </div>
      </header>

      {/* 2. Dominant 3D Laboratory Scene (75-85% visual attention) */}
      <section
        className="workspace"
        aria-label="Interactive 3D laboratory workspace"
      >
        <Lab3DScene
          handPosition={handPos}
          isPinching={isPinching}
          onStateChange={setLabState}
          state={labState}
          viewPreset={viewPreset}
        />

        {/* Floating Instruction Panel (Left edge) */}
        <aside className="instruction-panel">
          <div className="step-heading">
            <div
              className={`step-icon ${
                labState === "complete" ? "success" : ""
              }`}
            >
              {labState === "complete" ? <CheckIcon /> : <span>{step}</span>}
            </div>
            <div>
              <span>STEP {step} OF 4</span>
              <strong>
                {labState === "complete"
                  ? "Titration Complete"
                  : labState === "reaction"
                    ? "Observe Neutralization"
                    : labState === "correct-placement"
                      ? "Release to Pour Titrant"
                      : labState === "held"
                        ? "Position Over Beaker"
                        : labState === "invalid-placement"
                          ? "Re-align Flask"
                          : "Pinch to Grab Flask"}
              </strong>
            </div>
          </div>

          <p className="instruction-copy">
            {labState === "complete"
              ? "Endpoint achieved: 0.1M NaOH neutralized the acidic solution to pH 7.00. The indicator turned stable turquoise."
              : labState === "reaction"
                ? "Exothermic reaction underway: observing indicator color shift, effervescent micro-bubbles, and rising liquid volume."
                : labState === "correct-placement"
                  ? "Optimal alignment reached above beaker. Release pinch gesture to tilt the flask and pour titrant."
                  : labState === "held"
                    ? "Hold pinch and move your hand along X and Z depth coordinates towards the highlighted target beaker."
                    : labState === "invalid-placement"
                      ? "Flask is outside the safe pouring threshold. Align over the green targeting ring."
                      : "Pinch thumb and index finger over the NaOH reagent flask on the left workbench to grab and lift it."}
          </p>

          <div
            className={`action-hint ${
              labState === "reaction" ? "working" : ""
            }`}
          >
            <span className="hint-symbol">
              {labState === "reaction" ? (
                <i className="spinner" />
              ) : labState === "complete" ? (
                <CheckIcon />
              ) : (
                <HandIcon />
              )}
            </span>
            <div>
              <small>
                {labState === "reaction"
                  ? "REACTION IN PROGRESS"
                  : labState === "complete"
                    ? "ENDPOINT REACHED"
                    : "NEXT ACTION"}
              </small>
              <strong>
                {labState === "reaction"
                  ? "Stabilizing solution…"
                  : labState === "complete"
                    ? "pH 7.00 Neutralized"
                    : labState === "correct-placement"
                      ? "Release pinch to pour"
                      : labState === "held"
                        ? "Move toward beaker mouth"
                        : "Pinch flask to grab"}
              </strong>
            </div>
          </div>

          <div className="mini-progress">
            <i style={{ width: `${step * 25}%` }} />
          </div>
          <div className="progress-label">
            <span>
              {labState === "complete"
                ? "All steps verified"
                : `${4 - step} steps remaining`}
            </span>
            <strong>{step * 25}%</strong>
          </div>
        </aside>

        {/* Real-Time Reaction Telemetry HUD (Bottom Right) */}
        <div className="telemetry-panel" aria-label="Reaction Telemetry">
          <div className="telemetry-header">
            <span className="telemetry-dot" />
            <span>LIVE TITRATION TELEMETRY</span>
          </div>
          <div className="telemetry-grid">
            <div className="telemetry-card">
              <span className="card-label">pH Value</span>
              <strong
                className={`card-value ${pH >= 7.0 ? "ph-neutral" : "ph-acid"}`}
              >
                {pH.toFixed(2)}
              </strong>
              <small className="card-sub">
                {pH >= 7.0 ? "Neutral Endpoint" : "Acidic Solution"}
              </small>
            </div>
            <div className="telemetry-card">
              <span className="card-label">Temperature</span>
              <strong className="card-value">
                {temperature.toFixed(1)} °C
              </strong>
              <small className="card-sub">Exothermic Δ +2.4°</small>
            </div>
            <div className="telemetry-card">
              <span className="card-label">NaOH Added</span>
              <strong className="card-value">
                {titrantVolume.toFixed(1)} mL
              </strong>
              <small className="card-sub">0.100 M Standard</small>
            </div>
          </div>
        </div>

        {/* Interactive Gesture Simulation Bar (Discreet helper to test all states without physical camera) */}
        <div className="gesture-test-bar" aria-label="Gesture state simulator">
          <span className="test-bar-label">Gesture State Simulator</span>
          <Button
            className={`test-btn ${labState === "ready" ? "active" : ""}`}
            onClick={() => setLabState("ready")}
          >
            Ready
          </Button>
          <Button
            className={`test-btn ${
              labState === "hand-detected" ? "active" : ""
            }`}
            onClick={() => setLabState("hand-detected")}
          >
            Hand In View
          </Button>
          <Button
            className={`test-btn ${labState === "held" ? "active" : ""}`}
            onClick={handlePinchGrab}
          >
            Pinch & Grab
          </Button>
          <Button
            className={`test-btn ${
              labState === "correct-placement" ? "active" : ""
            }`}
            onClick={handleAlignTarget}
          >
            Align Vessel
          </Button>
          <Button
            className={`test-btn ${
              labState === "invalid-placement" ? "active" : ""
            }`}
            onClick={handleInvalidPlacement}
          >
            Off-Target
          </Button>
          <Button
            className={`test-btn ${labState === "reaction" ? "active" : ""}`}
            onClick={handlePourReaction}
          >
            Pour & React
          </Button>
        </div>

        {/* Minimal Tracking Status Indicator (Bottom Left) */}
        <div
          className={`status-bar ${
            labState === "camera-error" ? "has-error" : ""
          }`}
          aria-live="polite"
        >
          <div className="status-item">
            <i className="status-dot" />
            <span>
              {labState === "camera-error"
                ? "Camera unavailable"
                : "Camera ready"}
            </span>
          </div>
          <div className="status-divider" />
          <div className="status-item">
            <HandIcon />
            <span>
              {labState === "ready" ? "Hand searching…" : "Hand detected"}
            </span>
          </div>
          {(labState === "held" ||
            labState === "correct-placement" ||
            labState === "reaction") && (
            <>
              <div className="status-divider" />
              <div className="status-item held">
                <i className="held-dot" />
                <span>Object held (NaOH)</span>
              </div>
            </>
          )}
        </div>

        {/* Subtle Gesture Hint (Bottom Center) */}
        <div className="gesture-strip">
          <span className="gesture-icon">
            <i />
            <b />
          </span>
          <span>
            <strong>Pinch</strong> to grab
          </span>
          <i />
          <span>
            <strong>Move (X, Y, Z)</strong> to position
          </span>
          <i />
          <span>
            <strong>Release</strong> to drop / pour
          </span>
        </div>

        {/* Settings Popover (Discreet Camera Preview & Diagnostics) */}
        {settingsOpen && (
          <div
            className="settings-popover"
            role="dialog"
            aria-label="Tracking & Hardware Settings"
          >
            <div className="settings-title">
              <span>Webcam & Input Settings</span>
              <small>Invisible background tracking</small>
            </div>
            <Button
              className="setting-row"
              onClick={() => setCameraPreviewEnabled(!cameraPreviewEnabled)}
            >
              <span>
                <strong>Camera Preview Overlay</strong>
                <small>Discreet diagnostic window (off by default)</small>
              </span>
              <i className={`toggle ${cameraPreviewEnabled ? "on" : ""}`}>
                <b />
              </i>
            </Button>

            <Button
              className="setting-row"
              onClick={() =>
                setLabState(
                  labState === "camera-error" ? "ready" : "camera-error",
                )
              }
            >
              <span>
                <strong>Camera Hardware Connection</strong>
                <small>
                  {labState === "camera-error"
                    ? "Access error (Click to retry)"
                    : "60 FPS 1080p Optical Sensor"}
                </small>
              </span>
              <i
                className={`connection ${
                  labState === "camera-error" ? "error" : ""
                }`}
              />
            </Button>

            <div className="setting-slider-group">
              <div className="slider-label">
                <span>Depth Tracking Sensitivity</span>
                <strong>High (Z-axis enabled)</strong>
              </div>
              <div className="slider-track">
                <i style={{ width: "82%" }} />
              </div>
            </div>

            {cameraPreviewEnabled && (
              <div className="camera-preview">
                <div className="preview-reticle">
                  <span className="reticle-ring" />
                  <span className="preview-label">Hand tracking active</span>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
