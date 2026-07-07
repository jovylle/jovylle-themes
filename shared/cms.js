// Shared CMS data layer for all themes.
export const CMS_BASE = 'https://content.jovylle.com'

export function esc(str) {
  if (!str) return ''
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

async function fetchJson(path) {
  const res = await fetch(`${CMS_BASE}/data/${path}`)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

export async function fetchAllCmsData() {
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
