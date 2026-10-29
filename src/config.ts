/**
 * Centralized configuration parameters for hand tracking, gesture recognition,
 * 3D interaction, pseudo-physics, and camera controls.
 *
 * Tweak these parameters to adjust feel, smoothing, sensitivity, and animations.
 */

export const LAB_CONFIG = {
  // Hand landmark filtering (One Euro Filter)
  filter: {
    minCutoff: 1.5, // Lower = smoother at rest (less jitter), Higher = faster response
    beta: 0.05,     // Responsiveness to high-speed motion (reduces lag during quick movement)
    dCutoff: 1.0,   // Cutoff frequency for derivative
  },

  // Pinch recognition thresholds with hysteresis & debounce
  pinch: {
    closeThreshold: 0.28,   // Pinch ratio to initiate grab (hysteresis lower bound)
    releaseThreshold: 0.45, // Pinch ratio to release grab (hysteresis upper bound)
    confirmMs: 70,          // Debounce/confirmation window in ms
  },

  // Coordinate mapping from hand webcam space to 3D workspace
  mapping: {
    regionMin: 0.15,
    regionMax: 0.85,
    yWorldPerUnit: 5.5,
    depthWorldPerRatio: 3.2,
    depthRatioMin: 0.55,
    depthRatioMax: 1.8,
  },

  // Bottle pseudo-physics & grab feel
  grab: {
    positionLerpK: 15,       // Damping constant k in 1 - exp(-k * dt) (recommended 12-18)
    liftHeight: 0.4,         // Lift distance in world units (~3-5cm)
    liftDuration: 0.15,      // Ease-out lift duration (seconds)
    scaleOnGrab: 1.03,       // Subtle enlargement when held
    tiltMaxRad: 0.26,        // Maximum tilt angle (~15 degrees in radians)
    tiltResponsiveness: 10,  // How quickly tilt follows velocity
    tiltVelocityScale: 0.08, // Sensitivity of velocity -> tilt angle
    springFrequency: 6.0,    // Idle subtle suspension wobble/spring
    springAmplitude: 0.015,  // Wobble amplitude
  },

  // Pouring animation & proximity
  pour: {
    triggerDistance: 1.35,  // Distance to target vessel to start tilting as pouring
    pourTiltMaxRad: 1.25,   // ~72 degrees pour tilt when directly over beaker
    pourRate: 0.45,         // Liquid transfer rate per second when pouring
  },

  // Tracking loss recovery
  tracking: {
    gracePeriodMs: 300,     // Retain held state if hand lost < 300ms
    cursorHideDelayMs: 450, // Delay before hiding cursor ring
    returnDuration: 0.35,   // Smooth slide duration back to home position
  },

  // Camera OrbitControls
  camera: {
    dampingFactor: 0.08,
    minDistance: 3.0,
    maxDistance: 16.0,
    maxPolarAngle: Math.PI / 2 - 0.05, // Prevent going below table level
    defaultPosition: { x: 0, y: 4.6, z: 8.8 },
    defaultTarget: { x: 0, y: 1.0, z: -0.2 },
  },
} as const;

export type LabConfig = typeof LAB_CONFIG;
