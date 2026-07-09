import * as THREE from 'https://esm.sh/three@0.169.0'
import * as CANNON from 'https://esm.sh/cannon-es@0.20.0'
import { RoundedBoxGeometry } from 'https://esm.sh/three@0.169.0/examples/jsm/geometries/RoundedBoxGeometry.js'
import { fetchAllCmsData, esc } from '../../shared/cms.js'
import { createSoundEngine } from './sfx.js'
import { buildWorld } from './world.js'
import { buildLoopMap } from './world-loop.js'

// ─── Active map resolution: ?map= → localStorage → 'classic' (default) ───
function resolveActiveMap() {
  const q = new URLSearchParams(location.search).get('map')
  if (q === 'classic' || q === 'loop') return q
  const stored = localStorage.getItem('bruno-map')
  if (stored === 'classic' || stored === 'loop') return stored
  return 'classic'
}
const activeMap = resolveActiveMap()

// ─── DOM refs ───
const canvas = document.getElementById('webgl')
const loadingEl = document.getElementById('loading')
const loadingBar = document.getElementById('loading-bar')
const controlsHint = document.getElementById('controls-hint')
const zoneToast = document.getElementById('zone-toast')
const infoPanel = document.getElementById('info-panel')
const infoContent = document.getElementById('info-content')
const infoClose = document.getElementById('info-close')
const minimapCanvas = document.getElementById('minimap')
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null
// New HUD refs
const collectibleCounter = document.getElementById('collectible-counter')
const speedoValue = document.getElementById('speedo-value')
const speedoArc = document.getElementById('speedo-arc')
const compassEl = document.getElementById('compass')
const speedFx = document.getElementById('speed-fx')
const muteBtn = document.getElementById('mute-btn')
const cameraBtn = document.getElementById('camera-btn')
const cameraLabel = document.getElementById('camera-label')
const mapBtn = document.getElementById('map-btn')
const mapLabel = document.getElementById('map-label')
const introPrompt = document.getElementById('intro-prompt')
const timeBadge = document.getElementById('time-badge')

// ─── Renderer & Scene ───
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87ceeb)
scene.fog = new THREE.Fog(0x87ceeb, 60, 200)

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 800)
camera.position.set(0, 12, 20)

// ─── Lighting (refs kept so day/night can modulate them) ───
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
scene.add(ambientLight)

const sun = new THREE.DirectionalLight(0xfff4d6, 1.4)
sun.position.set(40, 60, 30)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 1
sun.shadow.camera.far = 400
sun.shadow.camera.left = -120
sun.shadow.camera.right = 120
sun.shadow.camera.top = 120
sun.shadow.camera.bottom = -120
sun.shadow.bias = -0.001
scene.add(sun)

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.5)
scene.add(hemiLight)

// ─── Physics ───
const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) })
physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld)
physicsWorld.allowSleep = true

const groundMat = new CANNON.Material('ground')
const vehicleMat = new CANNON.Material('vehicle')
const propMat = new CANNON.Material('prop')
physicsWorld.addContactMaterial(new CANNON.ContactMaterial(groundMat, vehicleMat, { friction: 0.6, restitution: 0.1 }))
physicsWorld.addContactMaterial(new CANNON.ContactMaterial(propMat, groundMat, { friction: 0.4, restitution: 0.3 }))
physicsWorld.addContactMaterial(new CANNON.ContactMaterial(propMat, vehicleMat, { friction: 0.3, restitution: 0.4 }))

// ─── Ground (flat physics plane; the visual mesh is built in world.js) ───
const groundBody = new CANNON.Body({ mass: 0, material: groundMat })
groundBody.addShape(new CANNON.Plane())
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
groundBody.isGround = true
physicsWorld.addBody(groundBody)

// ─── Bounded play area (200×200, edges at ±100) ───
const BOUND = 100

const wallDefs = [
  { pos: [0, 0, -BOUND], rot: [0, 0, 0] },           // far  (−Z), normal +Z
  { pos: [0, 0, BOUND], rot: [0, Math.PI, 0] },      // near (+Z), normal −Z
  { pos: [-BOUND, 0, 0], rot: [0, Math.PI / 2, 0] }, // left (−X), normal +X
  { pos: [BOUND, 0, 0], rot: [0, -Math.PI / 2, 0] }, // right(+X), normal −X
]
wallDefs.forEach(({ pos, rot }) => {
  const b = new CANNON.Body({ mass: 0, material: groundMat })
  b.addShape(new CANNON.Plane())
  b.position.set(pos[0], 0, pos[2])
  b.quaternion.setFromEuler(rot[0], rot[1], rot[2])
  b.isWall = true
  physicsWorld.addBody(b)
})

// Visual: low border wall along each edge
const borderMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4b })
const borderGeo = new THREE.BoxGeometry(202, 2, 1)
;[
  { pos: [0, 1, -BOUND], rotY: 0 },
  { pos: [0, 1, BOUND], rotY: 0 },
  { pos: [-BOUND, 1, 0], rotY: Math.PI / 2 },
  { pos: [BOUND, 1, 0], rotY: Math.PI / 2 },
].forEach(({ pos, rotY }) => {
  const m = new THREE.Mesh(borderGeo, borderMat)
  m.position.set(pos[0], pos[1], pos[2])
  m.rotation.y = rotY
  m.receiveShadow = true
  m.castShadow = true
  scene.add(m)
})

// ─── Zones definition ───
// ZONES is assigned from the active map by buildActiveMap() below, so every
// downstream consumer (proximity → panel, minimap, nearRoad) follows the choice.
const ZONE_RADIUS = 18
let ZONES = []
const CLASSIC_ZONES = [
  { id: 'home',     label: 'Home',     pos: new THREE.Vector3(0, 0, 0),    color: 0x6366f1 },
  { id: 'projects', label: 'Projects', pos: new THREE.Vector3(0, 0, -50),  color: 0xf59e0b },
  { id: 'timeline', label: 'Timeline', pos: new THREE.Vector3(50, 0, 0),   color: 0x10b981 },
  { id: 'skills',   label: 'Skills',   pos: new THREE.Vector3(0, 0, 50),   color: 0xec4899 },
  { id: 'contact',  label: 'Contact',  pos: new THREE.Vector3(-50, 0, 0),  color: 0xf97316 },
]

