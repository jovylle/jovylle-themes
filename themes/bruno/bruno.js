import * as THREE from 'https://esm.sh/three@0.169.0'
import * as CANNON from 'https://esm.sh/cannon-es@0.20.0'
import { fetchAllCmsData, esc } from '../../shared/cms.js'

// ─── DOM refs ───
const canvas = document.getElementById('webgl')
const loadingEl = document.getElementById('loading')
const loadingBar = document.getElementById('loading-bar')
const controlsHint = document.getElementById('controls-hint')
const zoneToast = document.getElementById('zone-toast')
const infoPanel = document.getElementById('info-panel')
const infoContent = document.getElementById('info-content')
const infoClose = document.getElementById('info-close')

// ─── Renderer & Scene ───
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87ceeb)
scene.fog = new THREE.Fog(0x87ceeb, 60, 180)

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500)
camera.position.set(0, 12, 20)

// ─── Lighting ───
scene.add(new THREE.AmbientLight(0xffffff, 0.6))

const sun = new THREE.DirectionalLight(0xfff4d6, 1.4)
sun.position.set(40, 60, 30)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 1
sun.shadow.camera.far = 300
sun.shadow.camera.left = -120
sun.shadow.camera.right = 120
sun.shadow.camera.top = 120
sun.shadow.camera.bottom = -120
sun.shadow.bias = -0.001
scene.add(sun)

scene.add(new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.5))

// ─── Physics ───
const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) })
physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld)
physicsWorld.allowSleep = true

const groundMat = new CANNON.Material('ground')
const vehicleMat = new CANNON.Material('vehicle')
physicsWorld.addContactMaterial(new CANNON.ContactMaterial(groundMat, vehicleMat, { friction: 0.6, restitution: 0.1 }))

// ─── Ground ───
const groundBody = new CANNON.Body({ mass: 0, material: groundMat })
groundBody.addShape(new CANNON.Plane())
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
physicsWorld.addBody(groundBody)

const groundMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300),
  new THREE.MeshLambertMaterial({ color: 0x5a9e29 })
)
groundMesh.rotation.x = -Math.PI / 2
groundMesh.receiveShadow = true
scene.add(groundMesh)

// ─── Zones definition ───
const ZONE_RADIUS = 18
const ZONES = [
  { id: 'home',     label: 'Home',     pos: new THREE.Vector3(0, 0, 0),    color: 0x6366f1 },
  { id: 'projects', label: 'Projects', pos: new THREE.Vector3(0, 0, -50),  color: 0xf59e0b },
  { id: 'timeline', label: 'Timeline', pos: new THREE.Vector3(50, 0, 0),   color: 0x10b981 },
  { id: 'skills',   label: 'Skills',   pos: new THREE.Vector3(0, 0, 50),   color: 0xec4899 },
  { id: 'contact',  label: 'Contact',  pos: new THREE.Vector3(-50, 0, 0),  color: 0xf97316 },
]

// ─── Road strips between zones ───
function addRoad(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from)
  const len = dir.length()
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.05, len),
    new THREE.MeshLambertMaterial({ color: 0xe8d5a3 })
  )
  mesh.position.set(mid.x, 0.03, mid.z)
  mesh.rotation.y = Math.atan2(dir.x, dir.z)
  mesh.receiveShadow = true
  scene.add(mesh)
}

const home = ZONES[0].pos
ZONES.slice(1).forEach(z => addRoad(home, z.pos))

// ─── Zone platforms ───
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

ZONES.forEach(zone => {
  // Platform
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(20, 0.6, 20),
    new THREE.MeshLambertMaterial({ color: zone.color })
  )
  platform.position.set(zone.pos.x, 0.3, zone.pos.z)
  platform.receiveShadow = true
  platform.castShadow = true
  scene.add(platform)

  // Sign post
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

// ─── Decorations: trees ───
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8b5e3c })
const leavesMat = new THREE.MeshLambertMaterial({ color: 0x2d7a27 })

function addTree(x, z) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.6), trunkMat)
  trunk.position.set(x, 0.8, z)
  trunk.castShadow = true
  scene.add(trunk)
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 7), leavesMat)
  leaves.position.set(x, 3.1, z)
  leaves.castShadow = true
  scene.add(leaves)
}

const rng = (seed => () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647 })(42)
for (let i = 0; i < 60; i++) {
  const angle = rng() * Math.PI * 2
  const radius = 30 + rng() * 80
  const tx = Math.cos(angle) * radius
  const tz = Math.sin(angle) * radius
  // skip if too close to any zone or road
  const tooClose = ZONES.some(z => Math.hypot(tx - z.pos.x, tz - z.pos.z) < 16)
  if (!tooClose) addTree(tx, tz)
}

