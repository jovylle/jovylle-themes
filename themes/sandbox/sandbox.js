/* Sandbox theme — a little red car you can drive.
   Homage to bruno-simon.com. Arrow keys / A-D to drive,
   or grab and fling it. Click it to honk. */
(function () {
  const car = document.querySelector('.sb-car')
  const bubble = document.getElementById('sb-bubble')
  if (!car) return

  const CAR_W = 88
  const ACCEL = 0.7, FRICTION = 0.9, MAX = 9

  let x = 24          // left offset in px
  let v = 0           // horizontal velocity
  let dir = 1         // facing: 1 = right, -1 = left
  let hop = 0         // vertical bounce offset
  const keys = new Set()

  let dragging = false, startX = 0, startCarX = 0

  const typing = () => {
    const t = document.activeElement
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  }

  // ── keyboard driving ──
  addEventListener('keydown', (e) => {
    if (typing()) return
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keys.add('L'); e.preventDefault() }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keys.add('R'); e.preventDefault() }
  })
  addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.delete('L')
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.delete('R')
  })

  // ── grab / fling / honk ──
  car.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX; startCarX = x; v = 0
    try { car.setPointerCapture(e.pointerId) } catch (_) {}
  })
  car.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const nx = startCarX + (e.clientX - startX)
    if (nx > x + 0.5) dir = 1
    else if (nx < x - 0.5) dir = -1
    x = nx
  })
  const endDrag = (e) => {
    if (dragging && Math.abs(e.clientX - startX) < 5) honk()
    dragging = false
  }
  car.addEventListener('pointerup', endDrag)
  car.addEventListener('pointercancel', () => { dragging = false })

  const HONKS = ['Beep beep!', 'Honk!', 'Vroom!', 'Beep!', '🚗💨']
  let bubbleTimer
  function showBubble(text, ms) {
    if (!bubble) return
    bubble.textContent = text
    bubble.style.left = Math.max(70, Math.min(innerWidth - 70, x + CAR_W / 2)) + 'px'
    bubble.classList.add('show')
    clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms)
  }
  function honk() {
    hop = -16
    showBubble(HONKS[Math.floor(Math.random() * HONKS.length)], 1100)
  }

  // ── animation loop ──
  function frame() {
    if (!dragging) {
      let a = 0
      if (keys.has('L')) a -= ACCEL
      if (keys.has('R')) a += ACCEL
      v += a
      if (a === 0) v *= FRICTION
      v = Math.max(-MAX, Math.min(MAX, v))
      if (Math.abs(v) < 0.05) v = 0
      x += v
      if (v > 0.1) dir = 1
      else if (v < -0.1) dir = -1
    }

    // wrap around the world
    if (x > innerWidth) x = -CAR_W
    else if (x < -CAR_W) x = innerWidth

    hop += (0 - hop) * 0.18
    const tilt = Math.max(-3, Math.min(3, -v * 0.4))
    car.classList.toggle('driving', Math.abs(v) > 0.3 || dragging)
    car.style.transform =
      `translate(${x.toFixed(1)}px, ${hop.toFixed(2)}px) rotate(${tilt.toFixed(2)}deg) scaleX(${dir})`

    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // ── first-visit hint ──
  if (!localStorage.getItem('sb-drive-hint')) {
    setTimeout(() => {
      showBubble('Use ← → to drive!', 4500)
      localStorage.setItem('sb-drive-hint', '1')
    }, 900)
  }
})()