// ─── Placement helpers (shared with world.js via ctx) ───
// Independent seeded RNGs so each prop category places reproducibly and doesn't
// disturb the others (the old code shared one LCG across trees + rocks).
function makeRng(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az
  const l2 = dx * dx + dz * dz
  if (l2 === 0) return Math.hypot(px - ax, pz - az)
  let t = ((px - ax) * dx + (pz - az) * dz) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

// True if (x,z) is too near a zone or one of the home→zone roads.
function blockedSpot(x, z, clearance = 14) {
  if (ZONES.some(zz => Math.hypot(x - zz.pos.x, z - zz.pos.z) < clearance)) return true
  return ZONES.slice(1).some(zz => distToSegment(x, z, 0, 0, zz.pos.x, zz.pos.z) < 4.5)
}

// Static colliders (trees, rocks, houses, lamps, banks, ramps, bridge…).
const obstacleBodies = []
function addSolid(shape, x, y, z, opts = {}) {
  const b = new CANNON.Body({ mass: 0, material: opts.material || groundMat })
  b.addShape(shape)
  b.position.set(x, y, z)
  if (opts.rot) b.quaternion.setFromEuler(opts.rot[0], opts.rot[1], opts.rot[2])
  if (opts.tag) b[opts.tag] = true
  physicsWorld.addBody(b)
  obstacleBodies.push(b)
  return b
}

// ─── Road strips between zones ───
function addRoad(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from)
  const len = dir.length()
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.05, len),
    new THREE.MeshLambertMaterial({ color: 0xcbb079 })
  )
  mesh.position.set(mid.x, 0.03, mid.z)
  mesh.rotation.y = Math.atan2(dir.x, dir.z)
  mesh.receiveShadow = true
  scene.add(mesh)
}

// Sign / banner texture — shared by classic zone signs and the loop map arches.
function makeSignTexture(text, color) {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 64
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
  ctx.fillRect(0, 0, 256, 64)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 26px Space Grotesk, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 32)
  return new THREE.CanvasTexture(c)
}

// ─── Build the selected map ───
// Both branches return the same `world` handle shape (tick / setTimeOfDay /
// onTrack / collectibles / boostPads / …) so the shared loop needs no map logic.
function buildActiveMap() {
  if (activeMap === 'loop') {
    const { zones, world } = buildLoopMap(scene, {
      physicsWorld, groundMat, vehicleMat, propMat,
      ZONE_RADIUS, BOUND,
      makeRng, addSolid, distToSegment, makeSignTexture,
    })
    ZONES = zones
    return world
  }

  // ── classic hub-and-spoke map (default; byte-for-byte with the old inline) ──
  ZONES = CLASSIC_ZONES
  const home = ZONES[0].pos
  ZONES.slice(1).forEach(z => addRoad(home, z.pos))

  // Zone platforms
  ZONES.forEach(zone => {
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.6, 20),
      new THREE.MeshLambertMaterial({ color: zone.color })
    )
    platform.position.set(zone.pos.x, 0.3, zone.pos.z)
    platform.receiveShadow = true
    platform.castShadow = true
    scene.add(platform)

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 4),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    )
    pole.position.set(zone.pos.x, 2.3, zone.pos.z - 8)
    pole.castShadow = true
    scene.add(pole)

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.5),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(zone.label, zone.color), transparent: false })
    )
    sign.position.set(zone.pos.x, 4.5, zone.pos.z - 8)
    scene.add(sign)
  })

  return buildWorld(scene, {
    physicsWorld, groundMat, vehicleMat, propMat,
    ZONES, ZONE_RADIUS, BOUND,
    makeRng, blockedSpot, addSolid, distToSegment,
  })
}

const world = buildActiveMap()
const collectedTotal = world.collectibles.length
let collectedCount = 0

// ─── Sound engine ───
const sfx = createSoundEngine()

// ─── Vehicle body (visual) ───
const vehicleGroup = new THREE.Group()

const bodyMesh = new THREE.Mesh(
  new RoundedBoxGeometry(2.4, 0.8, 4, 4, 0.18),
  new THREE.MeshLambertMaterial({ color: 0xe8503a })
)
bodyMesh.castShadow = true
vehicleGroup.add(bodyMesh)

const cabinMesh = new THREE.Mesh(
  new RoundedBoxGeometry(2.0, 0.7, 2.2, 4, 0.14),
  new THREE.MeshLambertMaterial({ color: 0xd03e2a })
)
cabinMesh.position.set(0, 0.75, 0.4)
cabinMesh.castShadow = true
vehicleGroup.add(cabinMesh)

const glassMat = new THREE.MeshLambertMaterial({ color: 0xbfe3f2, transparent: true, opacity: 0.7 })
const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.6), glassMat)
windshield.position.set(0, 0.75, -0.7)
windshield.rotation.x = 0.25
vehicleGroup.add(windshield)

const rearWindow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.55), glassMat)
rearWindow.position.set(0, 0.78, 1.5)
rearWindow.rotation.x = Math.PI - 0.3
vehicleGroup.add(rearWindow)

// Headlights — brighten at night (refs kept for day/night).
const headlightMat = new THREE.MeshLambertMaterial({ color: 0xfff6d5, emissive: 0xfff0b0, emissiveIntensity: 0.9 })
const headlightGeo = new RoundedBoxGeometry(0.4, 0.28, 0.18, 3, 0.06)
;[-0.75, 0.75].forEach(x => {
  const h = new THREE.Mesh(headlightGeo, headlightMat)
  h.position.set(x, 0.05, -1.95)
  vehicleGroup.add(h)
})

// Headlight spotlights (revealed at night).
const headSpot = new THREE.SpotLight(0xfff0c0, 0, 40, Math.PI / 6, 0.4, 1.5)
headSpot.position.set(0, 0.6, -2)
const headSpotTarget = new THREE.Object3D()
headSpotTarget.position.set(0, 0, -12)
vehicleGroup.add(headSpot)
vehicleGroup.add(headSpotTarget)
headSpot.target = headSpotTarget

