import { fetchAllCmsData, esc } from '../../shared/cms.js'

const desktop = document.getElementById('desktop')
const iconLayer = document.getElementById('desktop-icons')
const taskButtons = document.getElementById('task-buttons')
const startBtn = document.getElementById('start-btn')
const startMenu = document.getElementById('start-menu')

let zTop = 10
const windows = new Map() // id -> { el, taskBtn, def }
let cascade = 0

// ─── Clock ───
function tickClock() {
  const el = document.getElementById('clock')
  if (!el) return
  const now = new Date()
  let h = now.getHours()
  const m = String(now.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  el.textContent = `${h}:${m} ${ampm}`
}
setInterval(tickClock, 1000)
tickClock()

// ─── Window management ───
function focusWindow(id) {
  windows.forEach((w, wid) => {
    const active = wid === id
    w.el.classList.toggle('blur', !active)
    w.taskBtn.classList.toggle('active', active)
  })
  const w = windows.get(id)
  if (w) w.el.style.zIndex = ++zTop
}

function openWindow(def) {
  const existing = windows.get(def.id)
  if (existing) {
    existing.el.classList.remove('min')
    focusWindow(def.id)
    return
  }

  const el = document.createElement('div')
  el.className = 'xp-window'
  const offset = (cascade++ % 6) * 26
  const w = def.w || 460
  const x = def.x ?? Math.min(120 + offset, window.innerWidth - w - 20)
  const y = def.y ?? 40 + offset
  el.style.left = x + 'px'
  el.style.top = y + 'px'
  el.style.width = w + 'px'

  el.innerHTML = `
    <div class="xp-titlebar">
      <i class="bx ${def.icon} xp-tb-icon"></i>
      <div class="xp-tb-title">${esc(def.title)}</div>
      <div class="xp-ctrls">
        <div class="xp-ctrl min" title="Minimize">_</div>
        <div class="xp-ctrl close" title="Close">✕</div>
      </div>
    </div>
    <div class="xp-body">${def.html}</div>
  `
  desktop.appendChild(el)

  const taskBtn = document.createElement('div')
  taskBtn.className = 'task-btn'
  taskBtn.innerHTML = `<i class="bx ${def.icon} tb-ic"></i><span>${esc(def.title)}</span>`
  taskButtons.appendChild(taskBtn)

  windows.set(def.id, { el, taskBtn, def })

  // interactions
  el.addEventListener('mousedown', () => focusWindow(def.id))
  el.querySelector('.xp-ctrl.close').addEventListener('click', (e) => {
    e.stopPropagation(); closeWindow(def.id)
  })
  el.querySelector('.xp-ctrl.min').addEventListener('click', (e) => {
    e.stopPropagation(); el.classList.add('min')
    taskBtn.classList.remove('active')
  })
  taskBtn.addEventListener('click', () => {
    if (el.classList.contains('min')) {
      el.classList.remove('min'); focusWindow(def.id)
    } else if (taskBtn.classList.contains('active')) {
      el.classList.add('min'); taskBtn.classList.remove('active')
    } else {
      focusWindow(def.id)
    }
  })

  makeDraggable(el, el.querySelector('.xp-titlebar'))
  focusWindow(def.id)
}

function closeWindow(id) {
  const w = windows.get(id)
  if (!w) return
  w.el.remove()
  w.taskBtn.remove()
  windows.delete(id)
}

function makeDraggable(el, handle) {
  let sx, sy, ox, oy, dragging = false
  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('.xp-ctrl')) return
    dragging = true
    sx = e.clientX; sy = e.clientY
    ox = el.offsetLeft; oy = el.offsetTop
    e.preventDefault()
  })
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return
    let nx = ox + (e.clientX - sx)
    let ny = oy + (e.clientY - sy)
    ny = Math.max(0, Math.min(ny, window.innerHeight - 60))
    nx = Math.max(-el.offsetWidth + 80, Math.min(nx, window.innerWidth - 80))
    el.style.left = nx + 'px'
    el.style.top = ny + 'px'
  })
  window.addEventListener('mouseup', () => { dragging = false })
}

// ─── Start menu ───
function toggleStart(force) {
  const open = force ?? !startMenu.classList.contains('open')
  startMenu.classList.toggle('open', open)
  startBtn.classList.toggle('active', open)
}
startBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleStart() })
document.addEventListener('click', (e) => {
  if (!e.target.closest('#start-menu') && !e.target.closest('#start-btn')) toggleStart(false)
})

