// Standard portfolio render, shared by the "document-style" themes
// (default, newspaper, parallax). Themes only change CSS, not markup.
import { esc } from './cms.js'

export function renderPortfolio(data, mountEl) {
  const sections = []

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

  mountEl.innerHTML = sections.join('\n') || '<div class="error">No data loaded.</div>'
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