const taillightMat = new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0xd01b12, emissiveIntensity: 0.9 })
const taillightGeo = new THREE.BoxGeometry(0.45, 0.22, 0.14)
;[-0.8, 0.8].forEach(x => {
  const t = new THREE.Mesh(taillightGeo, taillightMat)
  t.position.set(x, 0.08, 1.98)
  vehicleGroup.add(t)
})

const bumperMat = new THREE.MeshLambertMaterial({ color: 0x2b2e33 })
const bumperGeo = new RoundedBoxGeometry(2.3, 0.28, 0.35, 3, 0.08)
;[-1.9, 1.9].forEach(z => {
  const b = new THREE.Mesh(bumperGeo, bumperMat)
  b.position.set(0, -0.2, z)
  b.castShadow = true
  vehicleGroup.add(b)
})

const mirrorMat = new THREE.MeshLambertMaterial({ color: 0xd03e2a })
;[-1.05, 1.05].forEach(x => {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.06), mirrorMat)
  post.position.set(x, 0.9, -0.4)
  vehicleGroup.add(post)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.14), new THREE.MeshLambertMaterial({ color: 0x1c1f24 }))
  glass.position.set(x + (x > 0 ? 0.14 : -0.14), 0.9, -0.4)
  vehicleGroup.add(glass)
})

scene.add(vehicleGroup)

// Wheels
const wheelPositions = [[-1.3, 0, -1.3], [1.3, 0, -1.3], [-1.3, 0, 1.3], [1.3, 0, 1.3]]

const tireGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.36, 18)
tireGeo.rotateZ(Math.PI / 2)
const tireMat = new THREE.MeshLambertMaterial({ color: 0x141414 })

const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.4, 12)
hubGeo.rotateZ(Math.PI / 2)
const hubMat = new THREE.MeshLambertMaterial({ color: 0xc7ccd1 })

const boltGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.44, 6)
boltGeo.rotateZ(Math.PI / 2)
const boltMat = new THREE.MeshLambertMaterial({ color: 0x6b7078 })

function makeWheel() {
  const g = new THREE.Group()
  const tire = new THREE.Mesh(tireGeo, tireMat)
  tire.castShadow = true
  g.add(tire)
  g.add(new THREE.Mesh(hubGeo, hubMat))
  g.add(new THREE.Mesh(boltGeo, boltMat))
  scene.add(g)
  return g
}
const wheelMeshes = wheelPositions.map(() => makeWheel())

// ─── Physics: RaycastVehicle ───
const chassisBody = new CANNON.Body({ mass: 150, material: vehicleMat })
chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(1.2, 0.4, 2.0)))
const SPAWN = new CANNON.Vec3(0, 4, 0)
chassisBody.position.copy(SPAWN)
chassisBody.angularVelocity.set(0, 0, 0)

const vehicle = new CANNON.RaycastVehicle({
  chassisBody,
  indexRightAxis: 0,
  indexUpAxis: 1,
  indexForwardAxis: 2,
})

const wheelOptions = {
  radius: 0.45,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  suspensionStiffness: 30,
  suspensionRestLength: 0.4,
  frictionSlip: 3.0,
  dampingRelaxation: 2.3,
  dampingCompression: 4.4,
  maxSuspensionForce: 1e5,
  rollInfluence: 0.01,
  axleLocal: new CANNON.Vec3(-1, 0, 0),
  maxSuspensionTravel: 0.3,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
}

wheelPositions.forEach(([wx, wy, wz]) => {
  wheelOptions.chassisConnectionPointLocal = new CANNON.Vec3(wx, wy, wz)
  vehicle.addWheel(wheelOptions)
})
vehicle.addToWorld(physicsWorld)

// ─── Collision → thud / clatter / shake ───
let lastThud = 0
chassisBody.addEventListener('collide', e => {
  const other = e.body
  if (!other || other.isGround) return
  const v = Math.abs(e.contact ? e.contact.getImpactVelocityAlongNormal() : 0)
  if (v < 3) return
  if (other.isProp) { sfx.clatter(); addShake(Math.min(0.25, v / 40)); return }
  const t = performance.now()
  if (t - lastThud < 120) return
  lastThud = t
  sfx.thud(Math.min(1, v / 25))
  if (other.isBank) sfx.splash()
  addShake(Math.min(0.7, v / 25))
})

// ─── Input ───
const keys = { forward: false, backward: false, left: false, right: false, boost: false, handbrake: false }

window.addEventListener('keydown', e => {
  if (introActive && e.key !== 'F5' && !e.metaKey && !e.ctrlKey) endIntro()
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp')    { keys.forward   = true; e.preventDefault() }
  if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown')  { keys.backward  = true; e.preventDefault() }
  if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft')  { keys.left      = true; e.preventDefault() }
  if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') { keys.right     = true; e.preventDefault() }
  if (e.key === 'Shift') keys.boost = true
  if (e.key === ' ')     { keys.handbrake = true; e.preventDefault() }
  if (e.key === 'r' || e.key === 'R') resetVehicle()
  if (e.key === 'f' || e.key === 'F') resetToCenter()
  if (e.key === 'c' || e.key === 'C') cycleCamera()
  if (e.key === 'h' || e.key === 'H') { sfx.horn() }
  if (e.key === 'n' || e.key === 'N') cycleDayMode()
  if (e.key === 'm' || e.key === 'M') toggleMute()
})
window.addEventListener('keyup', e => {
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp')    keys.forward   = false
  if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown')  keys.backward  = false
  if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft')  keys.left      = false
  if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') keys.right     = false
  if (e.key === 'Shift') keys.boost = false
  if (e.key === ' ')     keys.handbrake = false
})

// End the intro / unlock audio on any pointer gesture too.
window.addEventListener('pointerdown', () => { if (introActive) endIntro() })

