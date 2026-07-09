// ─── World builder: "Scenic Circuit" loop map ───
// A navigable rounded-rectangle circuit (4 straights + 4 quarter-circle arcs)
// with drive-in data pavilions arranged in roadside bays. Everything is
// procedural (canvas textures + geometry). Returns the same handle shape as the
// classic world (`world.js`): { tick, setTimeOfDay, onTrack, collectibles,
// boostPads, dynamicProps, ramps, loopPoints, setContent } plus the stop `zones`.
//
// Vehicle physics, camera, day/night, sound and HUD live in bruno.js and are
// map-agnostic; this file only builds geometry + colliders through ctx helpers.
import * as THREE from 'https://esm.sh/three@0.169.0'
import * as CANNON from 'https://esm.sh/cannon-es@0.20.0'

// ─── Rounded-rectangle (stadium) centerline ───
// 4 straights joined by 4 quarter-circle arcs. Each arc is tessellated into
// `arcSteps` short segments so the existing distToSegment-based onTrack() reads
// a smooth curve with no new distance math.
export function roundedLoopPath({ halfX, halfZ, cornerR, arcSteps }) {
  const ix = halfX - cornerR   // where a straight ends and its corner arc begins
  const iz = halfZ - cornerR
  const pts = []
  const addArc = (cx, cz, a0, a1) => {
    for (let i = 1; i <= arcSteps; i++) {
      const a = a0 + (a1 - a0) * (i / arcSteps)
      pts.push([cx + Math.cos(a) * cornerR, cz + Math.sin(a) * cornerR])
    }
  }
  // top straight (z = -halfZ), left → right
  pts.push([-ix, -halfZ])
  pts.push([ix, -halfZ])
  addArc(ix, -iz, -Math.PI / 2, 0)          // NE arc
  // right straight (x = +halfX), top → bottom
  pts.push([halfX, -iz])
  pts.push([halfX, iz])
  addArc(ix, iz, 0, Math.PI / 2)            // SE arc
  // bottom straight (z = +halfZ), right → left
  pts.push([ix, halfZ])
  pts.push([-ix, halfZ])
  addArc(-ix, iz, Math.PI / 2, Math.PI)     // SW arc
  // left straight (x = -halfX), bottom → top
  pts.push([-halfX, iz])
  pts.push([-halfX, -iz])
  addArc(-ix, -iz, Math.PI, Math.PI * 1.5)  // NW arc

  // The final arc lands back on the start point — drop the duplicate.
  const first = pts[0], last = pts[pts.length - 1]
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.001) pts.pop()
  return pts
}

