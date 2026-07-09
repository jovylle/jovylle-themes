// ─── Procedural sound engine (Web Audio, zero asset files) ───
// Everything is synthesised from oscillators + a single shared noise buffer.
// The always-on loops (engine, wind, tires) are created once and modulated;
// one-shots build tiny throwaway node graphs with an envelope and self-clean.
//
// Usage:
//   const sfx = createSoundEngine()
//   // on first user gesture:
//   sfx.unlock()
//   // each frame:
//   sfx.setDrive(speedKmh, boosting, reversing)
//   sfx.setDrift(active, intensity)
//   sfx.setSurface('grass' | 'road' | 'air')
//   sfx.setTimeOfDay(t01)
//   // events:
//   sfx.thud(v); sfx.pickup(); sfx.horn(); ...

export function createSoundEngine() {
  let actx = null
  let unlocked = false
  let muted = localStorage.getItem('bruno-muted') === '1'

  // Persistent nodes (created in ensure()).
  let master, engineGain, engineFilter, osc1, osc2
  let boostGain, boostFilter
  let driftGain, driftFilter, rollGain, rollFilter
  let windGain, windFilter
  let birdGain, cricketGain
  let noiseBuffer
  let engineLoopSrc, boostLoopSrc, driftLoopSrc, rollLoopSrc, windLoopSrc
  let ambientTimer = null
  let reverseBeepTimer = null

  let dayFactor = 1        // 1 = midday, 0 = deep night (drives bird↔cricket mix)
  let surface = 'road'

  // ── noise buffer (2s of white noise, reused everywhere) ──
  function makeNoiseBuffer() {
    const len = actx.sampleRate * 2
    const buf = actx.createBuffer(1, len, actx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buf
  }

  function noiseSource(loop = true) {
    const src = actx.createBufferSource()
    src.buffer = noiseBuffer
    src.loop = loop
    return src
  }

  function ensure() {
    if (actx) return
    const AC = window.AudioContext || window.webkitAudioContext
    actx = new AC()
    noiseBuffer = makeNoiseBuffer()

    master = actx.createGain()
    master.gain.value = muted ? 0 : 1
    master.connect(actx.destination)

    // ── Engine: two detuned oscillators → lowpass → gain ──
    engineGain = actx.createGain()
    engineGain.gain.value = 0.0
    engineFilter = actx.createBiquadFilter()
    engineFilter.type = 'lowpass'
    engineFilter.frequency.value = 400
    engineGain.connect(master)
    engineFilter.connect(engineGain)

    osc1 = actx.createOscillator()
    osc1.type = 'sawtooth'
    osc1.frequency.value = 45
    osc2 = actx.createOscillator()
    osc2.type = 'sawtooth'
    osc2.frequency.value = 45
    osc2.detune.value = 12
    osc1.connect(engineFilter)
    osc2.connect(engineFilter)

    // ── Boost whoosh: noise → bandpass → gain ──
    boostGain = actx.createGain()
    boostGain.gain.value = 0
    boostFilter = actx.createBiquadFilter()
    boostFilter.type = 'bandpass'
    boostFilter.frequency.value = 800
    boostFilter.Q.value = 0.7
    boostGain.connect(master)
    boostFilter.connect(boostGain)
    boostLoopSrc = noiseSource()
    boostLoopSrc.connect(boostFilter)

    // ── Tire screech: noise → bandpass → gain ──
    driftGain = actx.createGain()
    driftGain.gain.value = 0
    driftFilter = actx.createBiquadFilter()
    driftFilter.type = 'bandpass'
    driftFilter.frequency.value = 2200
    driftFilter.Q.value = 4
    driftGain.connect(master)
    driftFilter.connect(driftGain)
    driftLoopSrc = noiseSource()
    driftLoopSrc.connect(driftFilter)

    // ── Rolling tire tone (surface-aware): noise → bandpass → gain ──
    rollGain = actx.createGain()
    rollGain.gain.value = 0
    rollFilter = actx.createBiquadFilter()
    rollFilter.type = 'bandpass'
    rollFilter.frequency.value = 500
    rollFilter.Q.value = 1.2
    rollGain.connect(master)
    rollFilter.connect(rollGain)
    rollLoopSrc = noiseSource()
    rollLoopSrc.connect(rollFilter)

    // ── Ambient wind bed: noise → lowpass → gain ──
    windGain = actx.createGain()
    windGain.gain.value = 0.04
    windFilter = actx.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.frequency.value = 350
    windGain.connect(master)
    windFilter.connect(windGain)
    windLoopSrc = noiseSource()
    windLoopSrc.connect(windFilter)

    // ── Bird / cricket mix buses (fed by scheduled one-shots) ──
    birdGain = actx.createGain()
    birdGain.gain.value = 0.5
    birdGain.connect(master)
    cricketGain = actx.createGain()
    cricketGain.gain.value = 0.0
    cricketGain.connect(master)
  }

  function unlock() {
    ensure()
    if (actx.state === 'suspended') actx.resume()
    if (unlocked) return
    unlocked = true
    // Start every always-on source exactly once.
    osc1.start(); osc2.start()
    boostLoopSrc.start(); driftLoopSrc.start(); rollLoopSrc.start(); windLoopSrc.start()
    startAmbientScheduler()
  }

  function now() { return actx.currentTime }

  // ── Master / mute ──
  function setMuted(m) {
    muted = m
    localStorage.setItem('bruno-muted', m ? '1' : '0')
    if (!actx) return
    master.gain.cancelScheduledValues(now())
    master.gain.linearRampToValueAtTime(m ? 0 : 1, now() + 0.15)
  }
  function toggleMute() { setMuted(!muted); return muted }
  function isMuted() { return muted }

  // ── Engine drive ──
  function setDrive(speedKmh, boosting, reversing) {
    if (!unlocked) return
    const s = Math.min(1, Math.abs(speedKmh) / 100)
    // fundamental 45 → 150 Hz, lifted by boost
    const base = 45 + s * 105 + (boosting ? 20 : 0)
    const t = now()
    osc1.frequency.setTargetAtTime(base, t, 0.08)
    osc2.frequency.setTargetAtTime(base * 1.005, t, 0.08)
    engineFilter.frequency.setTargetAtTime(300 + s * 1400, t, 0.1)
    // idle rumble present at rest, swells with speed
    engineGain.gain.setTargetAtTime(0.06 + s * 0.16, t, 0.1)

    // boost whoosh follows the turbo flag
    boostGain.gain.setTargetAtTime(boosting ? 0.10 : 0.0, t, 0.15)
    boostFilter.frequency.setTargetAtTime(600 + s * 1600, t, 0.15)

    // surface-aware rolling tone (only while actually moving)
    const rollBase = surface === 'road' ? 480 : surface === 'grass' ? 260 : 500
    const rollLevel = surface === 'air' ? 0 : Math.min(0.05, s * 0.06)
    rollFilter.frequency.setTargetAtTime(rollBase, t, 0.2)
    rollGain.gain.setTargetAtTime(rollLevel, t, 0.15)

    // periodic reverse beep
    if (reversing && !reverseBeepTimer) {
      reverseBeepTimer = setInterval(reverseBeep, 700)
    } else if (!reversing && reverseBeepTimer) {
      clearInterval(reverseBeepTimer); reverseBeepTimer = null
    }
  }

  function setSurface(s) { surface = s }

  // ── Drift screech ──
  function setDrift(active, intensity = 1) {
    if (!unlocked) return
    const t = now()
    const g = active ? Math.min(0.14, 0.05 + intensity * 0.09) : 0
    driftGain.gain.setTargetAtTime(g, t, active ? 0.03 : 0.12)
    driftFilter.frequency.setTargetAtTime(1800 + intensity * 900, t, 0.05)
  }

  // ── One-shot helpers ──
  function envOsc(type, f0, f1, dur, gain, when = 0) {
    const t = now() + when
    const o = actx.createOscillator()
    o.type = type
    const g = actx.createGain()
    o.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g); g.connect(master)
    o.start(t); o.stop(t + dur + 0.02)
    o.onended = () => { o.disconnect(); g.disconnect() }
    return { o, g, t }
  }

  function envNoise(filterType, freq, Q, dur, gain, when = 0, dest = master) {
    const t = now() + when
    const src = noiseSource(false)
    const f = actx.createBiquadFilter()
    f.type = filterType; f.frequency.value = freq; f.Q.value = Q
    const g = actx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f); f.connect(g); g.connect(dest)
    src.start(t); src.stop(t + dur + 0.02)
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect() }
    return { src, f, g, t }
  }

  // Collision thud — low filtered noise burst, weight from impact v (0..1).
  function thud(v = 0.5) {
    if (!unlocked) return
    const amp = 0.15 + v * 0.5
    envNoise('lowpass', 140 + v * 120, 1, 0.22, Math.min(0.7, amp))
    envOsc('sine', 90, 45, 0.2, Math.min(0.5, amp * 0.7))
  }

  // Lighter clatter for knock-around props.
  function clatter() {
    if (!unlocked) return
    envNoise('bandpass', 900, 2, 0.12, 0.18)
    envOsc('square', 220, 160, 0.1, 0.06)
  }

  // Coin pickup — bright two-note blip.
  function pickup() {
    if (!unlocked) return
    envOsc('triangle', 880, 880, 0.08, 0.16)
    envOsc('triangle', 1320, 1320, 0.12, 0.14, 0.06)
  }

  // All-collected fanfare — quick ascending arpeggio.
  function fanfare() {
    if (!unlocked) return
    const notes = [523, 659, 784, 1047, 1319]
    notes.forEach((f, i) => envOsc('triangle', f, f, 0.28, 0.16, i * 0.11))
  }

  // Boost pad zap — rising square blip + noise sweep.
  function zap() {
    if (!unlocked) return
    envOsc('square', 300, 1200, 0.22, 0.14)
    envNoise('bandpass', 1500, 1.2, 0.25, 0.1)
  }

  // Two-tone horn.
  function horn() {
    if (!unlocked) return
    envOsc('sawtooth', 370, 370, 0.5, 0.14)
    envOsc('sawtooth', 466, 466, 0.5, 0.12, 0.02)
  }

  // Landing thump after a jump — weight from downward speed (0..1).
  function land(v = 0.5) {
    if (!unlocked) return
    envNoise('lowpass', 120, 1, 0.2, Math.min(0.6, 0.2 + v * 0.4))
    envOsc('sine', 110, 55, 0.18, Math.min(0.4, 0.2 + v * 0.3))
  }

  // Zone chime — arpeggio seeded from the zone color.
  function chime(colorHex = 0x6366f1) {
    if (!unlocked) return
    const base = 300 + (colorHex & 0xff) + ((colorHex >> 8) & 0xff)
    const ratios = [1, 1.25, 1.5, 2]
    ratios.forEach((r, i) => envOsc('sine', base * r, base * r, 0.5, 0.1, i * 0.09))
  }

  // Starter rev when the intro releases control.
  function startRev() {
    if (!unlocked) return
    const { o } = envOsc('sawtooth', 60, 220, 0.6, 0.2)
    if (o) o.frequency.setTargetAtTime(90, now() + 0.6, 0.2)
  }

  // Short blip on reset.
  function resetBlip() {
    if (!unlocked) return
    envOsc('square', 660, 440, 0.14, 0.12)
  }

  function reverseBeep() {
    if (!unlocked || muted) return
    envOsc('square', 700, 700, 0.12, 0.06)
  }

  function splash() {
    if (!unlocked) return
    envNoise('bandpass', 1200, 0.8, 0.4, 0.18)
    envNoise('highpass', 2000, 0.7, 0.3, 0.1, 0.05)
  }

  // ── Day/night ambient cross-fade ──
  function setTimeOfDay(t01) {
    // dayFactor peaks at midday (t=0.5-ish assumed sun-up), lowest at night.
    // Caller passes a 0..1 phase; we derive a smooth day amount.
    dayFactor = Math.max(0, Math.sin(t01 * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5)
    if (!unlocked) return
    const t = now()
    birdGain.gain.setTargetAtTime(0.5 * dayFactor, t, 1.5)
    cricketGain.gain.setTargetAtTime(0.4 * (1 - dayFactor), t, 1.5)
    windGain.gain.setTargetAtTime(0.03 + 0.02 * (1 - dayFactor), t, 1.5)
  }

  // Scheduler that fires birds by day and crickets by night.
  function startAmbientScheduler() {
    if (ambientTimer) return
    ambientTimer = setInterval(() => {
      if (muted || !unlocked) return
      if (Math.random() < 0.5 * dayFactor) bird()
      if (Math.random() < 0.55 * (1 - dayFactor)) cricket()
    }, 550)
  }

  function bird() {
    // random sine glissando
    const f0 = 1600 + Math.random() * 1400
    const t = now()
    const o = actx.createOscillator()
    o.type = 'sine'
    const g = actx.createGain()
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f0 * (1.4 + Math.random() * 0.5), t + 0.08)
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.16)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
    o.connect(g); g.connect(birdGain)
    o.start(t); o.stop(t + 0.22)
    o.onended = () => { o.disconnect(); g.disconnect() }
  }

  function cricket() {
    // pulsed high chirp
    const base = 4200 + Math.random() * 600
    const t = now()
    for (let i = 0; i < 3; i++) {
      const o = actx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = base
      const g = actx.createGain()
      const at = t + i * 0.06
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.05, at + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04)
      o.connect(g); g.connect(cricketGain)
      o.start(at); o.stop(at + 0.05)
      o.onended = () => { o.disconnect(); g.disconnect() }
    }
  }

  return {
    unlock,
    setMuted, toggleMute, isMuted,
    setDrive, setDrift, setSurface, setTimeOfDay,
    thud, clatter, pickup, fanfare, zap, horn, land, chime, startRev, resetBlip, splash,
    get context() { return actx },
    get unlocked() { return unlocked },
  }
}