// Touch joystick (throttle/steer only, per plan)
let touchStart = null
window.addEventListener('touchstart', e => {
  const t = e.touches[0]
  touchStart = { x: t.clientX, y: t.clientY }
}, { passive: true })
window.addEventListener('touchmove', e => {
  if (!touchStart) return
  const t = e.touches[0]
  const dx = t.clientX - touchStart.x
  const dy = t.clientY - touchStart.y
  const dead = 12
  keys.forward  = dy < -dead
  keys.backward = dy > dead
  keys.left     = dx < -dead
  keys.right    = dx > dead
}, { passive: true })
window.addEventListener('touchend', () => {
  touchStart = null
  keys.forward = keys.backward = keys.left = keys.right = false
})

// ─── Vehicle controls ───
const MAX_STEER = 0.55
const NORMAL_MAX_KMH = 55
const BOOST_MAX_KMH = 100
const REVERSE_MAX_KMH = 28
const ENGINE_FORCE = 1800
const BOOST_FORCE = 2000
const REVERSE_FORCE = 800
const IDLE_BRAKE = 6
const HANDBRAKE_FORCE = 60

let steering = 0
let boosting = false
let controlsEnabled = false   // released once the intro ends
const lastSafePos = new CANNON.Vec3(0, 4, 0)
const _upWorld = new CANNON.Vec3()

function updateVehicle(dt) {
  const active = controlsEnabled
  const speed = Math.abs(vehicle.currentVehicleSpeedKmHour || 0)

  // Speed-sensitive steer clamp: full lock when slow, ~0.6× at top speed, so the
  // extra grip stays responsive at low speed without getting twitchy fast.
  const speedFrac = Math.min(1, speed / BOOST_MAX_KMH)
  const steerLimit = MAX_STEER * (1 - 0.4 * speedFrac)
  const target = active ? (keys.left ? steerLimit : keys.right ? -steerLimit : 0) : 0
  steering += (target - steering) * Math.min(1, dt * 8)
  vehicle.setSteeringValue(steering, 0)
  vehicle.setSteeringValue(steering, 1)
  boosting = active && keys.boost && keys.forward
  let force = 0
  if (active && keys.forward) {
    const cap = boosting ? BOOST_MAX_KMH : NORMAL_MAX_KMH
    force = speed < cap ? (boosting ? BOOST_FORCE : ENGINE_FORCE) : 0
  } else if (active && keys.backward) {
    force = speed < REVERSE_MAX_KMH ? -REVERSE_FORCE : 0
  }
  vehicle.applyEngineForce(force, 2)
  vehicle.applyEngineForce(force, 3)

  const brake = force === 0 ? IDLE_BRAKE : 0
  for (let i = 0; i < 4; i++) vehicle.setBrake(brake, i)

  if (active && keys.handbrake) {
    vehicle.setBrake(HANDBRAKE_FORCE, 2)
    vehicle.setBrake(HANDBRAKE_FORCE, 3)
  }

  chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0), _upWorld)
  if (_upWorld.y > 0.6) lastSafePos.copy(chassisBody.position)

  // engine sound
  const reversing = active && keys.backward && !keys.forward
  sfx.setDrive(speed, boosting, reversing)
}

// R — flip / recover in place: keep XZ, right the car, lift it, zero motion.
function resetVehicle() {
  chassisBody.position.y = Math.max(chassisBody.position.y, 0.5) + 1.5
  chassisBody.quaternion.set(0, 0, 0, 1)
  chassisBody.velocity.set(0, 0, 0)
  chassisBody.angularVelocity.set(0, 0, 0)
  steering = 0
  sfx.resetBlip()
}

// F — reset back to world center (spawn).
function resetToCenter() {
  chassisBody.position.set(0, 4, 0)
  chassisBody.quaternion.set(0, 0, 0, 1)
  chassisBody.velocity.set(0, 0, 0)
  chassisBody.angularVelocity.set(0, 0, 0)
  steering = 0
  sfx.resetBlip()
}

// ─── Camera modes ───
const CAMERA_MODES = ['chase', 'hood', 'orbit']
let cameraMode = 'chase'
let orbitAngle = 0
let shake = 0
let padKick = 0
const camOffset = new THREE.Vector3(0, 9, 16)
const camTarget = new THREE.Vector3()
const _camQuat = new THREE.Quaternion()
const _desired = new THREE.Vector3()
const _tmpVec = new THREE.Vector3()

function cycleCamera() {
  const i = (CAMERA_MODES.indexOf(cameraMode) + 1) % CAMERA_MODES.length
  cameraMode = CAMERA_MODES[i]
  if (cameraLabel) cameraLabel.textContent = cameraMode
}

function addShake(a) { shake = Math.min(1, shake + a) }

function updateCamera(dt) {
  const vp = chassisBody.position
  _camQuat.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)

  if (cameraMode === 'orbit') {
    orbitAngle += dt * 0.4
    _desired.set(vp.x + Math.cos(orbitAngle) * 15, vp.y + 7, vp.z + Math.sin(orbitAngle) * 15)
    camera.position.lerp(_desired, 0.05)
    camTarget.set(vp.x, vp.y + 1, vp.z)
  } else if (cameraMode === 'hood') {
    const off = _tmpVec.set(0, 1.15, -1.3).applyQuaternion(_camQuat)
    camera.position.set(vp.x + off.x, vp.y + off.y, vp.z + off.z)
    const look = _tmpVec.set(0, 0.8, -10).applyQuaternion(_camQuat)
    camTarget.set(vp.x + look.x, vp.y + look.y, vp.z + look.z)
  } else {
    const offset = _tmpVec.copy(camOffset).applyQuaternion(_camQuat)
    _desired.set(vp.x + offset.x, vp.y + offset.y, vp.z + offset.z)
    camera.position.lerp(_desired, 0.08)
    camTarget.set(vp.x, vp.y + 1, vp.z)
  }

  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake
    camera.position.y += (Math.random() - 0.5) * shake
    camera.position.z += (Math.random() - 0.5) * shake
    shake *= Math.max(0, 1 - dt * 6)
  }

  camera.lookAt(camTarget)

  const targetFov = (cameraMode !== 'orbit' && (boosting || padKick > 0)) ? 64 : 55
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 0.12
    camera.updateProjectionMatrix()
  }
}

