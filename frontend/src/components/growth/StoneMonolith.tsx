import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Growth Monolith — five polished stone slabs, one per stage of the journey.
 *
 * A hand-written WebGL raymarcher (no 3D library, nothing fetched). Each slab's
 * thickness follows a live count; a stage with no data source renders as a
 * ghosted, vein-less slab — never as a thin "zero". The pointer is ray-tested on
 * the CPU against the same distance field, so slabs can be hovered and clicked
 * directly in 3D. The legend beside it is the accessible equivalent.
 */
export interface StoneLayer {
  key: string
  label: string
  /** null = no data source (shown ghosted, never as zero). */
  value: number | null
  detail: string
  /** CSS custom property holding an "H S% L%" triple, e.g. '--signal'. */
  tone: string
}

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime, uYaw, uPitch;
uniform vec4 uSlab[5]; uniform vec3 uCol[5]; uniform float uAvail[5]; uniform float uLift[5];
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 toObj(vec3 p){ p.yz = rot(uPitch) * p.yz; p.xz = rot(uYaw) * p.xz; return p; }
float sdRB(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
vec3 local(vec3 o, vec4 s, float lift){ vec3 q = o - vec3(lift * 0.24, s.x, lift * 0.07); q.xz = rot(s.w) * q.xz; return q; }
vec2 map(vec3 p){
  vec3 o = toObj(p); vec2 res = vec2(1e5, -1.0);
  for (int i = 0; i < 5; i++) {
    vec3 q = local(o, uSlab[i], uLift[i]);
    float d = sdRB(q, vec3(0.78, uSlab[i].y, 0.52), min(0.045, uSlab[i].y * 0.7));
    if (d < res.x) res = vec2(d, float(i));
  }
  return res;
}
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 3.1; a *= 0.5; } return s; }
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.0, 3.8), rd = normalize(vec3(uv, -1.9));
  float t = 0.0; vec2 h = vec2(1e5, -1.0);
  for (int i = 0; i < 90; i++) { h = map(ro + rd * t); if (h.x < 0.0008 || t > 8.0) break; t += h.x; }
  if (h.x > 0.002) { gl_FragColor = vec4(0.0); return; }
  vec3 p = ro + rd * t;
  vec2 e = vec2(0.0012, -0.0012);
  vec3 n = normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
  vec3 col = vec3(0.8); float avail = 1.0, lift = 0.0; vec3 q = vec3(0.0);
  vec3 o = toObj(p);
  for (int i = 0; i < 5; i++) if (float(i) == h.y) { col = uCol[i]; avail = uAvail[i]; lift = uLift[i]; q = local(o, uSlab[i], uLift[i]) + float(i) * 1.7; }
  // Marble: dark stone body, stage-tinted, with warped veins that drift slowly.
  float nz = fbm(q * 1.5 + vec3(0.0, 0.0, uTime * 0.025));
  float v1 = pow(1.0 - abs(sin(q.x * 2.1 + q.z * 1.4 + nz * 7.5)), 22.0);
  float v2 = pow(1.0 - abs(sin(q.x * 5.3 - q.z * 2.2 + nz * 12.0)), 48.0) * 0.55;
  vec3 body = mix(vec3(0.05, 0.055, 0.065), col * 0.26, 0.6) + nz * 0.05;
  vec3 veinC = mix(vec3(0.95, 0.93, 0.88), col, 0.5);
  vec3 alb = body + veinC * (v1 * 0.85 + v2) * mix(0.12, 1.0, avail) * (1.0 + lift * 0.6);
  // Gallery lighting: a key light, two softboxes in the reflection, a polished highlight.
  vec3 L = normalize(vec3(-0.45, 0.85, 0.6));
  float dif = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(n, normalize(L - rd)), 0.0, 1.0), 110.0);
  float fre = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 4.0);
  vec3 r = reflect(rd, n);
  float box1 = smoothstep(0.5, 0.92, r.y) * (0.55 + 0.45 * smoothstep(-0.4, 0.7, r.x));
  float box2 = smoothstep(0.62, 0.95, -r.x * 0.75 + r.y * 0.35);
  vec3 env = vec3(0.92, 0.94, 1.0) * box1 * 0.75 + vec3(0.6, 0.72, 1.0) * box2 * 0.32 + 0.04;
  vec3 c = alb * (0.26 + 1.05 * dif) + env * (0.3 + 0.7 * fre) * mix(0.45, 1.0, avail) + vec3(spec) * 0.85;
  c += col * fre * (0.22 + lift * 0.9);
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(g) * 0.7, c, mix(0.25, 1.0, avail));
  c = pow(c, vec3(0.92));
  gl_FragColor = vec4(c, 1.0);
}`

/* CPU twin of the distance field, for pointer picking. */
type Slab = [number, number, number, number]
// Matches GLSL `mat2(c, -s, s, c) * v`, which is column-major: x' = c·x + s·y, y' = −s·x + c·y.
const rot = (x: number, y: number, a: number): [number, number] => { const c = Math.cos(a), s = Math.sin(a); return [c * x + s * y, -s * x + c * y] }
function pickSlab(u: number, v: number, yaw: number, pitch: number, slabs: Slab[], lifts: number[]): number {
  const ro = [0, 0, 3.8]; const len = Math.hypot(u, v, 1.9); const rd = [u / len, v / len, -1.9 / len]
  let t = 0
  for (let step = 0; step < 90; step++) {
    let x = ro[0] + rd[0] * t, y = ro[1] + rd[1] * t, z = ro[2] + rd[2] * t;
    [y, z] = rot(y, z, pitch); [x, z] = rot(x, z, yaw)
    let best = 1e5, id = -1
    slabs.forEach((s, i) => {
      let qx = x - lifts[i] * 0.24, qz = z - lifts[i] * 0.07; const qy = y - s[0];
      [qx, qz] = rot(qx, qz, s[3])
      const r = Math.min(0.045, s[1] * 0.7)
      const ax = Math.abs(qx) - 0.78 + r, ay = Math.abs(qy) - s[1] + r, az = Math.abs(qz) - 0.52 + r
      const d = Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0)) + Math.min(Math.max(ax, ay, az), 0) - r
      if (d < best) { best = d; id = i }
    })
    if (best < 0.002) return id
    t += best
    if (t > 8) break
  }
  return -1
}

const TWIST = [0.0, 0.11, -0.07, 0.09, -0.05]
function slabLayout(layers: StoneLayer[], grow: number): Slab[] {
  // Log scale: 5 drafts and 468 clicks should both read as real, without one flattening the rest.
  const max = Math.log1p(Math.max(1, ...layers.map((l) => l.value ?? 0)))
  const halves = layers.map((l) => (l.value == null ? 0.075 : 0.09 + 0.1 * Math.log1p(l.value) / max) * grow + 0.012)
  const gap = 0.05
  const total = halves.reduce((a, h) => a + 2 * h, 0) + gap * (layers.length - 1)
  let y = total / 2
  return halves.map((h, i) => { const c = y - h; y -= 2 * h + gap; return [c, h, 0, TWIST[i % TWIST.length]] })
}
function toneRgb(variable: string): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  const [h, s, l] = raw.split(/\s+/).map((x) => parseFloat(x))
  if (![h, s, l].every(Number.isFinite)) return [0.8, 0.8, 0.8]
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
  return [f(0), f(8), f(4)]
}

export default function StoneMonolith({ layers, active, onActive, onSelect, className }: {
  layers: StoneLayer[]; active: number | null; onActive: (index: number | null) => void; onSelect: (index: number) => void; className?: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [webgl, setWebgl] = useState(true)
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null)
  // Everything the render loop reads lives in one ref, so React renders never restart GL.
  const state = useRef({ layers, active, yaw: -0.55, yawVel: 0, pitch: 0.32, pitchTarget: 0.32, lifts: [0, 0, 0, 0, 0], grow: 0, dragging: false, lastX: 0, moved: 0, hover: -1, dirty: true })
  state.current.layers = layers
  state.current.active = active
  state.current.dirty = true
  const handlers = useRef({ onActive, onSelect }); handlers.current = { onActive, onSelect }

  useEffect(() => {
    const el = canvas.current!
    const gl = el.getContext('webgl', { antialias: false, premultipliedAlpha: true, alpha: true, powerPreference: 'high-performance' })
    if (!gl) { setWebgl(false); return }
    const compile = (type: number, src: string) => { const sh = gl.createShader(type)!; gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader'); return sh }
    let prog: WebGLProgram
    try {
      prog = gl.createProgram()!
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link')
    } catch { setWebgl(false); return }
    gl.useProgram(prog)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const U = (name: string) => gl.getUniformLocation(prog, name)
    const u = { res: U('uRes'), time: U('uTime'), yaw: U('uYaw'), pitch: U('uPitch'), slab: U('uSlab'), col: U('uCol'), avail: U('uAvail'), lift: U('uLift') }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    const resize = () => { const r = el.getBoundingClientRect(); el.width = Math.max(1, Math.round(r.width * dpr)); el.height = Math.max(1, Math.round(r.height * dpr)); gl.viewport(0, 0, el.width, el.height); state.current.dirty = true }
    const ro = new ResizeObserver(resize); ro.observe(el); resize()

    let visible = true
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) kick() }); io.observe(el)
    let raf = 0, last = performance.now(), slow = 0
    const start = performance.now()
    const frame = (now: number) => {
      raf = 0
      const s = state.current
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      // Strata rise once on load; data changes ease the slabs to their new thickness.
      s.grow = reduced || document.hidden ? 1 : Math.min(1, s.grow + dt * 0.9)
      if (!s.dragging) { s.yaw += s.yawVel * dt + (reduced ? 0 : 0.1 * dt); s.yawVel *= Math.pow(0.04, dt) }
      s.pitch += (s.pitchTarget - s.pitch) * Math.min(1, dt * 6)
      const target = s.hover >= 0 ? s.hover : s.active ?? -1
      let settling = false
      s.lifts = s.lifts.map((l, i) => { const goal = i === target ? 1 : 0; const next = l + (goal - l) * Math.min(1, dt * 9); if (Math.abs(goal - next) > 0.002) settling = true; return next })
      const slabs = slabLayout(s.layers, 1 - Math.pow(1 - s.grow, 3))
      gl.uniform2f(u.res, el.width, el.height)
      gl.uniform1f(u.time, (now - start) / 1000)
      gl.uniform1f(u.yaw, s.yaw); gl.uniform1f(u.pitch, s.pitch)
      gl.uniform4fv(u.slab, slabs.flat())
      gl.uniform3fv(u.col, s.layers.flatMap((l) => toneCache[l.tone] ??= toneRgb(l.tone)))
      gl.uniform1fv(u.avail, s.layers.map((l) => (l.value == null ? 0 : 1)))
      gl.uniform1fv(u.lift, s.lifts)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      // Adaptive resolution: drop to 1x if frames are slow (integrated GPUs, battery).
      if (dt > 0.03 && dpr > 1) { if (++slow > 20) { dpr = 1; resize(); slow = 0 } } else slow = 0
      s.dirty = false
      const animating = !reduced || s.grow < 1 || settling || s.dragging || Math.abs(s.yawVel) > 0.01 || Math.abs(s.pitchTarget - s.pitch) > 0.001
      if (visible && !document.hidden && animating) raf = requestAnimationFrame(frame)
    }
    const toneCache: Record<string, [number, number, number]> = {}
    const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame) } }
    state.current.dirty = true; kick()
    const poll = window.setInterval(() => { if (state.current.dirty) kick() }, 120)
    const onVis = () => kick(); document.addEventListener('visibilitychange', onVis)
    kickRef.current = kick
    return () => { cancelAnimationFrame(raf); window.clearInterval(poll); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  const kickRef = useRef<() => void>(() => {})

  function hit(e: React.PointerEvent) {
    const r = canvas.current!.getBoundingClientRect()
    const u = (e.clientX - r.left - r.width / 2) / r.height, v = -(e.clientY - r.top - r.height / 2) / r.height
    const s = state.current
    return { i: pickSlab(u, v, s.yaw, s.pitch, slabLayout(s.layers, 1), s.lifts), x: e.clientX - r.left, y: e.clientY - r.top, h: r.height }
  }
  function onMove(e: React.PointerEvent) {
    const s = state.current
    if (s.dragging) { const dx = e.clientX - s.lastX; s.lastX = e.clientX; s.moved += Math.abs(dx); s.yaw += dx * 0.009; s.yawVel = dx * 0.5; kickRef.current(); return }
    const h = hit(e)
    s.pitchTarget = 0.32 + ((h.y / h.h) - 0.5) * 0.25
    if (h.i !== s.hover) { s.hover = h.i; handlers.current.onActive(h.i >= 0 ? h.i : null) }
    setTip(h.i >= 0 ? { i: h.i, x: h.x, y: h.y } : null)
    kickRef.current()
  }
  function onLeave() { const s = state.current; s.hover = -1; s.pitchTarget = 0.32; setTip(null); handlers.current.onActive(null); kickRef.current() }
  function onDown(e: React.PointerEvent) { const s = state.current; s.dragging = true; s.lastX = e.clientX; s.moved = 0; (e.target as Element).setPointerCapture?.(e.pointerId) }
  function onUp(e: React.PointerEvent) {
    const s = state.current; const wasDrag = s.moved > 6; s.dragging = false; kickRef.current()
    if (!wasDrag) { const h = hit(e); if (h.i >= 0) handlers.current.onSelect(h.i) }
  }

  const tipLayer = tip ? layers[tip.i] : null
  return (
    <div ref={wrap} className={cn('relative select-none', className)}>
      {/* Contact shadow on the gallery floor. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-[18%] bottom-[7%] h-[9%] rounded-[50%] bg-black/55 blur-2xl" />
      {webgl ? (
        <canvas ref={canvas} role="img" aria-label={`Growth monolith: ${layers.map((l) => `${l.label} ${l.value ?? 'not measured'}`).join(', ')}`}
          className={cn('relative block h-full w-full touch-pan-y', tip ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing')}
          onPointerMove={onMove} onPointerLeave={onLeave} onPointerDown={onDown} onPointerUp={onUp} />
      ) : <FallbackStack layers={layers} active={active} />}
      {tipLayer && (
        <div className="glass pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[130%] whitespace-nowrap rounded-xl px-3 py-2 text-xs" style={{ left: tip!.x, top: tip!.y }}>
          <span className="font-medium text-foreground">{tipLayer.label}</span>
          <span className="ml-2 text-muted-foreground">{tipLayer.detail}</span>
        </div>
      )}
    </div>
  )
}

/** No WebGL: the same strata, stacked in CSS 3D. */
function FallbackStack({ layers, active }: { layers: StoneLayer[]; active: number | null }) {
  return (
    <div className="flex h-full items-center justify-center [perspective:900px]">
      <div className="w-3/5 space-y-2 [transform:rotateX(52deg)_rotateZ(-28deg)] [transform-style:preserve-3d]">
        {layers.map((l, i) => (
          <div key={l.key} className="rounded-lg border transition-transform duration-500"
            style={{ height: 14 + (l.value == null ? 0 : 10), transform: active === i ? 'translateX(18px)' : undefined, background: `linear-gradient(135deg, hsl(var(${l.tone}) / ${l.value == null ? 0.08 : 0.35}), hsl(var(--card)))`, borderColor: `hsl(var(${l.tone}) / 0.4)` }} />
        ))}
      </div>
    </div>
  )
}