// ─── Content builders ───
function buildWindowDefs(data) {
  const defs = []

  if (data.profile) {
    const p = data.profile
    defs.push({
      id: 'about', title: 'About Me', icon: 'bx-user', w: 380,
      html: `
        <div class="xp-profile-head">
          <div class="avatar"><i class="bx bx-user"></i></div>
          <h3>${esc(p.title || '')}</h3>
        </div>
        <p>${esc(p.short_bio || '')}</p>
        <p class="xp-muted">${esc(p.availability || '')}</p>
      `,
    })
  }

  const projs = data.projects?.projects?.filter(p => p.status === 'published') || []
  if (projs.length) {
    defs.push({
      id: 'projects', title: `My Projects (${projs.length})`, icon: 'bx-folder', w: 520,
      html: `<ul class="xp-list">${projs.slice(0, 20).map(p => `
        <li>
          <strong>${esc(p.title)}</strong>
          ${p.fav ? '<i class="bx bxs-star" style="color:#f0a500"></i>' : ''}
          <p>${esc(p.description || '').slice(0, 160)}</p>
          <div>${(p.tech || []).map(t => `<span class="xp-tag">${esc(t)}</span>`).join('')}</div>
          ${(p.links || []).length ? `<div style="margin-top:6px">${p.links.map(l =>
            `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' · ')}</div>` : ''}
        </li>`).join('')}</ul>`,
    })
  }

  const hls = data.highlights?.highlights || []
  if (hls.length) {
    defs.push({
      id: 'highlights', title: 'Highlights', icon: 'bx-award', w: 480,
      html: `<ul class="xp-list">${hls.map(h => `
        <li>
          <strong>${esc(h.title)}</strong>
          <span class="xp-muted">${esc(h.tag || '')} ${h.year || ''}</span>
          <p>${esc(h.description || '').slice(0, 180)}</p>
          <div>${(h.technologies || []).map(t => `<span class="xp-tag">${esc(t)}</span>`).join('')}</div>
        </li>`).join('')}</ul>`,
    })
  }

  if (data.resume?.summary) {
    const lines = Array.isArray(data.resume.summary) ? data.resume.summary : [data.resume.summary]
    const skills = data.resume.skills
      ? Object.entries(data.resume.skills).map(([cat, items]) =>
          `<p><strong>${esc(cat.replace(/_/g, ' '))}:</strong> ${esc(items.join(', '))}</p>`).join('')
      : ''
    const timeline = (data.resume.timeline || []).map(t => `
      <li>
        <strong>${esc(t.role)}</strong> <span class="xp-muted">· ${esc(t.company)} · ${esc(t.range || '')}</span>
        <p>${esc(t.short_description || '')}</p>
      </li>`).join('')
    defs.push({
      id: 'resume', title: 'Résumé', icon: 'bx-file', w: 500,
      html: `
        <h3>Summary</h3>
        ${lines.map(l => `<p>${esc(l)}</p>`).join('')}
        ${skills ? `<h3 style="margin-top:10px">Skills</h3>${skills}` : ''}
        ${timeline ? `<h3 style="margin-top:10px">Experience</h3><ul class="xp-list">${timeline}</ul>` : ''}
      `,
    })
  }

  if (data.uses?.hardware?.length || data.uses?.software?.length) {
    const list = arr => `<ul class="xp-list">${(arr || []).map(i =>
      `<li>${esc(i.description)}</li>`).join('')}</ul>`
    defs.push({
      id: 'uses', title: 'Uses', icon: 'bx-desktop', w: 460,
      html: `
        <h3>Hardware</h3>${list(data.uses.hardware)}
        <h3 style="margin-top:10px">Software</h3>${list(data.uses.software)}
      `,
    })
  }

  if (data.social?.links?.length) {
    defs.push({
      id: 'connect', title: 'Connect', icon: 'bx-globe', w: 340,
      html: `<ul class="xp-list">${data.social.links.map(l =>
        `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join('')}</ul>`,
    })
  }

  return defs
}

function renderDesktopIcons(defs) {
  iconLayer.innerHTML = ''
  defs.forEach(def => {
    const ic = document.createElement('div')
    ic.className = 'desk-icon'
    ic.innerHTML = `
      <div class="di-glyph"><i class="bx ${def.icon}"></i></div>
      <div class="di-label">${esc(def.title)}</div>
    `
    ic.addEventListener('click', () => {
      iconLayer.querySelectorAll('.desk-icon').forEach(n => n.classList.remove('selected'))
      ic.classList.add('selected')
    })
    ic.addEventListener('dblclick', () => openWindow(def))
    iconLayer.appendChild(ic)
  })
  // deselect on empty desktop click
  desktop.addEventListener('mousedown', (e) => {
    if (e.target === desktop || e.target === iconLayer) {
      iconLayer.querySelectorAll('.desk-icon').forEach(n => n.classList.remove('selected'))
    }
  })
}

function renderStartMenu(defs, profile) {
  const name = profile?.title || 'Jovylle'
  startMenu.innerHTML = `
    <div class="sm-header">
      <div class="sm-avatar"><i class="bx bx-user"></i></div>
      <span>${esc(name)}</span>
    </div>
    <div class="sm-items">
      ${defs.map(d => `
        <div class="sm-item" data-open="${d.id}">
          <span class="sm-ic"><i class="bx ${d.icon}"></i></span>
          <strong>${esc(d.title)}</strong>
        </div>`).join('')}
    </div>
    <div class="sm-footer">
      <div class="sm-item" data-action="home">
        <span class="sm-ic"><i class="bx bx-log-out" style="color:#fff"></i></span>
        <span>Themes…</span>
      </div>
    </div>
  `
  startMenu.querySelectorAll('.sm-item[data-open]').forEach(item => {
    item.addEventListener('click', () => {
      const def = defs.find(d => d.id === item.dataset.open)
      if (def) openWindow(def)
      toggleStart(false)
    })
  })
  startMenu.querySelector('[data-action="home"]').addEventListener('click', () => {
    window.location.href = '../../index.html'
  })
}

// ─── Boot ───
fetchAllCmsData().then(data => {
  const defs = buildWindowDefs(data)
  renderDesktopIcons(defs)
  renderStartMenu(defs, data.profile)
  // greet: open the About window on load
  const about = defs.find(d => d.id === 'about') || defs[0]
  if (about) openWindow({ ...about, x: 160, y: 70 })
}).catch(err => {
  openWindow({
    id: 'err', title: 'Error', icon: 'bx-error', w: 360, x: 160, y: 80,
    html: `<p style="color:#c00">Failed to load CMS data:<br>${esc(err.message)}</p>`,
  })
})