// ─── Day/night cycle ───
let dayT = 0.35              // start mid-morning
const DAY_SPEED = 1 / 120    // full cycle ~120s
let dayMode = 0              // 0 normal · 1 fast · 2 paused
const _sunDir = new THREE.Vector3()
const _dayColor = new THREE.Color(0xfff4d6)
const _duskColor = new THREE.Color(0xff9a4a)

function cycleDayMode() { dayMode = (dayMode + 1) % 3 }

function applyDay() {
  const phase = dayT * Math.PI * 2
  const sy = Math.sin(phase - Math.PI / 2)
  const sx = Math.cos(phase - Math.PI / 2)
  _sunDir.set(sx, sy, 0.35).normalize()
  const dayAmount = Math.max(0, Math.min(1, sy * 1.5 + 0.15))

  sun.position.set(_sunDir.x * 130, Math.max(8, _sunDir.y * 130), _sunDir.z * 130)
  sun.intensity = 0.05 + dayAmount * 1.35
  const horizon = 1 - Math.min(1, Math.abs(sy) * 2.2)
  sun.color.copy(_dayColor).lerp(_duskColor, horizon)
  ambientLight.intensity = 0.12 + dayAmount * 0.5
  hemiLight.intensity = 0.1 + dayAmount * 0.45

  const night = 1 - dayAmount
  headlightMat.emissiveIntensity = 0.4 + night * 1.4
  headSpot.intensity = night * 3

  if (timeBadge) {
    let icon, label, cls
    if (dayAmount > 0.6)      { icon = '☀️'; label = 'Day';   cls = 'day' }
    else if (dayAmount > 0.3) { icon = '🌇'; label = 'Dusk';  cls = 'dusk' }
    else                      { icon = '🌙'; label = 'Night'; cls = 'night' }
    if (timeBadge.dataset.phase !== cls) {        // only touch DOM on change
      timeBadge.dataset.phase = cls
      timeBadge.textContent = `${icon} ${label}`
      timeBadge.className = cls
    }
  }

  world.setTimeOfDay(dayT, _sunDir, dayAmount)
  sfx.setTimeOfDay(dayT)
}

function updateDayNight(dt) {
  if (dayMode !== 2) dayT = (dayT + dt * DAY_SPEED * (dayMode === 1 ? 8 : 1)) % 1
  applyDay()
}

// ─── Gameplay update (collectibles, boost pads, ramps/air, surface) ───
let speedFxBoost = 0
let airTime = 0
const _carPos = new THREE.Vector3()
const _impulse = new CANNON.Vec3()

function wheelsInContact() {
  let n = 0
  for (let i = 0; i < vehicle.wheelInfos.length; i++) if (vehicle.wheelInfos[i].isInContact) n++
  return n
}

function nearRoad(x, z) {
  // Classic map: home platform + spoke roads read as "road". The loop map has
  // no spokes — its ring is covered by world.onTrack below.
  if (activeMap === 'classic') {
    if (ZONES.some(zz => Math.hypot(x - zz.pos.x, z - zz.pos.z) < 10)) return true
    if (ZONES.slice(1).some(zz => distToSegment(x, z, 0, 0, zz.pos.x, zz.pos.z) < 2.6)) return true
  }
  return !!(world.onTrack && world.onTrack(x, z))
}

function updateGameplay(dt) {
  _carPos.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)

  // Collectibles — proximity pickup.
  for (const c of world.collectibles) {
    if (c.collected) continue
    if (_carPos.distanceTo(c.mesh.position) < 2.5) {
      c.collected = true
      c.mesh.visible = false
      collectedCount++
      sfx.pickup()
      spawnDust(c.mesh.position, 3)
      updateCounterHUD()
      if (collectedCount === collectedTotal && collectedTotal > 0) {
        sfx.fanfare()
        showToast('All ★ collected!')
      }
    }
  }

  // Boost pads.
  for (const p of world.boostPads) {
    if (p.cooldown > 0) continue
    if (_carPos.distanceTo(p.pos) < 3.2) {
      chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, -1), _impulse)
      _impulse.y = 0.12
      _impulse.scale(950, _impulse)
      chassisBody.applyImpulse(_impulse, chassisBody.position)
      p.cooldown = 1.5
      sfx.zap()
      padKick = 0.5
      speedFxBoost = 0.6
    }
  }

  // Ramp air detection + surface for tire sound.
  const onGround = wheelsInContact()
  if (onGround === 0) {
    airTime += dt
  } else {
    if (airTime > 0.25) {
      const vy = Math.abs(chassisBody.velocity.y)
      sfx.land(Math.min(1, vy / 12))
      addShake(Math.min(0.5, vy / 16))
    }
    airTime = 0
  }
  const surf = onGround === 0 ? 'air' : (nearRoad(_carPos.x, _carPos.z) ? 'road' : 'grass')
  sfx.setSurface(surf)

  if (padKick > 0) padKick = Math.max(0, padKick - dt)
  if (speedFxBoost > 0) speedFxBoost = Math.max(0, speedFxBoost - dt * 1.2)
}

// ─── Zone proximity ───
let activeZone = null
let toastTimer = null

function showToast(text) {
  clearTimeout(toastTimer)
  zoneToast.textContent = text
  zoneToast.classList.add('show')
  toastTimer = setTimeout(() => zoneToast.classList.remove('show'), 3000)
}

function enterZone(zone) {
  if (activeZone === zone.id) return
  activeZone = zone.id
  showToast(zone.label)
  sfx.chime(zone.color)
  if (cmsData) renderPanel(zone.id)
  infoPanel.classList.add('visible')
}

function exitZone() {
  if (!activeZone) return
  activeZone = null
  infoPanel.classList.remove('visible')
}

function checkZoneProximity() {
  const vp = _tmpVec.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
  let inAny = false
  for (const zone of ZONES) {
    if (vp.distanceTo(zone.pos) < ZONE_RADIUS) {
      inAny = true
      enterZone(zone)
      break
    }
  }
  if (!inAny && activeZone) exitZone()
}