// ─── Decorations: rocks ───
const rockMat = new THREE.MeshLambertMaterial({ color: 0x9ca3af, flatShading: true })
for (let i = 0; i < 25; i++) {
  const angle = rng() * Math.PI * 2
  const radius = 15 + rng() * 90
  const rx = Math.cos(angle) * radius
  const rz = Math.sin(angle) * radius
  const tooClose = ZONES.some(z => Math.hypot(rx - z.pos.x, rz - z.pos.z) < 14)
  if (!tooClose) {
    const rock = new THREE.Mesh(
      new THREE.SphereGeometry(0.4 + rng() * 0.7, 5, 4),
      rockMat
    )
    rock.position.set(rx, 0.3, rz)
    rock.rotation.y = rng() * Math.PI
    rock.castShadow = true
    scene.add(rock)
  }
}

// ─── Vehicle body (visual) ───
// The car's front faces -Z (windshield at -Z). The chase camera sits at +Z (behind).
const vehicleGroup = new THREE.Group()

const bodyMesh = new THREE.Mesh(
  new THREE.BoxGeometry(2.4, 0.8, 4),
  new THREE.MeshLambertMaterial({ color: 0xe8503a })
)
bodyMesh.position.y = 0
bodyMesh.castShadow = true
vehicleGroup.add(bodyMesh)

const cabinMesh = new THREE.Mesh(
  new THREE.BoxGeometry(2.0, 0.7, 2.2),
  new THREE.MeshLambertMaterial({ color: 0xd03e2a })
)
cabinMesh.position.set(0, 0.75, 0.4)
cabinMesh.castShadow = true
vehicleGroup.add(cabinMesh)

const windshield = new THREE.Mesh(
  new THREE.PlaneGeometry(1.8, 0.6),
  new THREE.MeshLambertMaterial({ color: 0xbfe3f2, transparent: true, opacity: 0.7 })
)
windshield.position.set(0, 0.75, -0.7)
windshield.rotation.x = 0.25
vehicleGroup.add(windshield)

scene.add(vehicleGroup)

// Wheel meshes — live in the scene (not the group) so RaycastVehicle can drive
// their spin/steer transforms directly each frame.
const wheelPositions = [[-1.3, 0, -1.3], [1.3, 0, -1.3], [-1.3, 0, 1.3], [1.3, 0, 1.3]]
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x2b2b2b })
const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 14)
wheelGeo.rotateZ(Math.PI / 2) // cylinder axis → X so it aligns with the axle
const wheelMeshes = wheelPositions.map(() => {
  const w = new THREE.Mesh(wheelGeo, wheelMat)
  w.castShadow = true
  scene.add(w)
  return w
})

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
  frictionSlip: 1.6,
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
// Wheel indices: 0,1 = front (steer) · 2,3 = rear (drive)
vehicle.addToWorld(physicsWorld)

// ─── Input ───
const keys = { forward: false, backward: false, left: false, right: false }

window.addEventListener('keydown', e => {
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp')    { keys.forward   = true; e.preventDefault() }
  if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown')  { keys.backward  = true; e.preventDefault() }
  if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft')  { keys.left      = true; e.preventDefault() }
  if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') { keys.right     = true; e.preventDefault() }
  if (e.key === 'r' || e.key === 'R') resetVehicle()
})
window.addEventListener('keyup', e => {
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp')    keys.forward   = false
  if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown')  keys.backward  = false
  if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft')  keys.left      = false
  if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') keys.right     = false
})

// Touch joystick
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
const MAX_STEER = 0.5     // radians of front-wheel steer
const ENGINE_FORCE = 1800 // drive force
const REVERSE_FORCE = 800
const IDLE_BRAKE = 6      // light drag so the car coasts to a stop

let steering = 0
const lastSafePos = new CANNON.Vec3(0, 4, 0)
const _upWorld = new CANNON.Vec3()

