// ─── World builder: environment, props, sky, water, gameplay toys ───
// Everything here is procedural (canvas textures + geometry) and returns a
// single handle with `tick(dt, elapsed)` and `setTimeOfDay(t, sunDir, dayAmount)`
// so bruno.js can drive animation and the day/night cycle without knowing the
// internals. Physics bodies are created through ctx helpers (addSolid / propMat).
import * as THREE from 'https://esm.sh/three@0.169.0'
import * as CANNON from 'https://esm.sh/cannon-es@0.20.0'

// Pond lives in the far −X/−Z quadrant, clear of the axis roads + zones.
const POND = { x: -48, z: -48, r: 15 }
function inPond(x, z, pad = 0) {
  return Math.hypot(x - POND.x, z - POND.z) < POND.r + pad
}

export function buildWorld(scene, ctx) {
  const { BOUND, ZONES, makeRng, blockedSpot, addSolid, distToSegment } = ctx

  // ─────────────────────────────────────────────────────────────
  // Race track (closed loop) — defined first so scatter can avoid it.
  // Rounded-rectangle circuit at ±76: outside the zone platforms (±50),
  // inside the walls (±100). Half-width 4 → drivable width 8.
  // ─────────────────────────────────────────────────────────────
  const TRACK_HALF = 4
  const TRACK = 76      // straights sit at ±76, chamfers cut the corners
  const TRACK_IN = 56   // where a straight ends and its chamfer begins
  // Centerline segments: [ax, az, bx, bz]
  const trackSegments = [
    // straights
    [-TRACK_IN, -TRACK, TRACK_IN, -TRACK],   // N
    [-TRACK_IN, TRACK, TRACK_IN, TRACK],     // S
    [TRACK, -TRACK_IN, TRACK, TRACK_IN],     // E
    [-TRACK, -TRACK_IN, -TRACK, TRACK_IN],   // W
    // chamfered corners
    [TRACK_IN, -TRACK, TRACK, -TRACK_IN],    // NE
    [TRACK, TRACK_IN, TRACK_IN, TRACK],      // SE
    [-TRACK_IN, TRACK, -TRACK, TRACK_IN],    // SW
    [-TRACK, -TRACK_IN, -TRACK_IN, -TRACK],  // NW
  ]

  // True if (x,z) is within TRACK_HALF + pad of any track segment.
  function onTrack(x, z, pad = 0) {
    const limit = TRACK_HALF + pad
    for (const [ax, az, bx, bz] of trackSegments) {
      if (distToSegment(x, z, ax, az, bx, bz) < limit) return true
    }
    return false
  }

  // Handles we animate every frame / on day-night change.
  const clouds = []
  const collectibles = []
  const dynamicProps = []
  const boostPads = []
  const ramps = []
  const windmills = []
  const campfires = []
  const flags = []
  let water = null
  let stars = null
  let fireflies = null
  const lampLights = []
  const lampHeads = []

  // ─────────────────────────────────────────────────────────────
  // Ground (canvas-textured, flat physics stays in bruno)
  // ─────────────────────────────────────────────────────────────
  function makeGroundTexture() {
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const g = c.getContext('2d')
    g.fillStyle = '#5a9e29'
    g.fillRect(0, 0, 512, 512)
    // grassy patches (lighter/darker greens)
    const greens = ['#63a831', '#4f8f24', '#6bb037', '#548f28']
    for (let i = 0; i < 260; i++) {
      g.fillStyle = greens[i % greens.length]
      g.globalAlpha = 0.35
      const r = 6 + Math.random() * 26
      g.beginPath()
      g.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2)
      g.fill()
    }
    // dirt splotches
    g.globalAlpha = 0.5
    for (let i = 0; i < 40; i++) {
      g.fillStyle = i % 2 ? '#8a6d3b' : '#7a5f34'
      const r = 4 + Math.random() * 12
      g.beginPath()
      g.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
    const tex = new THREE.CanvasTexture(c)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(8, 8)
    return tex
  }

  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() })
  )
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.receiveShadow = true
  scene.add(groundMesh)

  // ─────────────────────────────────────────────────────────────
  // Race track meshes — dark asphalt strips along each segment, laid on
  // the flat plane (purely visual; no physics). Built before scatter so it
  // reads underneath everything at the same y.
  // ─────────────────────────────────────────────────────────────
  {
    const asphaltMat = new THREE.MeshLambertMaterial({ color: 0x2b2b30 })
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2efe4 })
    for (const [ax, az, bx, bz] of trackSegments) {
      const dx = bx - ax, dz = bz - az
      const len = Math.hypot(dx, dz)
      // slightly overlap segment ends so corners join without gaps
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(TRACK_HALF * 2, 0.05, len + TRACK_HALF * 2),
        asphaltMat
      )
      strip.position.set((ax + bx) / 2, 0.04, (az + bz) / 2)
      strip.rotation.y = Math.atan2(dx, dz)
      strip.receiveShadow = true
      scene.add(strip)
      // dashed white centerline
      const dashes = Math.max(1, Math.floor(len / 4))
      for (let d = 0; d < dashes; d++) {
        const t = (d + 0.5) / dashes
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 1.4), dashMat)
        dash.position.set(ax + dx * t, 0.07, az + dz * t)
        dash.rotation.y = Math.atan2(dx, dz)
        scene.add(dash)
      }
    }

    // Start/finish line — checkered CanvasTexture quad on the south straight.
    const fc = document.createElement('canvas')
    fc.width = fc.height = 64
    const fg = fc.getContext('2d')
    const sq = 16
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      fg.fillStyle = (x + y) % 2 ? '#111' : '#fff'
      fg.fillRect(x * sq, y * sq, sq, sq)
    }
    const finishTex = new THREE.CanvasTexture(fc)
    finishTex.wrapS = finishTex.wrapT = THREE.RepeatWrapping
    finishTex.repeat.set(TRACK_HALF * 2, 1)
    const finish = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_HALF * 2, 2),
      new THREE.MeshBasicMaterial({ map: finishTex })
    )
    finish.rotation.x = -Math.PI / 2
    finish.position.set(0, 0.05, TRACK)
    scene.add(finish)
  }

  // Low decorative grass mounds near the edges (no colliders).
  const moundGeo = new THREE.SphereGeometry(1, 10, 6)
  const moundMat = new THREE.MeshLambertMaterial({ color: 0x4f8f24 })
  const rMound = makeRng(11)
  for (let i = 0; i < 26; i++) {
    const a = rMound() * Math.PI * 2
    const rad = 55 + rMound() * 40
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad
    if (inPond(x, z, 6) || onTrack(x, z, 2)) continue
    const m = new THREE.Mesh(moundGeo, moundMat)
    const s = 2 + rMound() * 4
    m.position.set(x, -0.2, z)
    m.scale.set(s, 0.35 + rMound() * 0.4, s)
    m.receiveShadow = true
    scene.add(m)
  }

  // ─────────────────────────────────────────────────────────────
  // Sky dome (gradient shader) + drifting clouds
  // ─────────────────────────────────────────────────────────────
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x1e5fa8) },
    bottomColor: { value: new THREE.Color(0x9fd0ee) },
    sunPos: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(0xfff3d0) },
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 bottomColor;
        uniform vec3 sunPos; uniform vec3 sunColor;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottomColor, topColor, h);
          float d = max(0.0, dot(dir, normalize(sunPos)));
          col += sunColor * pow(d, 128.0) * 0.8;
          col += sunColor * pow(d, 8.0) * 0.12;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  )
  scene.add(sky)

  // Clouds: soft white puff groups drifting on X.
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  const puffGeo = new THREE.SphereGeometry(1, 8, 6)
  const rCloud = makeRng(23)
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group()
    const puffs = 3 + Math.floor(rCloud() * 4)
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(puffGeo, cloudMat)
      puff.position.set((rCloud() - 0.5) * 8, (rCloud() - 0.5) * 2, (rCloud() - 0.5) * 5)
      const s = 2 + rCloud() * 3
      puff.scale.set(s, s * 0.6, s)
      g.add(puff)
    }
    g.position.set((rCloud() - 0.5) * 180, 45 + rCloud() * 25, (rCloud() - 0.5) * 180)
    g.userData.speed = 0.6 + rCloud() * 0.8
    scene.add(g)
    clouds.push(g)
  }

  // ─────────────────────────────────────────────────────────────
  // Nature (passable): trees (variants), bushes, flowers, logs
  // ─────────────────────────────────────────────────────────────
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8b5e3c })
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x2d7a27 })
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3a9440 })
  const treeTrunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.6)
  const coneGeo = new THREE.ConeGeometry(1.4, 3, 7)
  const tallConeGeo = new THREE.ConeGeometry(1.1, 2, 7)
  const canopyGeo = new THREE.IcosahedronGeometry(1.7, 0)

  // Returns the world position so bruno can add a matching collider.
  function addTree(x, z, variant) {
    const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat)
    trunk.position.set(x, 0.8, z)
    trunk.castShadow = true
    scene.add(trunk)
    if (variant === 0) {
      const leaves = new THREE.Mesh(coneGeo, pineMat)
      leaves.position.set(x, 3.1, z); leaves.castShadow = true
      scene.add(leaves)
    } else if (variant === 1) {
      // stacked tall pine
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(tallConeGeo, pineMat)
        c.position.set(x, 2.2 + k * 1.3, z)
        c.scale.setScalar(1 - k * 0.22)
        c.castShadow = true
        scene.add(c)
      }
    } else {
      const canopy = new THREE.Mesh(canopyGeo, canopyMat)
      canopy.position.set(x, 3, z)
      canopy.scale.set(1, 0.9, 1)
      canopy.castShadow = true
      scene.add(canopy)
    }
    // tight solid trunk collider (chassis bumps it; wheels raycast past)
    addSolid(new CANNON.Box(new CANNON.Vec3(0.42, 1.2, 0.42)), x, 1.2, z, { tag: 'isObstacle' })
  }

  const treeSpots = []
  const rTree = makeRng(42)
  for (let i = 0; i < 70; i++) {
    const a = rTree() * Math.PI * 2
    const rad = 26 + rTree() * 70
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad
    if (blockedSpot(x, z, 15) || inPond(x, z, 5) || onTrack(x, z, 2)) continue
    const variant = Math.floor(rTree() * 3)
    addTree(x, z, variant)
    treeSpots.push([x, z])
  }

  // Bushes — icosahedron clusters.
  const bushGeo = new THREE.IcosahedronGeometry(0.7, 0)
  const bushMat = new THREE.MeshLambertMaterial({ color: 0x2f7d2f, flatShading: true })
  const rBush = makeRng(77)
  for (let i = 0; i < 30; i++) {
    const a = rBush() * Math.PI * 2
    const rad = 20 + rBush() * 75
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad
    if (blockedSpot(x, z, 10) || inPond(x, z, 4) || onTrack(x, z, 2)) continue
    const g = new THREE.Group()
    const n = 2 + Math.floor(rBush() * 3)
    for (let k = 0; k < n; k++) {
      const b = new THREE.Mesh(bushGeo, bushMat)
      b.position.set((rBush() - 0.5) * 1.2, 0.4, (rBush() - 0.5) * 1.2)
      b.scale.setScalar(0.7 + rBush() * 0.6)
      b.castShadow = true
      g.add(b)
    }
    g.position.set(x, 0, z)
    scene.add(g)
  }

  // Flower clusters — tiny colored dots on short stems.
  const flowerColors = [0xff5d8f, 0xffd93d, 0xff8c42, 0xb06bff, 0xffffff]
  const petalGeo = new THREE.SphereGeometry(0.12, 6, 5)
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.3)
  const stemMat = new THREE.MeshLambertMaterial({ color: 0x3a8f2f })
  const rFlower = makeRng(91)
  for (let i = 0; i < 20; i++) {
    const a = rFlower() * Math.PI * 2
    const rad = 18 + rFlower() * 78
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad
    if (blockedSpot(x, z, 9) || inPond(x, z, 3) || onTrack(x, z, 2)) continue
    const g = new THREE.Group()
    const petalMat = new THREE.MeshLambertMaterial({ color: flowerColors[Math.floor(rFlower() * flowerColors.length)] })
    const n = 4 + Math.floor(rFlower() * 5)
    for (let k = 0; k < n; k++) {
      const stem = new THREE.Mesh(stemGeo, stemMat)
      const fx = (rFlower() - 0.5) * 1.4, fz = (rFlower() - 0.5) * 1.4
      stem.position.set(fx, 0.15, fz)
      g.add(stem)
      const petal = new THREE.Mesh(petalGeo, petalMat)
      petal.position.set(fx, 0.32, fz)
      g.add(petal)
    }
    g.position.set(x, 0, z)
    scene.add(g)
  }

  // Fallen logs (passable decoration).
  const logGeo = new THREE.CylinderGeometry(0.35, 0.35, 3, 8)
  logGeo.rotateZ(Math.PI / 2)
  const rLog = makeRng(103)
  for (let i = 0; i < 6; i++) {
    const a = rLog() * Math.PI * 2
    const rad = 25 + rLog() * 65
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad
    if (blockedSpot(x, z, 10) || inPond(x, z, 4) || onTrack(x, z, 2)) continue
    const log = new THREE.Mesh(logGeo, trunkMat)
    log.position.set(x, 0.35, z)
    log.rotation.y = rLog() * Math.PI
    log.castShadow = true
    scene.add(log)
  }

  // Rocks (solid) — own seeded RNG so placement is independent of the trees.
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x9ca3af, flatShading: true })
  const rRock = makeRng(59)
  for (let i = 0; i < 25; i++) {
    const a = rRock() * Math.PI * 2
    const rad = 15 + rRock() * 82
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad
    if (blockedSpot(x, z, 12) || inPond(x, z, 4) || onTrack(x, z, 2)) continue
    const r = 0.5 + rRock() * 0.9
    const rock = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4), rockMat)
    rock.position.set(x, r * 0.6, z)
    rock.rotation.y = rRock() * Math.PI
    rock.castShadow = true
    scene.add(rock)
    addSolid(new CANNON.Sphere(r), x, r * 0.6, z, { tag: 'isObstacle' })
  }

  // ─────────────────────────────────────────────────────────────
  // Human-made: lampposts (solid), houses (solid), fences, benches
  // ─────────────────────────────────────────────────────────────
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4b })
  const lampGeo = new THREE.CylinderGeometry(0.14, 0.14, 5, 8)
  const lampHeadGeo = new THREE.SphereGeometry(0.4, 10, 8)
  const rLamp = makeRng(131)
  for (let i = 0; i < 8; i++) {
    const a = rLamp() * Math.PI * 2
    const rad = 22 + rLamp() * 55
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad
    if (blockedSpot(x, z, 12) || inPond(x, z, 5) || onTrack(x, z, 2)) continue
    const pole = new THREE.Mesh(lampGeo, poleMat)
    pole.position.set(x, 2.5, z); pole.castShadow = true
    scene.add(pole)
    const headMat = new THREE.MeshLambertMaterial({ color: 0xfff3c0, emissive: 0xffcc55, emissiveIntensity: 0 })
    const head = new THREE.Mesh(lampHeadGeo, headMat)
    head.position.set(x, 5.1, z)
    scene.add(head)
    lampHeads.push(head)
    const light = new THREE.PointLight(0xffcc66, 0, 18, 2)
    light.position.set(x, 5, z)
    scene.add(light)
    lampLights.push(light)
    // solid thin collider
    addSolid(new CANNON.Box(new CANNON.Vec3(0.22, 2.5, 0.22)), x, 2.5, z, { tag: 'isObstacle' })
  }

  // Houses — box body + pyramid roof + door/windows (solid).
  const wallMats = [0xe8d3a1, 0xd0b48a, 0xc9d3e0, 0xe0c0b0].map(c => new THREE.MeshLambertMaterial({ color: c }))
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8a3b2e })
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x5a3a22 })
  const winMat = new THREE.MeshLambertMaterial({ color: 0xbfe3f2, emissive: 0x223344, emissiveIntensity: 0.2 })
  const rHouse = makeRng(151)
  for (let i = 0; i < 4; i++) {
    let x, z, tries = 0
    do {
      const a = rHouse() * Math.PI * 2
      const rad = 34 + rHouse() * 45
      x = Math.cos(a) * rad; z = Math.sin(a) * rad
    } while ((blockedSpot(x, z, 16) || inPond(x, z, 8) || onTrack(x, z, 2)) && ++tries < 40)
    if (tries >= 40) continue
    const w = 5, h = 4, d = 5
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMats[i % wallMats.length])
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true
    g.add(body)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.85, 2.4, 4), roofMat)
    roof.position.y = h + 1.2; roof.rotation.y = Math.PI / 4; roof.castShadow = true
    g.add(roof)
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.8), doorMat)
    door.position.set(0, 0.9, d / 2 + 0.01)
    g.add(door)
    ;[-1.2, 1.2].forEach(wx => {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), winMat)
      win.position.set(wx, 2.4, d / 2 + 0.01)
      g.add(win)
    })
    g.position.set(x, 0, z)
    g.rotation.y = rHouse() * Math.PI * 2
    scene.add(g)
    addSolid(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), x, h / 2, z,
      { tag: 'isObstacle', rot: [0, g.rotation.y, 0] })
  }

  // Fences / hedges (decorative, passable) near a couple of zones.
  const hedgeMat = new THREE.MeshLambertMaterial({ color: 0x357a2f })
  const hedgeGeo = new THREE.BoxGeometry(1, 1, 1)
  const rFence = makeRng(167)
  for (let i = 0; i < 3; i++) {
    const a = rFence() * Math.PI * 2
    const rad = 30 + rFence() * 50
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad
    if (blockedSpot(cx, cz, 12) || inPond(cx, cz, 6) || onTrack(cx, cz, 2)) continue
    const dir = rFence() > 0.5 ? [1, 0] : [0, 1]
    for (let k = 0; k < 6; k++) {
      const seg = new THREE.Mesh(hedgeGeo, hedgeMat)
      seg.position.set(cx + dir[0] * (k - 3) * 1.05, 0.5, cz + dir[1] * (k - 3) * 1.05)
      seg.castShadow = true
      scene.add(seg)
    }
  }

  // A bench per zone (passable).
  const benchMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2c })
  ZONES.forEach(zone => {
    const g = new THREE.Group()
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 0.7), benchMat)
    seat.position.y = 0.5; seat.castShadow = true
    g.add(seat)
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.12), benchMat)
    back.position.set(0, 0.85, -0.3)
    g.add(back)
    ;[-0.9, 0.9].forEach(lx => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.6), benchMat)
      leg.position.set(lx, 0.25, 0)
      g.add(leg)
    })
    // place just outside the zone platform, toward +X
    g.position.set(zone.pos.x + 11, 0, zone.pos.z)
    g.rotation.y = -Math.PI / 2
    scene.add(g)
  })

  // ─────────────────────────────────────────────────────────────
  // Water: pond + solid bank ring + drivable bridge
  // ─────────────────────────────────────────────────────────────
  function makeWaterTexture() {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')
    const grd = g.createLinearGradient(0, 0, 256, 256)
    grd.addColorStop(0, '#2f7fb5')
    grd.addColorStop(0.5, '#3f97cf')
    grd.addColorStop(1, '#2b74a8')
    g.fillStyle = grd
    g.fillRect(0, 0, 256, 256)
    g.strokeStyle = 'rgba(255,255,255,0.25)'
    g.lineWidth = 2
    for (let i = 0; i < 20; i++) {
      g.beginPath()
      const y = Math.random() * 256
      g.moveTo(0, y)
      g.bezierCurveTo(80, y - 8, 170, y + 8, 256, y)
      g.stroke()
    }
    const tex = new THREE.CanvasTexture(c)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    return tex
  }
  const waterTex = makeWaterTexture()
  water = new THREE.Mesh(
    new THREE.CircleGeometry(POND.r, 40),
    new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.82, color: 0x9fd8ff })
  )
  water.rotation.x = -Math.PI / 2
  water.position.set(POND.x, 0.06, POND.z)
  scene.add(water)

  // Low sandy bank rim (visual).
  const bankRim = new THREE.Mesh(
    new THREE.TorusGeometry(POND.r + 0.5, 0.7, 8, 40),
    new THREE.MeshLambertMaterial({ color: 0xcdb98a })
  )
  bankRim.rotation.x = -Math.PI / 2
  bankRim.position.set(POND.x, 0.1, POND.z)
  bankRim.receiveShadow = true
  scene.add(bankRim)

  // Solid bank: ring of box colliders (gap left for the bridge along +X).
  const BRIDGE_ANGLE = 0 // bridge crosses along the X axis
  const bankSegs = 16
  for (let i = 0; i < bankSegs; i++) {
    const ang = (i / bankSegs) * Math.PI * 2
    // leave a gap where the bridge enters/exits
    const da = Math.abs(((ang - BRIDGE_ANGLE + Math.PI) % (Math.PI * 2)) - Math.PI)
    const daOpp = Math.abs(((ang - Math.PI + Math.PI) % (Math.PI * 2)) - Math.PI)
    if (da < 0.4 || daOpp < 0.4) continue
    const bx = POND.x + Math.cos(ang) * (POND.r + 0.4)
    const bz = POND.z + Math.sin(ang) * (POND.r + 0.4)
    addSolid(new CANNON.Box(new CANNON.Vec3(1.6, 0.6, 0.5)), bx, 0.6, bz,
      { tag: 'isBank', rot: [0, -ang, 0] })
  }

  // Bridge deck (solid, low enough to drive onto) + rails + planks.
  const bridgeLen = (POND.r + 2) * 2
  const deckGeo = new THREE.BoxGeometry(bridgeLen, 0.3, 5)
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshLambertMaterial({ color: 0x9c6b3f }))
  deck.position.set(POND.x, 0.5, POND.z)
  deck.receiveShadow = true; deck.castShadow = true
  scene.add(deck)
  // plank lines
  const plankMat = new THREE.MeshLambertMaterial({ color: 0x855a34 })
  for (let i = 0; i < 12; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 4.8), plankMat)
    plank.position.set(POND.x - bridgeLen / 2 + 1 + i * (bridgeLen - 2) / 11, 0.5, POND.z)
    scene.add(plank)
  }
  const railMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2c })
  ;[-2.3, 2.3].forEach(rz => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(bridgeLen, 0.6, 0.15), railMat)
    rail.position.set(POND.x, 1, POND.z + rz)
    rail.castShadow = true
    scene.add(rail)
    addSolid(new CANNON.Box(new CANNON.Vec3(bridgeLen / 2, 0.4, 0.1)), POND.x, 0.9, POND.z + rz, { tag: 'isObstacle' })
  })
  addSolid(new CANNON.Box(new CANNON.Vec3(bridgeLen / 2, 0.15, 2.5)), POND.x, 0.5, POND.z, { tag: 'isBridge' })

  // ─────────────────────────────────────────────────────────────
  // Collectibles — spinning coins (some on roads)
  // ─────────────────────────────────────────────────────────────
  const coinGeo = new THREE.TorusGeometry(0.5, 0.16, 8, 16)
  const coinMat = new THREE.MeshLambertMaterial({ color: 0xffd83d, emissive: 0xffb300, emissiveIntensity: 0.5 })
  const rCoin = makeRng(211)
  for (let i = 0; i < 30; i++) {
    let x, z
    if (i < 12) {
      // on roads: pick a random point along a spoke from home to a zone
      const zone = ZONES[1 + Math.floor(rCoin() * (ZONES.length - 1))]
      const t = 0.1 + rCoin() * 0.85
      x = zone.pos.x * t
      z = zone.pos.z * t
    } else {
      const a = rCoin() * Math.PI * 2
      const rad = 12 + rCoin() * 80
      x = Math.cos(a) * rad; z = Math.sin(a) * rad
    }
    if (inPond(x, z, 3)) continue
    const mesh = new THREE.Mesh(coinGeo, coinMat)
    mesh.position.set(x, 1, z)
    mesh.rotation.x = Math.PI / 2
    scene.add(mesh)
    collectibles.push({ mesh, collected: false, baseY: 1, phase: rCoin() * Math.PI * 2 })
  }

  // ─────────────────────────────────────────────────────────────
  // Knock-around dynamic props (cones, barrels, beach balls)
  // ─────────────────────────────────────────────────────────────
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a })
  const coneStripeMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const barrelMat = new THREE.MeshLambertMaterial({ color: 0x3a6ea5 })
  const ballMats = [0xff5252, 0x42a5f5, 0xffee58].map(c => new THREE.MeshLambertMaterial({ color: c }))
  const rProp = makeRng(233)

  function addDynamicProp(kind, x, z) {
    let mesh, shape, mass
    if (kind === 'cone') {
      mesh = new THREE.Group()
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.45, 1.1, 12), coneMat)
      cone.castShadow = true
      mesh.add(cone)
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 12), coneStripeMat)
      stripe.position.y = 0.1
      mesh.add(stripe)
      // box collider (cannon Cylinder axis is fiddly; a box knocks around fine)
      shape = new CANNON.Box(new CANNON.Vec3(0.4, 0.55, 0.4))
      mass = 3
    } else if (kind === 'barrel') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 14), barrelMat)
      mesh.castShadow = true
      shape = new CANNON.Box(new CANNON.Vec3(0.5, 0.6, 0.5))
      mass = 6
    } else {
      const r = 0.6
      mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), ballMats[Math.floor(rProp() * ballMats.length)])
      mesh.castShadow = true
      shape = new CANNON.Sphere(r)
      mass = 1.2
    }
    const body = new CANNON.Body({ mass, material: ctx.propMat })
    body.addShape(shape)
    body.position.set(x, 1.2, z)
    body.isProp = true
    body.allowSleep = true
    body.sleepSpeedLimit = 0.4
    body.sleepTimeLimit = 0.6
    ctx.physicsWorld.addBody(body)
    scene.add(mesh)
    dynamicProps.push({ mesh, body, restitution: kind === 'ball' ? 0.7 : 0.1 })
  }

  const propKinds = ['cone', 'barrel', 'ball']
  let placed = 0, guard = 0
  while (placed < 18 && guard < 300) {
    guard++
    const a = rProp() * Math.PI * 2
    const rad = 12 + rProp() * 70
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad
    if (blockedSpot(x, z, 6) || inPond(x, z, 4) || onTrack(x, z, 2)) continue
    addDynamicProp(propKinds[placed % 3], x, z)
    placed++
  }

  // ─────────────────────────────────────────────────────────────
  // Ramps & jumps (static tilted boxes + wedge meshes)
  // ─────────────────────────────────────────────────────────────
  const rampMat = new THREE.MeshLambertMaterial({ color: 0xb5651d })
  const rampSpots = [[30, 30], [-28, 22], [22, -32]]
  rampSpots.forEach(([x, z], i) => {
    if (blockedSpot(x, z, 8)) return
    const w = 6, len = 8, tilt = 0.32
    // wedge mesh: a box tilted so the top face slopes up
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, len), rampMat)
    wedge.position.set(x, 0.7, z)
    const rotY = i * 1.1
    // same euler (default XYZ order) for mesh + collider so they line up
    wedge.rotation.set(-tilt, rotY, 0)
    wedge.castShadow = true; wedge.receiveShadow = true
    scene.add(wedge)
    const body = addSolid(new CANNON.Box(new CANNON.Vec3(w / 2, 0.7, len / 2)), x, 0.7, z,
      { tag: 'isRamp', rot: [-tilt, rotY, 0] })
    ramps.push({ mesh: wedge, body })
  })

  // ─────────────────────────────────────────────────────────────
  // Boost pads — glowing pulsing arrow quads
  // ─────────────────────────────────────────────────────────────
  function makePadTexture() {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    g.fillStyle = '#0a1a2a'; g.fillRect(0, 0, 128, 128)
    g.fillStyle = '#3df0ff'
    for (let k = 0; k < 3; k++) {
      const y = 20 + k * 34
      g.beginPath()
      g.moveTo(30, y); g.lineTo(98, y); g.lineTo(98, y + 8)
      g.lineTo(64, y + 26); g.lineTo(30, y + 8)
      g.closePath(); g.fill()
    }
    return new THREE.CanvasTexture(c)
  }
  const padTex = makePadTexture()
  const padSpots = [[0, -25], [25, 0], [0, 25], [-25, 0]]
  padSpots.forEach(([x, z]) => {
    const mat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.9 })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), mat)
    mesh.rotation.x = -Math.PI / 2
    // orient the arrow toward the home zone (0,0)
    mesh.rotation.z = Math.atan2(x, z)
    mesh.position.set(x, 0.08, z)
    scene.add(mesh)
    boostPads.push({ pos: new THREE.Vector3(x, 0, z), mesh, cooldown: 0 })
  })

  // ─────────────────────────────────────────────────────────────
  // Animated props: windmill, campfire, flags
  // ─────────────────────────────────────────────────────────────
  // Windmill
  {
    const wx = 62, wz = -38
    const g = new THREE.Group()
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 10, 12), new THREE.MeshLambertMaterial({ color: 0xe8e2d0 }))
    tower.position.y = 5; tower.castShadow = true
    g.add(tower)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.6, 12), new THREE.MeshLambertMaterial({ color: 0x8a3b2e }))
    cap.position.y = 10.6
    g.add(cap)
    const blades = new THREE.Group()
    blades.position.set(0, 9.5, 1.5)
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0xf5f0e0 })
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.5, 0.15), bladeMat)
      blade.position.y = 2.25
      blade.castShadow = true
      const holder = new THREE.Group()
      holder.rotation.z = k * Math.PI / 2
      holder.add(blade)
      blades.add(holder)
    }
    g.add(blades)
    g.position.set(wx, 0, wz)
    scene.add(g)
    windmills.push(blades)
    addSolid(new CANNON.Box(new CANNON.Vec3(1.3, 5, 1.3)), wx, 5, wz, { tag: 'isObstacle' })
  }

  // Campfire
  {
    const cx = 16, cz = 14
    const g = new THREE.Group()
    for (let k = 0; k < 5; k++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 6), trunkMat)
      log.rotation.z = Math.PI / 2
      log.rotation.y = k * Math.PI / 5
      log.position.y = 0.15
      g.add(log)
    }
    const flames = []
    for (let k = 0; k < 3; k++) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.4 - k * 0.1, 1.2 - k * 0.25, 8),
        new THREE.MeshBasicMaterial({ color: k === 0 ? 0xff6a00 : k === 1 ? 0xff9a1f : 0xffd23d, transparent: true, opacity: 0.85 })
      )
      flame.position.y = 0.7 + k * 0.15
      g.add(flame)
      flames.push(flame)
    }
    const light = new THREE.PointLight(0xff7a1a, 1.4, 16, 2)
    light.position.set(0, 1.2, 0)
    g.add(light)
    g.position.set(cx, 0, cz)
    scene.add(g)
    campfires.push({ flames, light, pos: new THREE.Vector3(cx, 0, cz) })
  }

  // Flags / bunting near zones (sine sway).
  ZONES.slice(1).forEach((zone, i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5), poleMat)
    pole.position.set(zone.pos.x - 9, 2.5, zone.pos.z + 6)
    pole.castShadow = true
    scene.add(pole)
    const flagMat = new THREE.MeshLambertMaterial({ color: zone.color, side: THREE.DoubleSide })
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), flagMat)
    flag.position.set(zone.pos.x - 9 + 1.1, 4.4, zone.pos.z + 6)
    scene.add(flag)
    flags.push({ mesh: flag, phase: i * 1.3 })
  })

  // ─────────────────────────────────────────────────────────────
  // Night sky: stars + fireflies
  // ─────────────────────────────────────────────────────────────
  {
    const N = 600
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      // upper hemisphere shell
      const u = Math.random(), v = Math.random() * 0.5
      const theta = u * Math.PI * 2
      const phi = Math.acos(1 - v * 2) * 0.5
      const r = 360
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.cos(phi) + 20
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0, depthWrite: false }))
    stars.frustumCulled = false
    scene.add(stars)
  }
  {
    const N = 40
    const pos = new Float32Array(N * 3)
    const data = []
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 160
      const z = (Math.random() - 0.5) * 160
      pos[i * 3] = x; pos[i * 3 + 1] = 0.6 + Math.random() * 1.5; pos[i * 3 + 2] = z
      data.push({ bx: x, bz: z, phase: Math.random() * Math.PI * 2, speed: 0.3 + Math.random() * 0.5 })
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    fireflies = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xdfff8a, size: 0.5, transparent: true, opacity: 0, depthWrite: false }))
    fireflies.frustumCulled = false
    fireflies.userData = { data, pos }
    scene.add(fireflies)
  }

  // ─────────────────────────────────────────────────────────────
  // Per-frame animation
  // ─────────────────────────────────────────────────────────────
  function tick(dt, elapsed) {
    // clouds drift + wrap
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt
      if (c.position.x > BOUND + 30) c.position.x = -BOUND - 30
    }
    // coins spin + bob
    for (const c of collectibles) {
      if (c.collected) continue
      c.mesh.rotation.z += dt * 2.5
      c.mesh.position.y = c.baseY + Math.sin(elapsed * 2 + c.phase) * 0.15
    }
    // dynamic props sync mesh ← body
    for (const p of dynamicProps) {
      p.mesh.position.copy(p.body.position)
      p.mesh.quaternion.copy(p.body.quaternion)
    }
    // windmill blades
    for (const w of windmills) w.rotation.z += dt * 0.8
    // campfire flicker
    for (const f of campfires) {
      const n = 0.7 + Math.sin(elapsed * 18) * 0.15 + Math.random() * 0.1
      f.flames.forEach((fl, k) => {
        fl.scale.y = n + k * 0.08
        fl.material.opacity = 0.7 + Math.random() * 0.25
      })
      f.light.intensity = 1.2 + Math.sin(elapsed * 20) * 0.4 + Math.random() * 0.2
    }
    // flags sway
    for (const fl of flags) {
      fl.mesh.rotation.y = Math.sin(elapsed * 2 + fl.phase) * 0.35
      fl.mesh.rotation.z = Math.sin(elapsed * 3 + fl.phase) * 0.08
    }
    // water shimmer
    if (water) {
      waterTex.offset.x = Math.sin(elapsed * 0.15) * 0.05
      waterTex.offset.y = elapsed * 0.02
    }
    // boost pad pulse
    for (const p of boostPads) {
      p.mesh.material.opacity = 0.65 + Math.sin(elapsed * 4 + p.pos.x) * 0.3
      if (p.cooldown > 0) p.cooldown -= dt
    }
    // fireflies drift + flicker (only meaningful when visible)
    if (fireflies && fireflies.material.opacity > 0.01) {
      const { data, pos } = fireflies.userData
      for (let i = 0; i < data.length; i++) {
        const d = data[i]
        pos[i * 3] = d.bx + Math.sin(elapsed * d.speed + d.phase) * 3
        pos[i * 3 + 1] = 0.8 + Math.sin(elapsed * d.speed * 1.7 + d.phase) * 0.6 + 0.6
        pos[i * 3 + 2] = d.bz + Math.cos(elapsed * d.speed * 0.8 + d.phase) * 3
      }
      fireflies.geometry.attributes.position.needsUpdate = true
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Day/night visuals (sky, fog, lamps, stars, fireflies)
  // ─────────────────────────────────────────────────────────────
  const dayTop = new THREE.Color(0x1e5fa8), nightTop = new THREE.Color(0x05060f)
  const dayBottom = new THREE.Color(0x9fd0ee), nightBottom = new THREE.Color(0x10182c)
  const daySun = new THREE.Color(0xfff3d0), duskSun = new THREE.Color(0xff8a3c)
  const _top = new THREE.Color(), _bottom = new THREE.Color(), _sun = new THREE.Color()

  function setTimeOfDay(t, sunDir, dayAmount) {
    // sky gradient
    _top.copy(nightTop).lerp(dayTop, dayAmount)
    _bottom.copy(nightBottom).lerp(dayBottom, dayAmount)
    // warm the sun tint near the horizon (dawn/dusk)
    const horizon = 1 - Math.min(1, Math.abs(sunDir.y) * 2.2)
    _sun.copy(daySun).lerp(duskSun, horizon * dayAmount)
    skyUniforms.topColor.value.copy(_top)
    skyUniforms.bottomColor.value.copy(_bottom)
    skyUniforms.sunColor.value.copy(_sun)
    skyUniforms.sunPos.value.copy(sunDir)

    scene.background && scene.background.copy(_bottom)
    if (scene.fog) scene.fog.color.copy(_bottom)

    // lamps + house glow rise at night
    const night = 1 - dayAmount
    for (const h of lampHeads) h.material.emissiveIntensity = night * 1.2
    for (const l of lampLights) l.intensity = night * 1.1

    // stars & fireflies fade in at night
    if (stars) stars.material.opacity = Math.max(0, night - 0.25) * 1.3
    if (fireflies) fireflies.material.opacity = Math.max(0, night - 0.3) * 1.4
  }

  return {
    tick, setTimeOfDay, onTrack,
    collectibles, dynamicProps, boostPads, ramps,
    campfirePos: campfires[0] ? campfires[0].pos : null,
    POND,
  }
}