infoClose.addEventListener('click', () => {
  infoPanel.classList.remove('visible')
  activeZone = null
})

// ─── CMS Data ───
let cmsData = null

function setProgress(v) { loadingBar.value = v }

setProgress(10)
fetchAllCmsData()
  .then(data => { cmsData = data; finishLoading() })
  .catch(() => { cmsData = {}; finishLoading() })

function finishLoading() {
  // Paint the loop map's in-world content boards now that CMS data has arrived
  // (the world was built synchronously before the fetch resolved).
  if (world.setContent) world.setContent(cmsData)
  setProgress(100)
  setTimeout(() => loadingEl.classList.add('hidden'), 400)
  setTimeout(() => controlsHint.classList.add('faded'), 6000)
  startIntro()
}

// ─── Panel renderers ───
function renderPanel(zoneId) {
  const d = cmsData || {}
  switch (zoneId) {
    case 'home':       infoContent.innerHTML = renderHome(d.profile);              break
    case 'about':      infoContent.innerHTML = renderAbout(d.profile, d.resume);   break
    case 'projects':   infoContent.innerHTML = renderProjects(d.projects);         break
    case 'timeline':   infoContent.innerHTML = renderTimeline(d.resume);           break
    case 'highlights': infoContent.innerHTML = renderHighlights(d.highlights);     break
    case 'skills':     infoContent.innerHTML = renderSkills(d.resume);             break
    case 'uses':       infoContent.innerHTML = renderUses(d.uses);                 break
    case 'contact':    infoContent.innerHTML = renderContact(d.social);            break
  }
}

// Loop-map sections (About extends Home with the résumé summary).
function renderAbout(profile, resume) {
  const p = profile || {}
  const avail = p.availability
  const isOpen = /open|available/i.test(avail || '')
  const badge = avail ? `<div class="avail-badge ${isOpen ? 'open' : 'closed'}">${esc(avail)}</div>` : ''
  const summaryLines = Array.isArray(resume?.summary) ? resume.summary : resume?.summary ? [resume.summary] : []
  const summary = summaryLines.length
    ? `<div class="timeline-summary">${summaryLines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`
    : ''
  return `
    <div class="zone-label">About</div>
    <h2>${esc(p.title || 'Jovylle')}</h2>
    ${badge}
    <p>${esc(p.short_bio || '')}</p>
    ${summary}
  `
}

function renderHighlights(highlights) {
  const list = (highlights?.highlights || []).slice(0, 8)
  if (!list.length) return '<div class="zone-label">Highlights</div><h2>Highlights</h2><p>No highlights found.</p>'
  const items = list.map(h => {
    const tech = (h.technologies || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')
    const meta = [h.tag, h.year].filter(Boolean).map(m => esc(m)).join(' · ')
    return `
      <div class="proj-item">
        <h3>${esc(h.title || '')}</h3>
        ${meta ? `<div class="tags"><span class="tag">${meta}</span></div>` : ''}
        ${h.description ? `<p>${esc(h.description)}</p>` : ''}
        ${tech ? `<div class="tags">${tech}</div>` : ''}
      </div>
    `
  }).join('')
  return `<div class="zone-label">Highlights</div><h2>Highlights</h2><div class="proj-list">${items}</div>`
}

function renderUses(uses) {
  if (!uses) return '<div class="zone-label">Uses</div><h2>Uses</h2><p>No uses data.</p>'
  const col = (title, list) => {
    const rows = (list || []).map(it => `
      <a class="social-link">
        <i class="bx bx-${esc(it.icon || 'chip')}"></i>
        <span>${esc(it.description || '')}</span>
      </a>`).join('')
    return `<div class="skill-cat"><h3>${title}</h3><div class="social-list">${rows}</div></div>`
  }
  return `<div class="zone-label">Uses</div><h2>Uses</h2>${col('Hardware', uses.hardware)}${col('Software', uses.software)}`
}

function renderHome(profile) {
  if (!profile) return '<div class="zone-label">Home</div><h2>Jovylle</h2><p>No profile data.</p>'
  const avail = profile.availability
  const isOpen = /open|available/i.test(avail || '')
  const badge = avail
    ? `<div class="avail-badge ${isOpen ? 'open' : 'closed'}">${esc(avail)}</div>`
    : ''
  return `
    <div class="zone-label">Home</div>
    <h2>${esc(profile.title || 'Jovylle')}</h2>
    ${badge}
    <p>${esc(profile.short_bio || '')}</p>
  `
}

function renderProjects(projects) {
  const list = (projects?.projects || [])
    .filter(p => p.status === 'published')
    .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
    .slice(0, 10)

  if (!list.length) return '<div class="zone-label">Projects</div><h2>Projects</h2><p>No projects found.</p>'

  const items = list.map(p => {
    const desc = p.description ? esc(p.description).slice(0, 120) + (p.description.length > 120 ? '…' : '') : ''
    const tech = (p.tech || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')
    return `
      <div class="proj-item">
        <h3>${esc(p.title || p.name)}</h3>
        ${desc ? `<p>${desc}</p>` : ''}
        ${tech ? `<div class="tags">${tech}</div>` : ''}
      </div>
    `
  }).join('')

  return `<div class="zone-label">Projects</div><h2>Projects</h2><div class="proj-list">${items}</div>`
}

function renderTimeline(resume) {
  if (!resume) return '<div class="zone-label">Timeline</div><h2>Experience</h2><p>No resume data.</p>'

  const summaryLines = Array.isArray(resume.summary) ? resume.summary : resume.summary ? [resume.summary] : []
  const summary = summaryLines.length
    ? `<div class="timeline-summary">${summaryLines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`
    : ''

  const entries = (resume.timeline || resume.experience || []).map(e => `
    <div class="tl-item">
      <div class="tl-dot"></div>
      <div class="tl-body">
        <div class="tl-role">${esc(e.role || e.title)}</div>
        <div class="tl-company">${esc(e.company || e.organization || '')}</div>
        <div class="tl-range">${esc(e.range || e.period || e.date || '')}</div>
      </div>
    </div>
  `).join('')

  return `<div class="zone-label">Timeline</div><h2>Experience</h2>${summary}<div class="tl-list">${entries || '<p>No entries.</p>'}</div>`
}

function renderSkills(resume) {
  if (!resume?.skills) return '<div class="zone-label">Skills</div><h2>Skills</h2><p>No skill data.</p>'

  const skills = resume.skills
  let html = '<div class="zone-label">Skills</div><h2>Skills</h2>'

  if (Array.isArray(skills)) {
    html += `<div class="skill-cat"><div class="skill-tags">${skills.map(s => `<span class="skill-tag">${esc(typeof s === 'string' ? s : s.name)}</span>`).join('')}</div></div>`
  } else {
    html += Object.entries(skills).map(([cat, items]) => {
      const tags = (Array.isArray(items) ? items : [items])
        .map(s => `<span class="skill-tag">${esc(typeof s === 'string' ? s : s.name || s)}</span>`)
        .join('')
      return `<div class="skill-cat"><h3>${esc(cat)}</h3><div class="skill-tags">${tags}</div></div>`
    }).join('')
  }

  return html
}

function renderContact(social) {
  if (!social?.links?.length) return '<div class="zone-label">Contact</div><h2>Contact</h2><p>No links found.</p>'

  const iconMap = { github: 'bxl-github', twitter: 'bxl-twitter', linkedin: 'bxl-linkedin', instagram: 'bxl-instagram', email: 'bx-envelope', mail: 'bx-envelope', youtube: 'bxl-youtube', facebook: 'bxl-facebook', website: 'bx-globe', default: 'bx-link-external' }

  const links = social.links.map(l => {
    const key = (l.icon || l.platform || l.name || '').toLowerCase()
    const icon = iconMap[key] || iconMap.default
    return `<a class="social-link" href="${esc(l.url)}" target="_blank" rel="noopener">
      <i class="bx ${icon}"></i>
      <span>${esc(l.label || l.platform || l.name)}</span>
      <i class="bx bx-right-arrow-alt" style="margin-left:auto;color:#6b7280"></i>
    </a>`
  }).join('')

  return `<div class="zone-label">Contact</div><h2>Get in Touch</h2><div class="social-list">${links}</div>`
}

// ─── Drift & dust juice ───
const SKID_POOL = 120
const skidGeo = new THREE.PlaneGeometry(0.4, 0.7)
const skidMarks = []
for (let i = 0; i < SKID_POOL; i++) {
  const m = new THREE.Mesh(
    skidGeo,
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.5, depthWrite: false })
  )
  m.rotation.x = -Math.PI / 2
  m.visible = false
  scene.add(m)
  skidMarks.push(m)
}
let skidWrite = 0
const _qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
const _qYaw = new THREE.Quaternion()
const _yAxis = new THREE.Vector3(0, 1, 0)