function updateVehicle(dt) {
  // Steering — ease toward target so it doesn't snap.
  // (If steering feels inverted in-browser, flip the sign of MAX_STEER here.)
  const target = keys.left ? MAX_STEER : keys.right ? -MAX_STEER : 0
  steering += (target - steering) * Math.min(1, dt * 8)
  vehicle.setSteeringValue(steering, 0)
  vehicle.setSteeringValue(steering, 1)

  // Engine — rear-wheel drive. The car's front faces -Z; a positive engine
  // force drives it that way (forward), negative reverses toward the camera.
  let force = 0
  if (keys.forward) force = ENGINE_FORCE
  else if (keys.backward) force = -REVERSE_FORCE
  vehicle.applyEngineForce(force, 2)
  vehicle.applyEngineForce(force, 3)

  // Light braking when coasting (no throttle) for a settled arcade feel.
  const brake = force === 0 ? IDLE_BRAKE : 0
  for (let i = 0; i < 4; i++) vehicle.setBrake(brake, i)

  // Remember the last upright position as a safe respawn spot.
  chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0), _upWorld)
  if (_upWorld.y > 0.6) lastSafePos.copy(chassisBody.position)
}

function resetVehicle() {
  chassisBody.position.set(lastSafePos.x, lastSafePos.y + 1.5, lastSafePos.z)
  chassisBody.quaternion.set(0, 0, 0, 1)
  chassisBody.velocity.set(0, 0, 0)
  chassisBody.angularVelocity.set(0, 0, 0)
  steering = 0
}

// ─── Camera chase ───
const camOffset = new THREE.Vector3(0, 9, 16)
const camTarget = new THREE.Vector3()

const _camQuat = new THREE.Quaternion()
function updateCamera() {
  const vp = chassisBody.position
  _camQuat.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)

  const offset = camOffset.clone().applyQuaternion(_camQuat)
  const desired = new THREE.Vector3(vp.x + offset.x, vp.y + offset.y, vp.z + offset.z)
  camera.position.lerp(desired, 0.08)

  camTarget.set(vp.x, vp.y + 1, vp.z)
  camera.lookAt(camTarget)
}

// ─── Zone proximity ───
let activeZone = null
let toastTimer = null

function enterZone(zone) {
  if (activeZone === zone.id) return
  activeZone = zone.id

  clearTimeout(toastTimer)
  zoneToast.textContent = zone.label
  zoneToast.classList.add('show')
  toastTimer = setTimeout(() => zoneToast.classList.remove('show'), 3000)

  if (cmsData) renderPanel(zone.id)
  infoPanel.classList.add('visible')
}

function exitZone() {
  if (!activeZone) return
  activeZone = null
  infoPanel.classList.remove('visible')
}

function checkZoneProximity() {
  const vp = new THREE.Vector3(
    chassisBody.position.x,
    chassisBody.position.y,
    chassisBody.position.z
  )
  let inAny = false
  for (const zone of ZONES) {
    const dist = vp.distanceTo(zone.pos)
    if (dist < ZONE_RADIUS) {
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
  .then(data => {
    cmsData = data
    setProgress(100)
    setTimeout(() => loadingEl.classList.add('hidden'), 400)
    setTimeout(() => controlsHint.classList.add('faded'), 5000)
  })
  .catch(() => {
    cmsData = {}
    setProgress(100)
    setTimeout(() => loadingEl.classList.add('hidden'), 400)
    setTimeout(() => controlsHint.classList.add('faded'), 5000)
  })

// ─── Panel renderers ───
function renderPanel(zoneId) {
  const d = cmsData || {}
  switch (zoneId) {
    case 'home':     infoContent.innerHTML = renderHome(d.profile);         break
    case 'projects': infoContent.innerHTML = renderProjects(d.projects);    break
    case 'timeline': infoContent.innerHTML = renderTimeline(d.resume);      break
    case 'skills':   infoContent.innerHTML = renderSkills(d.resume);        break
    case 'contact':  infoContent.innerHTML = renderContact(d.social);       break
  }
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

// ─── Animation loop ───
const clock = new THREE.Clock()

function tick() {
  requestAnimationFrame(tick)

  const dt = Math.min(clock.getDelta(), 0.05)

  updateVehicle(dt)
  physicsWorld.fixedStep(1 / 60, dt)

  // Sync car body to chassis (suspension handles ride height).
  vehicleGroup.position.copy(chassisBody.position)
  vehicleGroup.quaternion.set(
    chassisBody.quaternion.x,
    chassisBody.quaternion.y,
    chassisBody.quaternion.z,
    chassisBody.quaternion.w
  )

  // Sync each wheel mesh to its physics transform (spin + steer for free).
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    vehicle.updateWheelTransform(i)
    const t = vehicle.wheelInfos[i].worldTransform
    wheelMeshes[i].position.copy(t.position)
    wheelMeshes[i].quaternion.copy(t.quaternion)
  }

  updateCamera()
  checkZoneProximity()

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
