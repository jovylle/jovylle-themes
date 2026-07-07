const CMS_BASE = 'https://content.jovylle.com'

const THEMES = [
  { id: 'default', label: 'Default', icon: 'bx-palette' },
  { id: 'windows-xp', label: 'Windows XP', icon: 'bx-windows' },
  { id: 'newspaper', label: 'Newspaper', icon: 'bx-news' },
  { id: 'parallax', label: 'Parallax', icon: 'bx-layer' },
  { id: 'synthwave', label: 'Synthwave', icon: 'bx-music' },
]

const STORAGE_KEY = 'jovylle-theme'

// ─── Init ───
const saved = localStorage.getItem(STORAGE_KEY) || 'windows-xp'
document.documentElement.setAttribute('data-theme', saved)
renderSwitcher(saved)

fetchAllCmsData().then(renderContent).catch((err) => {
  document.getElementById('content').innerHTML =
    `<div class="error">Failed to load CMS data: ${err.message}</div>`
})

// ─── Theme switcher ───
function renderSwitcher(activeId) {
  const el = document.getElementById('theme-switcher')
  el.innerHTML = `
    <div class="ts-wrap">
      <button class="ts-trigger" onclick="toggleDropdown()">
        <i class="bx ${THEMES.find(t => t.id === activeId)?.icon || 'bx-palette'}"></i>
        <span>${THEMES.find(t => t.id === activeId)?.label || 'Theme'}</span>
        <i class="bx bx-chevron-down"></i>
      </button>
      <div class="ts-dropdown" id="ts-dropdown">
        ${THEMES.map(t => `
          <button class="ts-opt${t.id === activeId ? ' ts-active' : ''}"
                  onclick="setTheme('${t.id}')">
            <i class="bx ${t.icon}"></i> ${t.label}
          </button>
        `).join('')}
      </div>
    </div>
  `
}

window.toggleDropdown = function () {
  document.getElementById('ts-dropdown').classList.toggle('ts-open')
}

window.setTheme = function (id) {
  document.documentElement.setAttribute('data-theme', id)
  localStorage.setItem(STORAGE_KEY, id)
  document.getElementById('ts-dropdown').classList.remove('ts-open')
  renderSwitcher(id)
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.ts-wrap')) {
    document.getElementById('ts-dropdown')?.classList.remove('ts-open')
  }
})