function stampSkid(pos, yaw) {
  const m = skidMarks[skidWrite]
  m.position.set(pos.x, 0.02, pos.z)
  _qYaw.setFromAxisAngle(_yAxis, yaw)
  m.quaternion.multiplyQuaternions(_qYaw, _qFlat)
  m.visible = true
  skidWrite = (skidWrite + 1) % SKID_POOL
}

const DUST_COUNT = 60
const dustPos = new Float32Array(DUST_COUNT * 3)
const dustData = []
for (let i = 0; i < DUST_COUNT; i++) {
  dustPos[i * 3 + 1] = -1000
  dustData.push({ life: 0, vx: 0, vy: 0, vz: 0 })
}
const dustGeo = new THREE.BufferGeometry()
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({ color: 0xd9c9a0, size: 0.55, transparent: true, opacity: 0.7, depthWrite: false })
)
dust.frustumCulled = false
scene.add(dust)

function spawnDust(pos, count) {
  let spawned = 0
  for (let i = 0; i < DUST_COUNT && spawned < count; i++) {
    if (dustData[i].life > 0) continue
    const d = dustData[i]
    d.life = 0.6 + Math.random() * 0.4
    d.vx = (Math.random() - 0.5) * 3
    d.vy = 1.5 + Math.random() * 1.5
    d.vz = (Math.random() - 0.5) * 3
    dustPos[i * 3] = pos.x
    dustPos[i * 3 + 1] = 0.2
    dustPos[i * 3 + 2] = pos.z
    spawned++
  }
}

function updateDust(dt) {
  for (let i = 0; i < DUST_COUNT; i++) {
    const d = dustData[i]
    if (d.life <= 0) continue
    d.life -= dt
    if (d.life <= 0) { dustPos[i * 3 + 1] = -1000; continue }
    d.vy -= 4 * dt
    dustPos[i * 3] += d.vx * dt
    dustPos[i * 3 + 1] += d.vy * dt
    dustPos[i * 3 + 2] += d.vz * dt
  }
  dustGeo.attributes.position.needsUpdate = true
}

const _fwd = new THREE.Vector3()
const _chassisQuat = new THREE.Quaternion()

function updateJuice(dt) {
  _chassisQuat.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
  _fwd.set(0, 0, -1).applyQuaternion(_chassisQuat)
  const yaw = Math.atan2(_fwd.x, -_fwd.z)

  const speed = Math.abs(vehicle.currentVehicleSpeedKmHour || 0)
  const turning = Math.abs(steering) > 0.15
  const drifting = speed > 10 && (keys.handbrake || (boosting && turning))

  if (drifting) {
    const rear = [2, 3]
    for (const idx of rear) {
      const p = vehicle.wheelInfos[idx].worldTransform.position
      stampSkid(p, yaw)
      if (Math.random() < 0.5) spawnDust(p, 1)
    }
  }
  sfx.setDrift(drifting && controlsEnabled, Math.min(1, speed / 55))
  updateDust(dt)
}

