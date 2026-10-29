import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

export type ExperimentState = "ready" | "hand-detected" | "held" | "correct-placement" | "invalid-placement" | "reaction" | "complete" | "camera-error"

interface Lab3DSceneProps {
  state: ExperimentState
  onStateChange: (newState: ExperimentState) => void
  onFlaskGrab?: () => void
  onFlaskPour?: () => void
  viewPreset: "perspective" | "top" | "side" | "closeup"
  handPosition: { x: number y: number z: number } // normalized [-1, 1]
  isPinching: boolean
}

export function Lab3DScene({
  state,
  onStateChange,
  viewPreset,
  handPosition,
  isPinching,
}: Lab3DSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    flaskGroup: THREE.Group
    flaskLiquid: THREE.Mesh
    beakerLiquid: THREE.Mesh
    beakerLiquidMaterial: THREE.MeshPhysicalMaterial
    pourStream: THREE.Mesh
    bubbleParticles: THREE.Points
    vaporParticles: THREE.Points
    handCursorGroup: THREE.Group
    targetHalo: THREE.Mesh
    alignmentGuide: THREE.Line
    scaleTextCanvas: HTMLCanvasElement
    scaleTextTexture: THREE.CanvasTexture
  } | null>(null)

  const stateRef = useRef(state)
  stateRef.current = state

  const handPosRef = useRef(handPosition)
  handPosRef.current = handPosition

  const isPinchingRef = useRef(isPinching)
  isPinchingRef.current = isPinching

  // Setup Three.js scene
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight

    // 1. Scene & Camera
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xdce5e4)
    scene.fog = new THREE.FogExp2(0xdce5e4, 0.028)

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100)
    camera.position.set(0, 4.2, 7.8)

    // 2. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12
    container.innerHTML = ""
    container.appendChild(renderer.domElement)

    // 3. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.maxPolarAngle = Math.PI / 2 - 0.02
    controls.minDistance = 2.5
    controls.maxDistance = 14
    controls.target.set(0, 1.4, 0)
    controls.update()

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9)
    scene.add(ambientLight)

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.6)
    mainLight.position.set(4, 9, 6)
    mainLight.castShadow = true
    mainLight.shadow.mapSize.width = 2048
    mainLight.shadow.mapSize.height = 2048
    mainLight.shadow.bias = -0.0001
    mainLight.shadow.camera.near = 1
    mainLight.shadow.camera.far = 25
    mainLight.shadow.camera.left = -6
    mainLight.shadow.camera.right = 6
    mainLight.shadow.camera.top = 6
    mainLight.shadow.camera.bottom = -6
    mainLight.shadow.radius = 2.5
    scene.add(mainLight)

    const fillLight = new THREE.DirectionalLight(0xbde0e5, 0.7)
    fillLight.position.set(-5, 6, 3)
    scene.add(fillLight)

    const rimLight = new THREE.PointLight(0x75d0cf, 2.2, 10)
    rimLight.position.set(0, 3.5, -2.5)
    scene.add(rimLight)

    // 5. Materials
    const benchMaterial = new THREE.MeshStandardMaterial({
      color: 0xcdd7d4,
      roughness: 0.35,
      metalness: 0.08,
    })

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xe6edea,
      roughness: 0.85,
      metalness: 0.02,
    })

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.94,
      opacity: 1,
      transparent: true,
      roughness: 0.04,
      ior: 1.52,
      thickness: 0.5,
      specularIntensity: 1.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    })

    const naohLiquidMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x22a89d,
      transmission: 0.8,
      opacity: 0.9,
      transparent: true,
      roughness: 0.08,
      ior: 1.34,
      thickness: 0.8,
    })

    const beakerLiquidMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xdf84a5, // Initial acidic indicator (rosy/magenta)
      transmission: 0.82,
      opacity: 0.9,
      transparent: true,
      roughness: 0.06,
      ior: 1.34,
      thickness: 1.0,
    })

    // 6. Workbench Surface
    const benchGeo = new THREE.BoxGeometry(16, 0.4, 8)
    const benchMesh = new THREE.Mesh(benchGeo, benchMaterial)
    benchMesh.position.set(0, -0.2, 0)
    benchMesh.receiveShadow = true
    scene.add(benchMesh)

    // Bench front edge trim
    const trimGeo = new THREE.BoxGeometry(16, 0.08, 0.1)
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x98a8a4,
      roughness: 0.4,
    })
    const trimMesh = new THREE.Mesh(trimGeo, trimMat)
    trimMesh.position.set(0, -0.04, 4.01)
    scene.add(trimMesh)

    // Back wall with tile accents
    const backWallGeo = new THREE.PlaneGeometry(24, 12)
    const backWallMesh = new THREE.Mesh(backWallGeo, wallMaterial)
    backWallMesh.position.set(0, 5, -4)
    backWallMesh.receiveShadow = true
    scene.add(backWallMesh)

    // Reagent shelf in background
    const shelfGeo = new THREE.BoxGeometry(9, 0.12, 0.8)
    const shelfMat = new THREE.MeshStandardMaterial({
      color: 0xb5c3c0,
      roughness: 0.4,
    })
    const shelfMesh = new THREE.Mesh(shelfGeo, shelfMat)
    shelfMesh.position.set(0, 3.2, -3.4)
    shelfMesh.castShadow = true
    shelfMesh.receiveShadow = true
    scene.add(shelfMesh)

    // Shelf bracket supports
    for (const sx of [-3.6, 0, 3.6]) {
      const bracketGeo = new THREE.BoxGeometry(0.08, 0.6, 0.7)
      const bracketMesh = new THREE.Mesh(bracketGeo, shelfMat)
      bracketMesh.position.set(sx, 2.85, -3.4)
      scene.add(bracketMesh)
    }

    // Shelf Reagent Bottles (Amber, Blue, Green, Clear)
    const bottleColors = [0xb86c2e, 0x1f7fa8, 0x338f68, 0xd0d8d6, 0xa55234]
    const bottleLabels = ["HCl 1M", "CuSO₄", "FeCl₃", "AgNO₃", "HNO₃"]
    bottleColors.forEach((color, i) => {
      const bGroup = new THREE.Group()
      const bBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 0.65, 24),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.2,
          metalness: 0.1,
          transparent: true,
          opacity: 0.85,
        }),
      )
      bBody.castShadow = true
      bGroup.add(bBody)

      const bCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.18, 16),
        new THREE.MeshStandardMaterial({ color: 0x222625, roughness: 0.5 }),
      )
      bCap.position.y = 0.4
      bGroup.add(bCap)

      // Mini label
      const lblCanvas = document.createElement("canvas")
      lblCanvas.width = 128
      lblCanvas.height = 64
      const lctx = lblCanvas.getContext("2d")
      if (lctx) {
        lctx.fillStyle = "#f8f6ee"
        lctx.fillRect(0, 0, 128, 64)
        lctx.fillStyle = "#223330"
        lctx.font = "bold 22px sans-serif"
        lctx.textAlign = "center"
        lctx.fillText(bottleLabels[i], 64, 40)
      }
      const lblTex = new THREE.CanvasTexture(lblCanvas)
      const lblMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.245,
          0.245,
          0.35,
          24,
          1,
          true,
          -Math.PI / 3,
          (2 * Math.PI) / 3,
        ),
        new THREE.MeshBasicMaterial({ map: lblTex, side: THREE.DoubleSide }),
      )
      bGroup.add(lblMesh)

      bGroup.position.set(-3.2 + i * 1.6, 3.65, -3.4)
      scene.add(bGroup)
    })

    // 7. Test Tube Rack on the Workbench (Left depth)
    const rackGroup = new THREE.Group()
    const rackPlankGeo = new THREE.BoxGeometry(1.6, 0.06, 0.45)
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0xb79f87,
      roughness: 0.6,
    })
    const rackTop = new THREE.Mesh(rackPlankGeo, woodMat)
    rackTop.position.y = 0.75
    const rackBot = new THREE.Mesh(rackPlankGeo, woodMat)
    rackBot.position.y = 0.04
    const rackSide1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.75, 0.45),
      woodMat,
    )
    rackSide1.position.set(-0.77, 0.4, 0)
    const rackSide2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.75, 0.45),
      woodMat,
    )
    rackSide2.position.set(0.77, 0.4, 0)
    rackGroup.add(rackTop, rackBot, rackSide1, rackSide2)

    // Tubes inside rack
    const tubeLiquidColors = [0x2ca39b, 0xc46b3f, 0x3d7eb3, 0xccb043]
    for (let t = 0; t < 4; t++) {
      const tubeGroup = new THREE.Group()
      const tubeGlass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.9, 16, 1, true),
        glassMaterial,
      )
      const tubeBottom = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.09,
          16,
          8,
          0,
          Math.PI * 2,
          Math.PI / 2,
          Math.PI / 2,
        ),
        glassMaterial,
      )
      tubeBottom.position.y = -0.45
      tubeGroup.add(tubeGlass, tubeBottom)

      const tubeLiq = new THREE.Mesh(
        new THREE.CylinderGeometry(0.082, 0.082, 0.45, 16),
        new THREE.MeshPhysicalMaterial({
          color: tubeLiquidColors[t],
          transmission: 0.75,
          transparent: true,
          opacity: 0.85,
          roughness: 0.1,
        }),
      )
      tubeLiq.position.y = -0.2
      tubeGroup.add(tubeLiq)
      tubeGroup.position.set(-0.55 + t * 0.36, 0.52, 0)
      rackGroup.add(tubeGroup)
    }
    rackGroup.position.set(-2.8, 0, -1.2)
    rackGroup.castShadow = true
    scene.add(rackGroup)

    // 8. Titration Retort Stand & Upright Rod (Behind Reaction Beaker)
    const standGroup = new THREE.Group()
    const standBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.08, 1.1),
      new THREE.MeshStandardMaterial({
        color: 0x384042,
        roughness: 0.7,
        metalness: 0.3,
      }),
    )
    standBase.position.y = 0.04
    standBase.castShadow = true
    standBase.receiveShadow = true
    standGroup.add(standBase)

    const standRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 3.8, 16),
      new THREE.MeshStandardMaterial({
        color: 0xd9e0e2,
        roughness: 0.2,
        metalness: 0.85,
      }),
    )
    standRod.position.set(-0.6, 1.9, -0.35)
    standRod.castShadow = true
    standGroup.add(standRod)

    // Clamp on stand
    const clamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.08, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x5a6466,
        roughness: 0.4,
        metalness: 0.6,
      }),
    )
    clamp.position.set(-0.25, 2.7, -0.35)
    standGroup.add(clamp)

    // Precision Burette in clamp
    const buretteGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.0, 16),
      glassMaterial,
    )
    buretteGlass.position.set(0.12, 2.3, -0.35)
    standGroup.add(buretteGlass)

    // Burette liquid
    const buretteLiq = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 1.1, 16),
      naohLiquidMaterial,
    )
    buretteLiq.position.set(0.12, 2.0, -0.35)
    standGroup.add(buretteLiq)

    standGroup.position.set(1.4, 0, -0.8)
    scene.add(standGroup)

    // 9. Digital Laboratory Precision Balance (Right foreground)
    const scaleGroup = new THREE.Group()
    const scaleBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.24, 1.3),
      new THREE.MeshStandardMaterial({ color: 0xeff4f3, roughness: 0.3 }),
    )
    scaleBody.position.y = 0.12
    scaleBody.castShadow = true
    scaleBody.receiveShadow = true
    scaleGroup.add(scaleBody)

    const scalePan = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.48, 0.04, 32),
      new THREE.MeshStandardMaterial({
        color: 0xdde5e6,
        roughness: 0.15,
        metalness: 0.85,
      }),
    )
    scalePan.position.y = 0.26
    scaleGroup.add(scalePan)

    // Digital LCD readout
    const scaleCanvas = document.createElement("canvas")
    scaleCanvas.width = 256
    scaleCanvas.height = 96
    const sctx = scaleCanvas.getContext("2d")
    if (sctx) {
      sctx.fillStyle = "#1e2b2a"
      sctx.fillRect(0, 0, 256, 96)
      sctx.fillStyle = "#44d2b2"
      sctx.font = "bold 44px monospace"
      sctx.textAlign = "right"
      sctx.fillText("125.40 g", 236, 65)
    }
    const scaleTexture = new THREE.CanvasTexture(scaleCanvas)
    const scaleDisplay = new THREE.Mesh(
      new THREE.PlaneGeometry(0.65, 0.18),
      new THREE.MeshBasicMaterial({ map: scaleTexture }),
    )
    scaleDisplay.rotation.x = -Math.PI / 4
    scaleDisplay.position.set(0, 0.16, 0.6)
    scaleGroup.add(scaleDisplay)

    scaleGroup.position.set(2.8, 0, 1.2)
    scene.add(scaleGroup)

    // 10. REACTION BEAKER (TARGET VESSEL: 250mL Griffin Beaker)
    const beakerGroup = new THREE.Group()
    beakerGroup.position.set(0.6, 0, 0.2)

    // Beaker glass body
    const beakerGeo = new THREE.CylinderGeometry(0.62, 0.6, 1.35, 36, 1, true)
    const beakerMesh = new THREE.Mesh(beakerGeo, glassMaterial)
    beakerMesh.position.y = 0.68
    beakerMesh.castShadow = true
    beakerGroup.add(beakerMesh)

    // Beaker bottom
    const beakerBottom = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 36),
      glassMaterial,
    )
    beakerBottom.rotation.x = Math.PI / 2
    beakerBottom.position.y = 0.02
    beakerGroup.add(beakerBottom)

    // Beaker rim torus
    const rimMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.025, 12, 36),
      glassMaterial,
    )
    rimMesh.rotation.x = Math.PI / 2
    rimMesh.position.y = 1.35
    beakerGroup.add(rimMesh)

    // Beaker measurement graduations (printed marks)
    const gradCanvas = document.createElement("canvas")
    gradCanvas.width = 256
    gradCanvas.height = 256
    const gctx = gradCanvas.getContext("2d")
    if (gctx) {
      gctx.clearRect(0, 0, 256, 256)
      gctx.strokeStyle = "rgba(255, 255, 255, 0.7)"
      gctx.lineWidth = 4
      gctx.fillStyle = "rgba(255, 255, 255, 0.75)"
      gctx.font = "bold 18px sans-serif"
      ;[
        { y: 60, text: "200 ml" },
        { y: 110, text: "150 ml" },
        { y: 160, text: "100 ml" },
        { y: 210, text: "50 ml" },
      ].forEach((m) => {
        gctx.beginPath()
        gctx.moveTo(30, m.y)
        gctx.lineTo(80, m.y)
        gctx.stroke()
        gctx.fillText(m.text, 90, m.y + 6)
      })
    }
    const gradTexture = new THREE.CanvasTexture(gradCanvas)
    const gradMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.625,
        0.605,
        1.25,
        36,
        1,
        true,
        -Math.PI / 3,
        (2 * Math.PI) / 3,
      ),
      new THREE.MeshBasicMaterial({
        map: gradTexture,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    )
    gradMesh.position.y = 0.68
    beakerGroup.add(gradMesh)

    // Beaker liquid (Acidic HCl with indicator)
    const beakerLiqGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.65, 32)
    const beakerLiquid = new THREE.Mesh(beakerLiqGeo, beakerLiquidMaterial)
    beakerLiquid.position.y = 0.34
    beakerGroup.add(beakerLiquid)

    // Target Pouring Alignment Halo on Beaker
    const haloGeo = new THREE.RingGeometry(0.68, 0.82, 36)
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x18a999,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    })
    const targetHalo = new THREE.Mesh(haloGeo, haloMat)
    targetHalo.rotation.x = Math.PI / 2
    targetHalo.position.y = 1.48
    beakerGroup.add(targetHalo)

    // Effervescent 3D Bubbles inside Beaker
    const bubbleCount = 45
    const bubbleGeo = new THREE.BufferGeometry()
    const bubblePositions = new Float32Array(bubbleCount * 3)
    const bubbleVelocities = new Float32Array(bubbleCount)
    for (let b = 0; b < bubbleCount; b++) {
      const r = Math.random() * 0.45
      const theta = Math.random() * Math.PI * 2
      bubblePositions[b * 3] = Math.cos(theta) * r
      bubblePositions[b * 3 + 1] = 0.1 + Math.random() * 0.55
      bubblePositions[b * 3 + 2] = Math.sin(theta) * r
      bubbleVelocities[b] = 0.008 + Math.random() * 0.016
    }
    bubbleGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(bubblePositions, 3),
    )
    const bubbleMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.045,
      transparent: true,
      opacity: 0.8,
    })
    const bubbleParticles = new THREE.Points(bubbleGeo, bubbleMat)
    bubbleParticles.visible = false
    beakerGroup.add(bubbleParticles)

    // Reaction Exothermic Vapor Particles
    const vaporCount = 35
    const vaporGeo = new THREE.BufferGeometry()
    const vaporPositions = new Float32Array(vaporCount * 3)
    for (let v = 0; v < vaporCount; v++) {
      vaporPositions[v * 3] = (Math.random() - 0.5) * 0.6
      vaporPositions[v * 3 + 1] = 1.4 + Math.random() * 0.8
      vaporPositions[v * 3 + 2] = (Math.random() - 0.5) * 0.6
    }
    vaporGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(vaporPositions, 3),
    )
    const vaporMat = new THREE.PointsMaterial({
      color: 0x93ded7,
      size: 0.12,
      transparent: true,
      opacity: 0.35,
    })
    const vaporParticles = new THREE.Points(vaporGeo, vaporMat)
    vaporParticles.visible = false
    beakerGroup.add(vaporParticles)

    scene.add(beakerGroup)

    // 11. ERLENMEYER FLASK (ACTIVE OBJECT: 0.1M NaOH Reagent Flask)
    const flaskGroup = new THREE.Group()
    flaskGroup.position.set(-0.95, 0, 0.9)

    // Flask body lathe geometry (authentic Erlenmeyer profile)
    const flaskPoints: THREE.Vector2[] = [
      new THREE.Vector2(0.68, 0.0),
      new THREE.Vector2(0.68, 0.1),
      new THREE.Vector2(0.24, 1.15), // conical transition
      new THREE.Vector2(0.22, 1.7), // cylindrical neck
      new THREE.Vector2(0.26, 1.8), // flared lip rim
    ]
    const flaskGeo = new THREE.LatheGeometry(flaskPoints, 36)
    const flaskMesh = new THREE.Mesh(flaskGeo, glassMaterial)
    flaskMesh.castShadow = true
    flaskGroup.add(flaskMesh)

    // Flask Bottom disc
    const flaskBotMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.68, 36),
      glassMaterial,
    )
    flaskBotMesh.rotation.x = Math.PI / 2
    flaskBotMesh.position.y = 0.01
    flaskGroup.add(flaskBotMesh)

    // Flask Reagent Label
    const flaskLblCanvas = document.createElement("canvas")
    flaskLblCanvas.width = 256
    flaskLblCanvas.height = 128
    const flctx = flaskLblCanvas.getContext("2d")
    if (flctx) {
      flctx.fillStyle = "#f8f6ea"
      flctx.fillRect(0, 0, 256, 128)
      flctx.strokeStyle = "#22554d"
      flctx.lineWidth = 4
      flctx.strokeRect(8, 8, 240, 112)
      flctx.fillStyle = "#173f3b"
      flctx.font = "bold 36px sans-serif"
      flctx.textAlign = "center"
      flctx.fillText("NaOH", 128, 55)
      flctx.font = "500 18px sans-serif"
      flctx.fillText("0.1 M Reagent Solution", 128, 88)
    }
    const flaskLblTexture = new THREE.CanvasTexture(flaskLblCanvas)
    const flaskLabelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.24),
      new THREE.MeshBasicMaterial({ map: flaskLblTexture, transparent: true }),
    )
    flaskLabelMesh.position.set(0, 0.45, 0.52)
    flaskLabelMesh.rotation.x = -0.32
    flaskGroup.add(flaskLabelMesh)

    // Flask Liquid (0.1M Sodium Hydroxide)
    const flaskLiqPoints: THREE.Vector2[] = [
      new THREE.Vector2(0.01, 0.02),
      new THREE.Vector2(0.65, 0.02),
      new THREE.Vector2(0.48, 0.65),
      new THREE.Vector2(0.01, 0.65),
    ]
    const flaskLiqGeo = new THREE.LatheGeometry(flaskLiqPoints, 32)
    const flaskLiquid = new THREE.Mesh(flaskLiqGeo, naohLiquidMaterial)
    flaskGroup.add(flaskLiquid)

    scene.add(flaskGroup)

    // 12. 3D Pouring Stream Cylinder (Active during reaction)
    const pourGeo = new THREE.CylinderGeometry(0.045, 0.065, 1.4, 16)
    const pourMat = new THREE.MeshPhysicalMaterial({
      color: 0x30baa8,
      transmission: 0.9,
      transparent: true,
      opacity: 0.85,
      roughness: 0.05,
    })
    const pourStream = new THREE.Mesh(pourGeo, pourMat)
    pourStream.visible = false
    scene.add(pourStream)

    // 13. Dynamic 3D Alignment Guide Line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ])
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x1db39f,
      dashSize: 0.1,
      gapSize: 0.06,
      linewidth: 2,
    })
    const alignmentGuide = new THREE.Line(lineGeo, lineMat)
    alignmentGuide.visible = false
    scene.add(alignmentGuide)

    // 14. 3D Hand Tracking Reticle & Depth Rings
    const handCursorGroup = new THREE.Group()
    const cursorCenter = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x19a89c }),
    )
    const cursorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.22, 24),
      new THREE.MeshBasicMaterial({
        color: 0x1fb5a8,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    )
    const pinchSphere1 = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x37cbbd }),
    )
    pinchSphere1.position.x = -0.22
    const pinchSphere2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x37cbbd }),
    )
    pinchSphere2.position.x = 0.22
    handCursorGroup.add(cursorCenter, cursorRing, pinchSphere1, pinchSphere2)
    handCursorGroup.position.set(0, 2, 2)
    scene.add(handCursorGroup)

    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      flaskGroup,
      flaskLiquid,
      beakerLiquid,
      beakerLiquidMaterial,
      pourStream,
      bubbleParticles,
      vaporParticles,
      handCursorGroup,
      targetHalo,
      alignmentGuide,
      scaleTextCanvas: scaleCanvas,
      scaleTextTexture: scaleTexture,
    }

    // Animation Loop
    let animationFrameId: number
    let clock = new THREE.Clock()

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)
      const delta = clock.getDelta()
      const elapsed = clock.getElapsedTime()
      const currentState = stateRef.current
      const currentHand = handPosRef.current
      const pinching = isPinchingRef.current

      controls.update()

      // Update 3D Hand Reticle position based on tracking input
      const targetHandX = currentHand.x * 3.2
      const targetHandY = 1.0 + (currentHand.y + 1) * 1.5
      const targetHandZ = currentHand.z * 2.5

      handCursorGroup.position.lerp(
        new THREE.Vector3(targetHandX, targetHandY, targetHandZ),
        0.18,
      )
      cursorRing.rotation.z += 0.02

      // Animate pinch gesture on reticle
      if (pinching) {
        pinchSphere1.position.x = THREE.MathUtils.lerp(
          pinchSphere1.position.x,
          -0.06,
          0.25,
        )
        pinchSphere2.position.x = THREE.MathUtils.lerp(
          pinchSphere2.position.x,
          0.06,
          0.25,
        )
        cursorRing.scale.setScalar(0.7)
      } else {
        pinchSphere1.position.x = THREE.MathUtils.lerp(
          pinchSphere1.position.x,
          -0.22,
          0.15,
        )
        pinchSphere2.position.x = THREE.MathUtils.lerp(
          pinchSphere2.position.x,
          0.22,
          0.15,
        )
        cursorRing.scale.setScalar(1.0)
      }

      // Interaction State Handling
      const beakerPos = beakerGroup.position

      if (currentState === "held") {
        // Flask follows hand position with smooth physics damping and lifted height
        const flaskTargetX = handCursorGroup.position.x
        const flaskTargetY = Math.max(handCursorGroup.position.y - 0.4, 0.8)
        const flaskTargetZ = handCursorGroup.position.z

        flaskGroup.position.lerp(
          new THREE.Vector3(flaskTargetX, flaskTargetY, flaskTargetZ),
          0.15,
        )
        flaskGroup.rotation.z = THREE.MathUtils.lerp(
          flaskGroup.rotation.z,
          0.12,
          0.1,
        )
        flaskGroup.rotation.x = THREE.MathUtils.lerp(
          flaskGroup.rotation.x,
          -0.05,
          0.1,
        )

        // Check proximity to Beaker mouth for alignment
        const distToBeaker = Math.hypot(
          flaskGroup.position.x - beakerPos.x,
          flaskGroup.position.z - beakerPos.z,
        )

        targetHalo.visible = true
        alignmentGuide.visible = true

        // Update alignment guide line
        const linePositions = alignmentGuide.geometry.attributes.position
          .array as Float32Array
        linePositions[0] = flaskGroup.position.x
        linePositions[1] = flaskGroup.position.y
        linePositions[2] = flaskGroup.position.z
        linePositions[3] = beakerPos.x
        linePositions[4] = beakerPos.y + 1.4
        linePositions[5] = beakerPos.z
        alignmentGuide.geometry.attributes.position.needsUpdate = true

        if (distToBeaker < 1.1 && flaskGroup.position.y > 1.3) {
          targetHalo.material.color.setHex(0x28c292) // Green for correct alignment
          targetHalo.scale.setScalar(1.0 + Math.sin(elapsed * 6) * 0.08)
        } else {
          targetHalo.material.color.setHex(0x19a89c)
          targetHalo.scale.setScalar(1.0)
        }
      } else if (currentState === "correct-placement") {
        // Placed directly over the beaker mouth ready to pour
        flaskGroup.position.lerp(
          new THREE.Vector3(
            beakerPos.x - 0.65,
            beakerPos.y + 1.85,
            beakerPos.z + 0.1,
          ),
          0.12,
        )
        flaskGroup.rotation.z = THREE.MathUtils.lerp(
          flaskGroup.rotation.z,
          0.45,
          0.1,
        )
        targetHalo.visible = true
        targetHalo.material.color.setHex(0x28c292)
        alignmentGuide.visible = false
      } else if (currentState === "invalid-placement") {
        // Off target warning
        flaskGroup.position.lerp(new THREE.Vector3(-2.0, 1.2, 1.2), 0.12)
        flaskGroup.rotation.z = THREE.MathUtils.lerp(
          flaskGroup.rotation.z,
          -0.2,
          0.1,
        )
        targetHalo.visible = true
        targetHalo.material.color.setHex(0xd47758) // Warning amber
        alignmentGuide.visible = true
      } else if (currentState === "reaction") {
        // Tilted pouring position over beaker
        flaskGroup.position.lerp(
          new THREE.Vector3(
            beakerPos.x - 0.58,
            beakerPos.y + 1.75,
            beakerPos.z,
          ),
          0.1,
        )
        flaskGroup.rotation.z = THREE.MathUtils.lerp(
          flaskGroup.rotation.z,
          1.15,
          0.08,
        ) // Poured angle
        flaskGroup.rotation.x = THREE.MathUtils.lerp(
          flaskGroup.rotation.x,
          -0.2,
          0.08,
        )

        // Activate pouring stream
        pourStream.visible = true
        pourStream.position.set(
          beakerPos.x - 0.12,
          beakerPos.y + 0.95,
          beakerPos.z,
        )
        pourStream.rotation.z = -0.15
        pourStream.scale.set(
          1.0 + Math.sin(elapsed * 25) * 0.12,
          1.0,
          1.0 + Math.cos(elapsed * 25) * 0.12,
        )

        // Dynamic liquid level in beaker rises
        beakerLiquid.scale.y = Math.min(
          beakerLiquid.scale.y + delta * 0.12,
          1.45,
        )
        beakerLiquid.position.y = 0.34 * beakerLiquid.scale.y

        // Smooth color transition of indicator during neutralization (Magenta -> Turquoise)
        beakerLiquidMaterial.color.lerp(new THREE.Color(0x19a89c), 0.02)

        // Activate bubbles and vapor
        bubbleParticles.visible = true
        vaporParticles.visible = true

        // Update bubble particles upward motion
        const bPos = bubbleParticles.geometry.attributes.position
          .array as Float32Array
        for (let b = 0; b < bubbleCount; b++) {
          bPos[b * 3 + 1] += bubbleVelocities[b]
          if (bPos[b * 3 + 1] > 0.85) {
            bPos[b * 3 + 1] = 0.08
          }
        }
        bubbleParticles.geometry.attributes.position.needsUpdate = true

        // Update vapor particles
        const vPos = vaporParticles.geometry.attributes.position
          .array as Float32Array
        for (let v = 0; v < vaporCount; v++) {
          vPos[v * 3 + 1] += delta * 0.5
          vPos[v * 3] += Math.sin(elapsed * 2 + v) * 0.003
          if (vPos[v * 3 + 1] > 2.6) {
            vPos[v * 3 + 1] = 1.35
            vPos[v * 3] = (Math.random() - 0.5) * 0.5
          }
        }
        vaporParticles.geometry.attributes.position.needsUpdate = true

        targetHalo.visible = false
        alignmentGuide.visible = false
      } else if (currentState === "complete") {
        // Return flask safely to rest position or upright position
        flaskGroup.position.lerp(new THREE.Vector3(-0.95, 0, 0.9), 0.08)
        flaskGroup.rotation.z = THREE.MathUtils.lerp(
          flaskGroup.rotation.z,
          0,
          0.08,
        )
        flaskGroup.rotation.x = THREE.MathUtils.lerp(
          flaskGroup.rotation.x,
          0,
          0.08,
        )
        pourStream.visible = false
        targetHalo.visible = false
        alignmentGuide.visible = false
        bubbleParticles.visible = true // Gentle steady bubbles
        vaporParticles.visible = false
        beakerLiquidMaterial.color.setHex(0x18aa9c) // Vibrant neutralized indicator endpoint
      } else {
        // Ready state - flask rests securely on the workbench
        flaskGroup.position.lerp(new THREE.Vector3(-0.95, 0, 0.9), 0.1)
        flaskGroup.rotation.z = THREE.MathUtils.lerp(
          flaskGroup.rotation.z,
          0,
          0.1,
        )
        flaskGroup.rotation.x = THREE.MathUtils.lerp(
          flaskGroup.rotation.x,
          0,
          0.1,
        )
        pourStream.visible = false
        targetHalo.visible = false
        alignmentGuide.visible = false
        bubbleParticles.visible = false
        vaporParticles.visible = false
        beakerLiquidMaterial.color.setHex(0xdf84a5)
      }

      renderer.render(scene, camera)
    }

    animate()

    // Resize listener
    const handleResize = () => {
      if (!container) return
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      cancelAnimationFrame(animationFrameId)
      renderer.dispose()
      container.innerHTML = ""
    }
  }, [])

  // Handle Camera View Preset switching
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return
    const { camera, controls } = ctx

    if (viewPreset === "perspective") {
      camera.position.set(0, 4.2, 7.8)
      controls.target.set(0, 1.4, 0)
    } else if (viewPreset === "top") {
      camera.position.set(0, 8.5, 1.2)
      controls.target.set(0, 0.5, 0)
    } else if (viewPreset === "side") {
      camera.position.set(-7.5, 2.5, 0.5)
      controls.target.set(0, 1.2, 0)
    } else if (viewPreset === "closeup") {
      camera.position.set(0.3, 2.0, 3.2)
      controls.target.set(0.3, 1.1, 0.3)
    }
    controls.update()
  }, [viewPreset])

  // Mouse / Touch interaction for direct 3D manipulation
  const handlePointerDown = () => {
    // If ready, click triggers flask grabbing
    if (stateRef.current === "ready" || stateRef.current === "hand-detected") {
      onStateChange("held")
    } else if (stateRef.current === "held") {
      onStateChange("correct-placement")
    } else if (stateRef.current === "correct-placement") {
      onStateChange("reaction")
    }
  }

  return (
    <div
      className="relative w-full h-full select-none cursor-grab active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      ref={containerRef}
      style={{ width: "100%", height: "100%" }}
    />
  )
}