export function buildLoopMap(scene, ctx) {
  const { BOUND, makeRng, addSolid, distToSegment, physicsWorld, propMat, makeSignTexture } = ctx

  const hex = c => '#' + c.toString(16).padStart(6, '0')

  // Animated handles / gameplay arrays (same shape as world.js).
  const clouds = []
  const collectibles = []
  const boostPads = []
  const flags = []          // arch banners that sway
  const arrows = []         // racing-line direction arrows that shimmer
  const lampHeads = []
  const lampLights = []
  const contentBoards = []  // { redraw(cms) } — filled once CMS data arrives
  let stars = null

  // ─────────────────────────────────────────────────────────────
  // Circuit geometry
  // ─────────────────────────────────────────────────────────────
  const HALF_X = 66, HALF_Z = 66, CORNER_R = 18, ARC_STEPS = 8
  const ROAD_HALF = 5                       // drivable half-width (width 10)
  const ROAD_EDGE = HALF_X + ROAD_HALF      // outer edge of a straight (~71)

  const loopPoints = roundedLoopPath({ halfX: HALF_X, halfZ: HALF_Z, cornerR: CORNER_R, arcSteps: ARC_STEPS })
  const loopSegments = []
  for (let i = 0; i < loopPoints.length; i++) {
    const [ax, az] = loopPoints[i]
    const [bx, bz] = loopPoints[(i + 1) % loopPoints.length]
    if (Math.hypot(bx - ax, bz - az) < 0.001) continue
    loopSegments.push([ax, az, bx, bz])
  }

  // Reused verbatim from the classic map's model — a curve is just more, shorter
  // segments, so no new distance math is required.
  function onTrack(x, z, pad = 0) {
    const limit = ROAD_HALF + pad
    for (const [ax, az, bx, bz] of loopSegments) {
      if (distToSegment(x, z, ax, az, bx, bz) < limit) return true
    }
    return false
  }

  // ─────────────────────────────────────────────────────────────
  // Ground (canvas grass; flat physics plane stays in bruno.js)
  // ─────────────────────────────────────────────────────────────
  function makeGroundTexture() {
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const g = c.getContext('2d')
    g.fillStyle = '#5a9e29'
    g.fillRect(0, 0, 512, 512)
    const greens = ['#63a831', '#4f8f24', '#6bb037', '#548f28']
    for (let i = 0; i < 240; i++) {
      g.fillStyle = greens[i % greens.length]
      g.globalAlpha = 0.35
      const r = 6 + Math.random() * 26
      g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2); g.fill()
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
  // Ring road: asphalt strips + dashed centerline + outer-turn curbs + arrows
  // ─────────────────────────────────────────────────────────────
  const asphaltMat = new THREE.MeshLambertMaterial({ color: 0x2b2b30 })
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2efe4 })
  const curbRedMat = new THREE.MeshLambertMaterial({ color: 0xd23b3b })
  const curbWhiteMat = new THREE.MeshLambertMaterial({ color: 0xf2efe4 })

  function arrowTexture() {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    g.clearRect(0, 0, 128, 128)
    g.fillStyle = 'rgba(255,240,150,0.95)'
    for (let k = 0; k < 2; k++) {
      const y = 30 + k * 40
      g.beginPath()
      g.moveTo(30, y); g.lineTo(98, y); g.lineTo(98, y + 10)
      g.lineTo(64, y + 30); g.lineTo(30, y + 10)
      g.closePath(); g.fill()
    }
    return new THREE.CanvasTexture(c)
  }
  const arrowTex = arrowTexture()

  loopSegments.forEach(([ax, az, bx, bz], si) => {
    const dx = bx - ax, dz = bz - az
    const len = Math.hypot(dx, dz)
    const isTurn = len < CORNER_R    // arc segments are short; straights are long
    // asphalt strip (ends overlapped so the tessellated curve reads smooth)
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_HALF * 2, 0.05, len + ROAD_HALF * 2),
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
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, Math.min(1.4, len * 0.5)), dashMat)
      dash.position.set(ax + dx * t, 0.07, az + dz * t)
      dash.rotation.y = Math.atan2(dx, dz)
      scene.add(dash)
    }

    // outward unit normal (points away from the loop centre)
    let nx = dz / len, nz = -dx / len
    const mx = (ax + bx) / 2, mz = (az + bz) / 2
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz }

    // red/white curb blocks along the OUTER edge of every turn
    if (isTurn) {
      const cbx = mx + nx * (ROAD_HALF + 0.4)
      const cbz = mz + nz * (ROAD_HALF + 0.4)
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.14, len + 1.2),
        si % 2 ? curbRedMat : curbWhiteMat
      )
      curb.position.set(cbx, 0.08, cbz)
      curb.rotation.y = Math.atan2(dx, dz)
      scene.add(curb)
    } else {
      // racing-line arrow near the middle of each straight
      const mat = new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, opacity: 0.8, depthWrite: false })
      const arrow = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), mat)
      arrow.rotation.x = -Math.PI / 2
      arrow.rotation.z = Math.atan2(dx, dz)
      arrow.position.set(mx, 0.075, mz)
      scene.add(arrow)
      arrows.push(arrow)
    }
  })

  // ─────────────────────────────────────────────────────────────
  // Start / finish plaza on the south straight + welcome name arch
  // ─────────────────────────────────────────────────────────────
  {
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
    finishTex.repeat.set(ROAD_HALF * 2, 1)
    const finish = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2, 2.4),
      new THREE.MeshBasicMaterial({ map: finishTex })
    )
    finish.rotation.x = -Math.PI / 2
    finish.position.set(0, 0.06, HALF_Z)
    scene.add(finish)

    // Name arch spanning the road.
    const archMat = new THREE.MeshLambertMaterial({ color: 0x2b2e33 })
    ;[-(ROAD_HALF + 1), ROAD_HALF + 1].forEach(px => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 8), archMat)
      post.position.set(px, 4, HALF_Z)
      post.castShadow = true
      scene.add(post)
    })
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 2.4, 0.5, 0.6), archMat)
    beam.position.set(0, 7.8, HALF_Z)
    scene.add(beam)
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 1.6),
      new THREE.MeshBasicMaterial({ map: makeSignTexture('JOVYLLE', 0x6366f1), side: THREE.DoubleSide })
    )
    banner.position.set(0, 6.9, HALF_Z)
    scene.add(banner)
    flags.push({ mesh: banner, phase: 0 })
  }

  // ─────────────────────────────────────────────────────────────
  // In-world content boards (CanvasTexture, unlit so they read at night)
  // ─────────────────────────────────────────────────────────────
  function wrapText(g, text, x, y, maxW, lh) {
    const words = String(text || '').split(/\s+/)
    let line = ''
    for (const w of words) {
      const test = line ? line + ' ' + w : w
      if (g.measureText(test).width > maxW && line) {
        g.fillText(line, x, y); y += lh; line = w
      } else line = test
    }
    if (line) { g.fillText(line, x, y); y += lh }
    return y
  }

  function chipRow(g, items, x, y, maxW, color) {
    g.font = '22px "Space Grotesk", sans-serif'
    g.textBaseline = 'middle'
    let cx = x
    let cy = y
    for (const it of items) {
      const t = String(it)
      const w = g.measureText(t).width + 26
      if (cx + w > x + maxW) { cx = x; cy += 42 }
      g.fillStyle = 'rgba(255,255,255,0.10)'
      const r = 8
      g.beginPath()
      g.moveTo(cx + r, cy); g.arcTo(cx + w, cy, cx + w, cy + 32, r)
      g.arcTo(cx + w, cy + 32, cx, cy + 32, r); g.arcTo(cx, cy + 32, cx, cy, r)
      g.arcTo(cx, cy, cx + w, cy, r); g.closePath(); g.fill()
      g.fillStyle = hex(color)
      g.fillText(t, cx + 13, cy + 17)
      cx += w + 12
    }
    return cy + 46
  }

  const HEADINGS = {
    about: 'ABOUT', projects: 'PROJECTS', highlights: 'HIGHLIGHTS',
    skills: 'SKILLS', uses: 'USES', contact: 'CONTACT',
  }

  function drawBg(g, W, H, section, color) {
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#0e1117'; g.fillRect(0, 0, W, H)
    g.fillStyle = hex(color); g.fillRect(0, 0, W, 74)
    g.fillStyle = '#ffffff'
    g.font = 'bold 48px "Space Grotesk", sans-serif'
    g.textBaseline = 'middle'; g.textAlign = 'left'
    g.fillText(HEADINGS[section] || section.toUpperCase(), 32, 40)
  }

  function drawAbout(g, W, color, d) {
    const p = d.profile || {}
    let y = 130
    g.textAlign = 'left'
    g.fillStyle = '#ffffff'; g.font = 'bold 40px "Space Grotesk", sans-serif'
    y = wrapText(g, p.title || 'Jovylle', 40, y, W - 80, 48) + 8
    if (p.availability) {
      g.font = 'bold 22px "Space Grotesk", sans-serif'
      const t = p.availability
      const w = g.measureText(t).width + 30
      g.fillStyle = '#16a34a'; g.fillRect(40, y - 6, w, 34)
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(t, 55, y + 12)
      g.textBaseline = 'alphabetic'; y += 52
    }
    g.fillStyle = '#c7ccd6'; g.font = '26px sans-serif'
    y = wrapText(g, p.short_bio || '', 40, y, W - 80, 36) + 14
    const summary = Array.isArray(d.resume?.summary) ? d.resume.summary : []
    g.fillStyle = '#9aa2b1'; g.font = '22px sans-serif'
    for (const line of summary.slice(0, 2)) y = wrapText(g, '• ' + line, 40, y, W - 80, 30) + 4
  }

  function drawHighlights(g, W, H, color, d) {
    const items = (d.highlights?.highlights || []).slice(0, 4)
    let y = 120
    g.textAlign = 'left'
    if (!items.length) { g.fillStyle = '#8b93a5'; g.font = '26px sans-serif'; g.fillText('No highlights.', 40, y); return }
    for (const h of items) {
      g.fillStyle = '#ffffff'; g.font = 'bold 30px "Space Grotesk", sans-serif'
      g.fillText((h.title || '').slice(0, 46), 40, y)
      g.fillStyle = hex(color); g.font = '20px "Space Grotesk", sans-serif'
      g.fillText(`${h.tag || ''}${h.year ? '  ·  ' + h.year : ''}`, 40, y + 30)
      g.fillStyle = '#aab1bf'; g.font = '20px sans-serif'
      wrapText(g, (h.description || '').slice(0, 130), 40, y + 58, W - 80, 26)
      y += 108
    }
  }

  function drawSkills(g, W, color, d) {
    const skills = d.resume?.skills
    let y = 120
    g.textAlign = 'left'
    if (!skills) { g.fillStyle = '#8b93a5'; g.font = '26px sans-serif'; g.fillText('No skills.', 40, y); return }
    const entries = Array.isArray(skills) ? [['', skills]] : Object.entries(skills)
    for (const [cat, items] of entries.slice(0, 4)) {
      if (cat) {
        g.fillStyle = '#ffffff'; g.font = 'bold 26px "Space Grotesk", sans-serif'
        g.textBaseline = 'alphabetic'
        g.fillText(cat.replace(/_/g, ' '), 40, y); y += 14
      }
      const list = (Array.isArray(items) ? items : [items]).map(s => typeof s === 'string' ? s : s.name || s)
      y = chipRow(g, list.slice(0, 10), 40, y, W - 80, color) + 12
    }
  }

  function drawUses(g, W, color, d) {
    const u = d.uses || {}
    const col = (title, list, x) => {
      let y = 120
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'
      g.fillStyle = hex(color); g.font = 'bold 28px "Space Grotesk", sans-serif'
      g.fillText(title, x, y); y += 40
      g.fillStyle = '#c7ccd6'; g.font = '20px sans-serif'
      for (const it of (list || []).slice(0, 5)) {
        y = wrapText(g, '• ' + (it.description || ''), x, y, W / 2 - 70, 26) + 8
      }
    }
    col('Hardware', u.hardware, 40)
    col('Software', u.software, W / 2 + 20)
  }

  function drawContact(g, W, color, d) {
    const links = d.social?.links || []
    let y = 130
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'
    if (!links.length) { g.fillStyle = '#8b93a5'; g.font = '26px sans-serif'; g.fillText('No links.', 40, y); return }
    for (const l of links.slice(0, 6)) {
      g.fillStyle = hex(color); g.font = 'bold 30px "Space Grotesk", sans-serif'
      g.fillText((l.label || l.platform || l.name || '').slice(0, 30), 40, y)
      g.fillStyle = '#9aa2b1'; g.font = '20px sans-serif'
      g.fillText((l.url || '').replace(/^mailto:/, '').slice(0, 48), 40, y + 30)
      y += 74
    }
  }

  // Projects: a card grid with async thumbnails and a CORS-safe text fallback.
  function loadThumb(url, onReady, onFail) {
    if (!url) { onFail(); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        // Probe for CORS taint before touching the real board canvas: a tainted
        // canvas throws on getImageData and would later crash the WebGL upload.
        const p = document.createElement('canvas'); p.width = p.height = 2
        const pg = p.getContext('2d'); pg.drawImage(img, 0, 0, 2, 2); pg.getImageData(0, 0, 1, 1)
        onReady(img)
      } catch (e) { onFail() }
    }
    img.onerror = () => onFail()
    img.src = url
  }

  function drawProjects(g, W, H, color, d, tex) {
    const list = (d.projects?.projects || [])
      .filter(p => p.status === 'published')
      .sort((a, b) => (b.fav === a.fav ? (b.priority_score || 0) - (a.priority_score || 0) : (b.fav ? 1 : 0) - (a.fav ? 1 : 0)))
      .slice(0, 6)
    if (!list.length) { g.fillStyle = '#8b93a5'; g.font = '26px sans-serif'; g.textAlign = 'left'; g.fillText('No projects.', 40, 130); return }

    const cols = 2, rows = 3, pad = 24, top = 90
    const cw = (W - pad * (cols + 1)) / cols
    const ch = (H - top - pad * (rows + 1)) / rows
    list.forEach((p, i) => {
      const cx = pad + (i % cols) * (cw + pad)
      const cy = top + Math.floor(i / cols) * (ch + pad)
      g.fillStyle = '#181c25'
      g.fillRect(cx, cy, cw, ch)
      g.fillStyle = hex(color); g.fillRect(cx, cy, 6, ch)
      const thumbW = ch * 1.4
      const textX = cx + thumbW + 20
      // thumbnail placeholder
      g.fillStyle = '#242a36'; g.fillRect(cx + 14, cy + 14, thumbW - 8, ch - 28)
      g.fillStyle = '#ffffff'; g.font = 'bold 24px "Space Grotesk", sans-serif'
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'
      g.fillText((p.title || p.name || '').slice(0, 22), textX, cy + 34)
      g.fillStyle = '#9aa2b1'; g.font = '17px sans-serif'
      g.fillText((p.tech || []).slice(0, 4).join(' · '), textX, cy + 60)
      const hasLive = (p.links || []).some(l => /live|demo/i.test(l.label || ''))
      g.fillStyle = hex(color); g.font = 'bold 16px "Space Grotesk", sans-serif'
      g.fillText(hasLive ? '▶ Live' : (p.repo ? '‹ › Repo' : ''), textX, cy + ch - 18)
      // async thumbnail (CORS-safe: draws only when the probe passes)
      loadThumb(p.thumbnail, img => {
        g.drawImage(img, cx + 14, cy + 14, thumbW - 8, ch - 28)
        tex.needsUpdate = true
      }, () => { /* keep the text-only card */ })
    })
  }

  function makeContentBoard(section, color, worldW) {
    const W = 1024, H = 448
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')
    const tex = new THREE.CanvasTexture(c)
    tex.anisotropy = 4
    const boardW = worldW
    const boardH = boardW * H / W
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(boardW, boardH), new THREE.MeshBasicMaterial({ map: tex }))
    function redraw(d) {
      drawBg(g, W, H, section, color)
      if (!d) {
        g.fillStyle = '#8b93a5'; g.font = '28px sans-serif'; g.textAlign = 'left'
        g.fillText('Loading…', 40, 140)
        tex.needsUpdate = true; return
      }
      switch (section) {
        case 'about': drawAbout(g, W, color, d); break
        case 'projects': drawProjects(g, W, H, color, d, tex); break
        case 'highlights': drawHighlights(g, W, H, color, d); break
        case 'skills': drawSkills(g, W, color, d); break
        case 'uses': drawUses(g, W, color, d); break
        case 'contact': drawContact(g, W, color, d); break
      }
      tex.needsUpdate = true
    }
    redraw(null)
    contentBoards.push({ redraw })
    return { mesh, boardH }
  }

  // ─────────────────────────────────────────────────────────────
  // Drive-in pavilions (open-front; 3 wall colliders + roof; content boards)
  // ─────────────────────────────────────────────────────────────
  const PAV_W = 13, PAV_D = 10, PAV_H = 5.5, PAV_T = 0.5
  const PAV_GAP = 6
  const FRONT_DIST = ROAD_EDGE + PAV_GAP           // opening plane distance
  const CENTER_DIST = FRONT_DIST + PAV_D / 2       // pavilion centre distance
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xe7e2d6 })
  const roofMatShared = new THREE.MeshLambertMaterial({ color: 0x8a3b2e })
  const apronMat = new THREE.MeshLambertMaterial({ color: 0x5c6068 })

  // side → outward normal (n), along-straight tangent (t), group rotation.
  const SIDES = {
    N: { n: [0, -1], t: [1, 0], rotY: Math.PI },
    S: { n: [0, 1], t: [1, 0], rotY: 0 },
    E: { n: [1, 0], t: [0, 1], rotY: Math.PI / 2 },
    W: { n: [-1, 0], t: [0, 1], rotY: -Math.PI / 2 },
  }
  const rot2 = (lx, lz, th) => [lx * Math.cos(th) + lz * Math.sin(th), -lx * Math.sin(th) + lz * Math.cos(th)]

  const pavilionCenters = []

  function buildPavilion(stop) {
    const { n, t, rotY } = SIDES[stop.side]
    const cx = n[0] * CENTER_DIST + t[0] * stop.along
    const cz = n[1] * CENTER_DIST + t[1] * stop.along
    pavilionCenters.push([cx, cz])

    const group = new THREE.Group()
    group.position.set(cx, 0, cz)
    group.rotation.y = rotY

    // Walls (opening faces local −z, toward the ring). Roof + board local.
    const back = new THREE.Mesh(new THREE.BoxGeometry(PAV_W, PAV_H, PAV_T), wallMat)
    back.position.set(0, PAV_H / 2, PAV_D / 2); back.castShadow = true; back.receiveShadow = true
    group.add(back)
    ;[-PAV_W / 2, PAV_W / 2].forEach(lx => {
      const side = new THREE.Mesh(new THREE.BoxGeometry(PAV_T, PAV_H, PAV_D), wallMat)
      side.position.set(lx, PAV_H / 2, 0); side.castShadow = true
      group.add(side)
    })
    const roof = new THREE.Mesh(new THREE.BoxGeometry(PAV_W + 0.6, PAV_T, PAV_D + 0.6), roofMatShared)
    roof.position.set(0, PAV_H + PAV_T / 2, 0); roof.castShadow = true
    group.add(roof)

    // Floor apron + driveway spur (flat; from ring outer edge to back wall).
    const floorLen = (CENTER_DIST + PAV_D / 2) - (CENTER_DIST - PAV_D / 2 - PAV_GAP - ROAD_HALF)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(PAV_W, 0.04, floorLen), apronMat)
    // local z: back at +D/2, ring edge at -(FRONT_DIST-ROAD_EDGE + D/2) → centre between them
    const ringLocalZ = -(PAV_D / 2 + PAV_GAP + ROAD_HALF)
    floor.position.set(0, 0.02, (PAV_D / 2 + ringLocalZ) / 2)
    floor.receiveShadow = true
    group.add(floor)

    // Entrance name sign, above the opening, facing the ring.
    const signPost = new THREE.MeshLambertMaterial({ color: 0x2b2e33 })
    ;[-PAV_W / 2, PAV_W / 2].forEach(lx => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, PAV_H + 1.4), signPost)
      post.position.set(lx, (PAV_H + 1.4) / 2, -PAV_D / 2 - 0.5)
      group.add(post)
    })
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(PAV_W - 1, 1.5),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(stop.label, stop.color) })
    )
    sign.position.set(0, PAV_H + 0.4, -PAV_D / 2 - 0.5)
    sign.rotation.y = Math.PI      // face local −z (toward the ring)
    group.add(sign)

    // Interior content board on the back wall, facing the entering driver.
    const board = makeContentBoard(stop.id, stop.color, PAV_W - 1.5)
    board.mesh.position.set(0, PAV_H * 0.52, PAV_D / 2 - PAV_T - 0.06)
    board.mesh.rotation.y = Math.PI
    group.add(board.mesh)

    scene.add(group)

    // Wall colliders (world space; roof + front left open so the car drives in).
    const [bx, bz] = rot2(0, PAV_D / 2, rotY)
    addSolid(new CANNON.Box(new CANNON.Vec3(PAV_W / 2, PAV_H / 2, PAV_T / 2)), cx + bx, PAV_H / 2, cz + bz, { tag: 'isObstacle', rot: [0, rotY, 0] })
    ;[-PAV_W / 2, PAV_W / 2].forEach(lx => {
      const [ox, oz] = rot2(lx, 0, rotY)
      addSolid(new CANNON.Box(new CANNON.Vec3(PAV_T / 2, PAV_H / 2, PAV_D / 2)), cx + ox, PAV_H / 2, cz + oz, { tag: 'isObstacle', rot: [0, rotY, 0] })
    })

    return new THREE.Vector3(cx, 0, cz)
  }

  // Stops in lap order around the ring (colours extend the classic palette).
  const STOPS = [
    { id: 'about', label: 'ABOUT', side: 'S', along: -26, color: 0x6366f1, section: 'about' },
    { id: 'skills', label: 'SKILLS', side: 'W', along: -24, color: 0xec4899, section: 'skills' },
    { id: 'uses', label: 'USES', side: 'W', along: 24, color: 0x8b5cf6, section: 'uses' },
    { id: 'projects', label: 'PROJECTS', side: 'N', along: 0, color: 0xf59e0b, section: 'projects' },
    { id: 'highlights', label: 'HIGHLIGHTS', side: 'E', along: -24, color: 0x10b981, section: 'highlights' },
    { id: 'contact', label: 'CONTACT', side: 'E', along: 24, color: 0xf97316, section: 'contact' },
  ]
  const zones = STOPS.map(s => {
    const pos = buildPavilion(s)
    return { id: s.id, label: s.label.charAt(0) + s.label.slice(1).toLowerCase(), pos, color: s.color }
  })

  function inPavilion(x, z, pad = 0) {
    for (const [px, pz] of pavilionCenters) {
      if (Math.hypot(x - px, z - pz) < PAV_D / 2 + PAV_GAP + pad) return true
    }
    return false
  }

  // ─────────────────────────────────────────────────────────────
  // Lampposts along the straights (glow at night)
  // ─────────────────────────────────────────────────────────────
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4b })
  const lampGeo = new THREE.CylinderGeometry(0.14, 0.14, 5, 8)
  const lampHeadGeo = new THREE.SphereGeometry(0.4, 10, 8)
  ;[[0, -1], [0, 1], [1, 0], [-1, 0]].forEach(([nx, nz]) => {
    ;[-30, 30].forEach(along => {
      const x = nx * (ROAD_EDGE + 2) + (nx ? 0 : along)
      const z = nz * (ROAD_EDGE + 2) + (nz ? 0 : along)
      if (inPavilion(x, z, 2)) return
      const pole = new THREE.Mesh(lampGeo, poleMat)
      pole.position.set(x, 2.5, z); pole.castShadow = true
      scene.add(pole)
      const headMat = new THREE.MeshLambertMaterial({ color: 0xfff3c0, emissive: 0xffcc55, emissiveIntensity: 0 })
      const head = new THREE.Mesh(lampHeadGeo, headMat)
      head.position.set(x, 5.1, z)
      scene.add(head); lampHeads.push(head)
      const light = new THREE.PointLight(0xffcc66, 0, 16, 2)
      light.position.set(x, 5, z)
      scene.add(light); lampLights.push(light)
      addSolid(new CANNON.Box(new CANNON.Vec3(0.22, 2.5, 0.22)), x, 2.5, z, { tag: 'isObstacle' })
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Light scatter (road + turns + pavilions kept clear; centre spawn clear)
  // ─────────────────────────────────────────────────────────────
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8b5e3c })
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3a9440 })
  const treeTrunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.6)
  const canopyGeo = new THREE.IcosahedronGeometry(1.7, 0)
  function clearSpot(x, z) {
    if (onTrack(x, z, 3)) return false
    if (inPavilion(x, z, 3)) return false
    if (Math.hypot(x, z) < 10) return false          // keep the spawn area clear
    return true
  }
  const rTree = makeRng(42)
  for (let i = 0; i < 26; i++) {
    const x = (rTree() - 0.5) * 180, z = (rTree() - 0.5) * 180
    if (Math.abs(x) > 94 || Math.abs(z) > 94 || !clearSpot(x, z)) continue
    const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat)
    trunk.position.set(x, 0.8, z); trunk.castShadow = true
    scene.add(trunk)
    const canopy = new THREE.Mesh(canopyGeo, canopyMat)
    canopy.position.set(x, 3, z); canopy.scale.set(1, 0.9, 1); canopy.castShadow = true
    scene.add(canopy)
    addSolid(new CANNON.Box(new CANNON.Vec3(0.42, 1.2, 0.42)), x, 1.2, z, { tag: 'isObstacle' })
  }
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x9ca3af, flatShading: true })
  const rRock = makeRng(59)
  for (let i = 0; i < 14; i++) {
    const x = (rRock() - 0.5) * 180, z = (rRock() - 0.5) * 180
    if (Math.abs(x) > 94 || Math.abs(z) > 94 || !clearSpot(x, z)) continue
    const r = 0.5 + rRock() * 0.9
    const rock = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4), rockMat)
    rock.position.set(x, r * 0.6, z); rock.castShadow = true
    scene.add(rock)
    addSolid(new CANNON.Sphere(r), x, r * 0.6, z, { tag: 'isObstacle' })
  }

  // ─────────────────────────────────────────────────────────────
  // Reward loop: coins spaced along the ring + boost pads on straights
  // ─────────────────────────────────────────────────────────────
  const coinGeo = new THREE.TorusGeometry(0.5, 0.16, 8, 16)
  const coinMat = new THREE.MeshLambertMaterial({ color: 0xffd83d, emissive: 0xffb300, emissiveIntensity: 0.5 })
  loopPoints.forEach((pt, i) => {
    if (i % 2 !== 0) return
    const mesh = new THREE.Mesh(coinGeo, coinMat)
    mesh.position.set(pt[0], 1, pt[1])
    mesh.rotation.x = Math.PI / 2
    scene.add(mesh)
    collectibles.push({ mesh, collected: false, baseY: 1, phase: i * 0.5 })
  })

  function padTexture() {
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
  const padTex = padTexture()
  // one pad mid-straight, arrow pointing along the lap direction
  ;[[0, -HALF_Z, 1, 0], [HALF_X, 0, 0, 1], [-HALF_X, 0, 0, -1]].forEach(([x, z, dx, dz]) => {
    const mat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.9 })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.rotation.z = Math.atan2(dx, dz)
    mesh.position.set(x, 0.08, z)
    scene.add(mesh)
    boostPads.push({ pos: new THREE.Vector3(x, 0, z), mesh, cooldown: 0 })
  })

  // ─────────────────────────────────────────────────────────────
  // Sky dome + clouds + stars (ported from world.js so day/night reads right)
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
      side: THREE.BackSide, depthWrite: false, uniforms: skyUniforms,
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

  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  const puffGeo = new THREE.SphereGeometry(1, 8, 6)
  const rCloud = makeRng(23)
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group()
    const puffs = 3 + Math.floor(rCloud() * 4)
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(puffGeo, cloudMat)
      puff.position.set((rCloud() - 0.5) * 8, (rCloud() - 0.5) * 2, (rCloud() - 0.5) * 5)
      const s = 2 + rCloud() * 3
      puff.scale.set(s, s * 0.6, s)
      g.add(puff)
    }
    g.position.set((rCloud() - 0.5) * 180, 46 + rCloud() * 24, (rCloud() - 0.5) * 180)
    g.userData.speed = 0.6 + rCloud() * 0.8
    scene.add(g); clouds.push(g)
  }

  {
    const N = 600
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
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

  // ─────────────────────────────────────────────────────────────
  // Per-frame animation
  // ─────────────────────────────────────────────────────────────
  function tick(dt, elapsed) {
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt
      if (c.position.x > BOUND + 30) c.position.x = -BOUND - 30
    }
    for (const c of collectibles) {
      if (c.collected) continue
      c.mesh.rotation.z += dt * 2.5
      c.mesh.position.y = c.baseY + Math.sin(elapsed * 2 + c.phase) * 0.15
    }
    for (const a of arrows) a.material.opacity = 0.55 + Math.sin(elapsed * 3 + a.position.x) * 0.3
    for (const p of boostPads) {
      p.mesh.material.opacity = 0.65 + Math.sin(elapsed * 4 + p.pos.x) * 0.3
      if (p.cooldown > 0) p.cooldown -= dt
    }
    for (const fl of flags) {
      fl.mesh.rotation.z = Math.sin(elapsed * 2 + fl.phase) * 0.05
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Day/night visuals (sky, fog, lamps, stars)
  // ─────────────────────────────────────────────────────────────
  const dayTop = new THREE.Color(0x1e5fa8), nightTop = new THREE.Color(0x05060f)
  const dayBottom = new THREE.Color(0x9fd0ee), nightBottom = new THREE.Color(0x10182c)
  const daySun = new THREE.Color(0xfff3d0), duskSun = new THREE.Color(0xff8a3c)
  const _top = new THREE.Color(), _bottom = new THREE.Color(), _sun = new THREE.Color()

  function setTimeOfDay(t, sunDir, dayAmount) {
    _top.copy(nightTop).lerp(dayTop, dayAmount)
    _bottom.copy(nightBottom).lerp(dayBottom, dayAmount)
    const horizon = 1 - Math.min(1, Math.abs(sunDir.y) * 2.2)
    _sun.copy(daySun).lerp(duskSun, horizon * dayAmount)
    skyUniforms.topColor.value.copy(_top)
    skyUniforms.bottomColor.value.copy(_bottom)
    skyUniforms.sunColor.value.copy(_sun)
    skyUniforms.sunPos.value.copy(sunDir)
    scene.background && scene.background.copy(_bottom)
    if (scene.fog) scene.fog.color.copy(_bottom)
    const night = 1 - dayAmount
    for (const h of lampHeads) h.material.emissiveIntensity = night * 1.2
    for (const l of lampLights) l.intensity = night * 1.1
    if (stars) stars.material.opacity = Math.max(0, night - 0.25) * 1.3
  }

  // Fill the in-world boards once CMS data arrives (built before data loads).
  function setContent(cms) {
    for (const b of contentBoards) b.redraw(cms || {})
  }

  return {
    zones,
    world: {
      tick, setTimeOfDay, onTrack, setContent,
      collectibles, boostPads, dynamicProps: [], ramps: [],
      loopPoints,
    },
  }
}