// ─── Minimap / radar HUD (with compass rose) ───
function drawMinimap() {
  if (!minimapCtx) return
  const ctx = minimapCtx
  const size = minimapCanvas.width
  ctx.clearRect(0, 0, size, size)

  const toMap = (x, z) => [
    ((x + BOUND) / (2 * BOUND)) * size,
    ((z + BOUND) / (2 * BOUND)) * size,
  ]

  // cardinal marks
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.font = '9px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', size / 2, 8)
  ctx.fillText('S', size / 2, size - 8)
  ctx.fillText('W', 8, size / 2)
  ctx.fillText('E', size - 8, size / 2)

  // Loop map: trace the ring so the radar reads as a circuit (classic has none).
  if (world.loopPoints && world.loopPoints.length) {
    ctx.beginPath()
    world.loopPoints.forEach(([x, z], i) => {
      const [mx, my] = toMap(x, z)
      i ? ctx.lineTo(mx, my) : ctx.moveTo(mx, my)
    })
    ctx.closePath()
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 3
    ctx.stroke()
  }

  for (const zone of ZONES) {
    const [mx, my] = toMap(zone.pos.x, zone.pos.z)
    if (zone.id === activeZone) {
      ctx.beginPath()
      ctx.arc(mx, my, 8, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(mx, my, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = '#' + zone.color.toString(16).padStart(6, '0')
    ctx.fill()
  }

  _chassisQuat.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
  _fwd.set(0, 0, -1).applyQuaternion(_chassisQuat)
  const angle = Math.atan2(_fwd.x, -_fwd.z)
  const [cx, cy] = toMap(chassisBody.position.x, chassisBody.position.z)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, -7)
  ctx.lineTo(5, 6)
  ctx.lineTo(-5, 6)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
}

// ─── Richer HUD (counter, speedometer, compass, speed-fx) ───
const SPEEDO_CIRC = 2 * Math.PI * 26
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function updateCounterHUD() {
  if (collectibleCounter) collectibleCounter.textContent = `★ ${collectedCount} / ${collectedTotal}`
}

function updateHUD() {
  const speed = Math.abs(vehicle.currentVehicleSpeedKmHour || 0)
  if (speedoValue) speedoValue.textContent = Math.round(speed)
  if (speedoArc) {
    const frac = Math.min(1, speed / BOOST_MAX_KMH)
    speedoArc.style.strokeDashoffset = (SPEEDO_CIRC * (1 - frac * 0.75)).toFixed(1)
  }
  if (compassEl) {
    _chassisQuat.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
    _fwd.set(0, 0, -1).applyQuaternion(_chassisQuat)
    let bearing = Math.atan2(_fwd.x, -_fwd.z) * 180 / Math.PI
    bearing = (bearing + 360) % 360
    const card = CARDINALS[Math.round(bearing / 45) % 8]
    compassEl.textContent = `${card} ${Math.round(bearing) % 360}°`
  }
  if (speedFx) {
    let o = Math.max(0, (speed - 45) / 55) * 0.5 + (boosting ? 0.3 : 0) + speedFxBoost
    speedFx.style.opacity = Math.min(0.85, o).toFixed(3)
  }
}

// ─── Mute button ───
function toggleMute() {
  sfx.unlock()
  const muted = sfx.toggleMute()
  reflectMute(muted)
}
function reflectMute(muted) {
  if (!muteBtn) return
  const icon = muteBtn.querySelector('i')
  if (icon) icon.className = muted ? 'bx bx-volume-mute' : 'bx bx-volume-full'
  muteBtn.classList.toggle('muted', muted)
}
if (muteBtn) muteBtn.addEventListener('click', toggleMute)
if (cameraBtn) cameraBtn.addEventListener('click', cycleCamera)

// ─── Map switcher (cycles classic ↔ loop; persists + reloads) ───
// Reload rather than teardown: this is a static no-build app, and rebuilding the
// Three.js scene + Cannon bodies mid-session is fragile — the loading screen +
// intro cinematic mask the reload cleanly.
function switchMap() {
  const next = activeMap === 'loop' ? 'classic' : 'loop'
  try { localStorage.setItem('bruno-map', next) } catch (e) { /* private mode */ }
  const url = new URL(location.href)
  url.searchParams.set('map', next)
  location.href = url.toString()
}
if (mapBtn) mapBtn.addEventListener('click', switchMap)
if (mapLabel) mapLabel.textContent = activeMap

reflectMute(sfx.isMuted())
updateCounterHUD()
if (cameraLabel) cameraLabel.textContent = cameraMode

// ─── Intro cinematic ───
let introActive = false
let introStart = 0

function startIntro() {
  introActive = true
  introStart = performance.now()
  if (introPrompt) introPrompt.classList.add('show')
}

function updateIntroCamera() {
  const el = (performance.now() - introStart) / 1000
  const ang = el * 0.55
  const r = 78 - el * 6
  camera.position.set(Math.cos(ang) * r, 34 - el * 3, Math.sin(ang) * r)
  camera.lookAt(0, 2, 0)
  if (el > 6.5) endIntro()
}

function endIntro() {
  if (!introActive) return
  introActive = false
  controlsEnabled = true
  if (introPrompt) introPrompt.classList.remove('show')
  sfx.unlock()
  reflectMute(sfx.isMuted())
  sfx.startRev()
}

// ─── Animation loop ───
const clock = new THREE.Clock()
let elapsed = 0

function tick() {
  requestAnimationFrame(tick)

  const dt = Math.min(clock.getDelta(), 0.05)
  elapsed += dt

  updateVehicle(dt)
  physicsWorld.fixedStep(1 / 60, dt)

  vehicleGroup.position.copy(chassisBody.position)
  vehicleGroup.quaternion.set(
    chassisBody.quaternion.x,
    chassisBody.quaternion.y,
    chassisBody.quaternion.z,
    chassisBody.quaternion.w
  )

  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    vehicle.updateWheelTransform(i)
    const t = vehicle.wheelInfos[i].worldTransform
    wheelMeshes[i].position.copy(t.position)
    wheelMeshes[i].quaternion.copy(t.quaternion)
  }

  updateDayNight(dt)
  world.tick(dt, elapsed)
  updateJuice(dt)

  if (introActive) {
    updateIntroCamera()
  } else {
    updateGameplay(dt)
    updateCamera(dt)
    checkZoneProximity()
  }

  drawMinimap()
  updateHUD()

  renderer.render(scene, camera)
}

tick()

// ─── Resize ───
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
})