// ─── CMS fetch ───
async function fetchJson(path) {
  const res = await fetch(`${CMS_BASE}/data/${path}`)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

async function fetchAllCmsData() {
  const [projects, highlights, resume, profile, homepage, social, uses] = await Promise.all([
    fetchJson('personal-projects.json').catch(() => null),
    fetchJson('highlights.json').catch(() => null),
    fetchJson('resume.json').catch(() => null),
    fetchJson('profile.json').catch(() => null),
    fetchJson('homepage.json').catch(() => null),
    fetchJson('social.json').catch(() => null),
    fetchJson('uses.json').catch(() => null),
  ])
  return { projects, highlights, resume, profile, homepage, social, uses }
}

// ─── Render ───
function renderContent(data) {
  const content = document.getElementById('content')
  const sections = []

  // Profile
  if (data.profile) {
    sections.push(`
      <section class="section">
        <div class="profile-card">
          <h2>${esc(data.profile.title || '')}</h2>
          <p>${esc(data.profile.short_bio || '')}</p>
          <p style="font-size:12px;margin-top:8px;opacity:0.6">${esc(data.profile.availability || '')}</p>
        </div>
      </section>
    `)
  }

  // Personal Projects
  const projs = data.projects?.projects?.filter(p => p.status === 'published') || []
  if (projs.length) {
    const top = projs.slice(0, 12)
    sections.push(`
      <section class="section">
        <h2 class="section-title">Projects (${projs.length})</h2>
        <div class="grid-2">
          ${top.map(p => `
            <div class="project-card">
              <h3>${esc(p.title)}</h3>
              <p>${esc(p.description || '').slice(0, 120)}</p>
              <div style="margin-top:6px">
                ${(p.tech || []).map(t => `<span class="tech-tag">${esc(t)}</span>`).join('')}
              </div>
              <div style="margin-top:6px;font-size:11px;opacity:0.6">
                Score: ${p.priority_score ?? '—'}
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    `)
  }

  // Highlights
  const hls = data.highlights?.highlights || []
  if (hls.length) {
    sections.push(`
      <section class="section">
        <h2 class="section-title">Highlights</h2>
        <div class="grid-2">
          ${hls.map(h => `
            <div class="highlight-card">
              <strong>${esc(h.title)}</strong>
              <span style="font-size:11px;opacity:0.6;margin-left:6px">${esc(h.tag || '')} ${h.year || ''}</span>
              <p style="font-size:12px;margin-top:4px">${esc(h.description || '').slice(0, 150)}</p>
              <div style="margin-top:4px">
                ${(h.technologies || []).map(t => `<span class="tech-tag">${esc(t)}</span>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    `)
  }

  // Resume summary
  if (data.resume?.summary) {
    const lines = Array.isArray(data.resume.summary) ? data.resume.summary : [data.resume.summary]
    sections.push(`
      <section class="section">
        <h2 class="section-title">Resume</h2>
        <div class="resume-summary">
          ${lines.map(l => `<p>${esc(l)}</p>`).join('')}
        </div>
        ${data.resume.skills ? renderSkills(data.resume.skills) : ''}
        ${data.resume.timeline ? renderTimeline(data.resume.timeline) : ''}
      </section>
    `)
  }

  // Uses
  if (data.uses?.hardware?.length || data.uses?.software?.length) {
    sections.push(`
      <section class="section">
        <h2 class="section-title">Uses</h2>
        <div class="grid-2">
          <div>
            <h3 style="font-size:14px;margin-bottom:8px">Hardware</h3>
            <ul style="font-size:12px;line-height:1.8;list-style:none">
              ${(data.uses.hardware || []).map(h => `<li>• ${esc(h.description)}</li>`).join('')}
            </ul>
          </div>
          <div>
            <h3 style="font-size:14px;margin-bottom:8px">Software</h3>
            <ul style="font-size:12px;line-height:1.8;list-style:none">
              ${(data.uses.software || []).map(s => `<li>• ${esc(s.description)}</li>`).join('')}
            </ul>
          </div>
        </div>
      </section>
    `)
  }

  // Social
  if (data.social?.links?.length) {
    sections.push(`
      <section class="section">
        <h2 class="section-title">Connect</h2>
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding:8px 0">
          ${data.social.links.map(l => `
            <a href="${esc(l.url)}" target="_blank" rel="noopener"
               style="font-size:13px">${esc(l.label)}</a>
          `).join('')}
        </div>
      </section>
    `)
  }

  content.innerHTML = sections.join('\n') || '<div class="error">No data loaded.</div>'
}

function renderSkills(skills) {
  return Object.entries(skills).map(([cat, items]) => `
    <div style="margin-top:12px">
      <strong style="font-size:12px;text-transform:uppercase;opacity:0.7">${cat.replace(/_/g, ' ')}</strong>
      <div style="font-size:12px;margin-top:4px">${items.join(', ')}</div>
    </div>
  `).join('')
}

function renderTimeline(timeline) {
  return `<div style="margin-top:16px">
    ${timeline.map(t => `
      <div style="padding:10px 0;border-bottom:1px solid;border-color:inherit">
        <strong style="font-size:13px">${esc(t.role)}</strong>
        <span style="font-size:11px;opacity:0.6"> · ${esc(t.company)}</span>
        <span style="font-size:11px;opacity:0.5;float:right">${esc(t.range || '')}</span>
        <p style="font-size:12px;margin-top:2px">${esc(t.short_description || '')}</p>
      </div>
    `).join('')}
  </div>`
}

function esc(str) {
  if (!str) return ''
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}
