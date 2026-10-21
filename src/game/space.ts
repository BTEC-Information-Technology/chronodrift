import * as THREE from 'three';

/**
 * Unknown Future sky and road: six celestial bodies built once at startup (broken planet, dying sun, ringed giant,
 * shattered world, dead moon, lone rocks), a composition drawn at every entry into the era, a nebula map for the sky
 * dome, glass-road extras (floating light tubes) and cosmic dust. All tunings are the ones the user
 * approved in the preview pages (2026-10-15). Everything heavy (geometry, canvas textures) happens in `build()`; per
 * frame only a few uniforms and transforms change.
 */

// ---------- noise (CPU, for displacement) ----------
const sm = (t: number) => t * t * (3 - 2 * t);
const hash3 = (x: number, y: number, z: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); const fx = sm(x - ix), fy = sm(y - iy), fz = sm(z - iz); const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy), l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
function fbm3(x: number, y: number, z: number, oct = 4) { let a = 0.5, s = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.1; a *= 0.5; } return s; }
const GLSL_NOISE = `
  float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y), mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.2; a *= 0.5; } return s; }
  vec3 hueShift(vec3 c, float deg){ float a = radians(deg); float cs = cos(a), sn = sin(a); vec3 k = vec3(0.57735); return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs); }`;

type Rng = () => number;
const canvas2d = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!]; };
const srgb = <T extends THREE.Texture>(t: T): T => { t.colorSpace = THREE.SRGBColorSpace; return t; };
const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => new THREE.Mesh(g, m);

export interface Body { group: THREE.Group; radius: number; update?: (dt: number, t: number, camLocal: THREE.Vector3) => void }

// ---------- textures ----------
function rockTexture(rng: Rng): THREE.CanvasTexture {
  const W = 1024, H = 512; const [c, q] = canvas2d(W, H);
  q.fillStyle = '#9c9ca8'; q.fillRect(0, 0, W, H);
  q.globalAlpha = 0.25; for (let i = 0; i < 24000; i++) { const v = (90 + rng() * 130) | 0; q.fillStyle = `rgb(${v},${v},${(v + 10) | 0})`; q.fillRect(rng() * W, rng() * H, 1 + rng() * 3, 1 + rng() * 3); } q.globalAlpha = 1;
  q.globalAlpha = 0.18; for (let i = 0; i < 40; i++) { q.fillStyle = rng() < 0.5 ? '#50506a' : '#d0d0dc'; q.beginPath(); q.ellipse(rng() * W, rng() * H, 30 + rng() * 120, 20 + rng() * 70, rng() * 3, 0, 6.2832); q.fill(); } q.globalAlpha = 1;
  q.strokeStyle = 'rgba(30,28,48,0.7)'; for (let i = 0; i < 50; i++) { let x = rng() * W, y = rng() * H; q.lineWidth = 1 + rng() * 2; q.beginPath(); q.moveTo(x, y); let a = rng() * 6.28; for (let k = 0; k < 8; k++) { a += (rng() - 0.5) * 1.5; x += Math.cos(a) * (8 + rng() * 25); y += Math.sin(a) * (8 + rng() * 25); q.lineTo(x, y); } q.stroke(); }
  for (let i = 0; i < 120; i++) { const x = rng() * W, y = rng() * H, r = 3 + rng() * rng() * 18; const g = q.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(50,48,70,0.75)'); g.addColorStop(0.7, 'rgba(90,88,110,0.5)'); g.addColorStop(0.9, 'rgba(215,212,228,0.8)'); g.addColorStop(1, 'rgba(215,212,228,0)'); q.fillStyle = g; q.beginPath(); q.arc(x, y, r, 0, 6.2832); q.fill(); }
  const t = srgb(new THREE.CanvasTexture(c)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
/** broken planet crust: grain, tonal patches, traces of giant dead cities, craters */
function planetSurfaceTexture(rng: Rng): THREE.CanvasTexture {
  const W = 1024, H = 512; const [c, q] = canvas2d(W, H);
  q.fillStyle = '#9aa0bc'; q.fillRect(0, 0, W, H);
  q.globalAlpha = 0.18; for (let i = 0; i < 20000; i++) { const v = (120 + rng() * 120) | 0; q.fillStyle = `rgb(${v},${v},${(v + 14) | 0})`; q.fillRect(rng() * W, rng() * H, 1 + rng() * 3, 1 + rng() * 3); } q.globalAlpha = 1;
  q.globalAlpha = 0.14; for (let i = 0; i < 40; i++) { q.fillStyle = rng() < 0.5 ? '#5a6080' : '#c8ccdc'; q.beginPath(); q.ellipse(rng() * W, rng() * H, 40 + rng() * 140, 25 + rng() * 80, rng() * 3, 0, Math.PI * 2); q.fill(); } q.globalAlpha = 1;
  for (let i = 0; i < 9; i++) { const cx = rng() * W, cy = H * (0.2 + rng() * 0.6), w = 60 + rng() * 120, h = 40 + rng() * 80, step = 6 + rng() * 5;
    q.save(); q.translate(cx, cy); q.rotate((rng() - 0.5) * 0.8); q.fillStyle = 'rgba(70,76,110,0.35)'; q.fillRect(-w / 2, -h / 2, w, h); q.strokeStyle = 'rgba(190,196,230,0.55)'; q.lineWidth = 1;
    for (let x = -w / 2; x <= w / 2; x += step) { q.beginPath(); q.moveTo(x, -h / 2); q.lineTo(x, h / 2); q.stroke(); } for (let y = -h / 2; y <= h / 2; y += step) { q.beginPath(); q.moveTo(-w / 2, y); q.lineTo(w / 2, y); q.stroke(); }
    q.fillStyle = 'rgba(40,44,70,0.7)'; for (let k = 0; k < 14; k++) q.fillRect(-w / 2 + rng() * w, -h / 2 + rng() * h, 3 + rng() * 10, 3 + rng() * 8); q.fillStyle = 'rgba(255,220,160,0.9)'; for (let k = 0; k < 6; k++) q.fillRect(-w / 2 + rng() * w, -h / 2 + rng() * h, 1.5, 1.5); q.restore(); }
  for (let i = 0; i < 90; i++) { const x = rng() * W, y = rng() * H, r = 4 + rng() * rng() * 34; const g = q.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(60,64,96,0.75)'); g.addColorStop(0.7, 'rgba(90,96,130,0.5)'); g.addColorStop(0.9, 'rgba(210,214,236,0.8)'); g.addColorStop(1, 'rgba(210,214,236,0)'); q.fillStyle = g; q.beginPath(); q.arc(x, y, r, 0, Math.PI * 2); q.fill(); }
  const t = srgb(new THREE.CanvasTexture(c)); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
function crustTexture(rng: Rng): THREE.CanvasTexture {
  const W = 1024, H = 512; const [c, q] = canvas2d(W, H);
  q.fillStyle = '#a89cb8'; q.fillRect(0, 0, W, H);
  q.globalAlpha = 0.2; for (let i = 0; i < 20000; i++) { const v = (110 + rng() * 130) | 0; q.fillStyle = `rgb(${v},${(v - 8) | 0},${(v + 12) | 0})`; q.fillRect(rng() * W, rng() * H, 1 + rng() * 3, 1 + rng() * 3); } q.globalAlpha = 1;
  q.globalAlpha = 0.16; for (let i = 0; i < 36; i++) { q.fillStyle = rng() < 0.5 ? '#5a4e70' : '#d8d0e8'; q.beginPath(); q.ellipse(rng() * W, rng() * H, 40 + rng() * 160, 25 + rng() * 90, rng() * 3, 0, Math.PI * 2); q.fill(); } q.globalAlpha = 1;
  q.strokeStyle = 'rgba(40,30,60,0.75)'; for (let i = 0; i < 40; i++) { let x = rng() * W, y = rng() * H; q.lineWidth = 1 + rng() * 2.5; q.beginPath(); q.moveTo(x, y); let a = rng() * 6.28; for (let k = 0; k < 10; k++) { a += (rng() - 0.5) * 1.4; x += Math.cos(a) * (10 + rng() * 30); y += Math.sin(a) * (10 + rng() * 30); q.lineTo(x, y); } q.stroke(); }
  for (let i = 0; i < 70; i++) { const x = rng() * W, y = rng() * H, r = 4 + rng() * rng() * 30; const g = q.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(60,50,80,0.7)'); g.addColorStop(0.7, 'rgba(100,90,125,0.45)'); g.addColorStop(0.9, 'rgba(225,215,240,0.8)'); g.addColorStop(1, 'rgba(225,215,240,0)'); q.fillStyle = g; q.beginPath(); q.arc(x, y, r, 0, Math.PI * 2); q.fill(); }
  const t = srgb(new THREE.CanvasTexture(c)); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
const dotTexture = (): THREE.CanvasTexture => { const [c, q] = canvas2d(32, 32); const g = q.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); q.fillStyle = g; q.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); };
const haloTexture = (inner: string, mid: string, outer: string): THREE.CanvasTexture => { const [c, q] = canvas2d(128, 128); const g = q.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, inner); g.addColorStop(0.4, mid); g.addColorStop(1, outer); q.fillStyle = g; q.fillRect(0, 0, 128, 128); return srgb(new THREE.CanvasTexture(c)); };

// ---------- shared materials ----------
let dotTex: THREE.CanvasTexture;
let rockMat: THREE.MeshStandardMaterial; // approved loose-rock look (hue 6, brightness 1.52)
let rubbleMat: THREE.MeshStandardMaterial; // small debris (flat, dark)

/** rubble ring + dust around a body (instanced rocks + points) */
function addRing(grp: THREE.Group, r: number, nRocks: number, nDust: number, rng: Rng, tilt = 0): { inst: THREE.InstancedMesh; dust: THREE.Points } {
  const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rubbleMat, nRocks); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3();
  for (let i = 0; i < nRocks; i++) { const a = rng() * Math.PI * 2, rr = r * (1.4 + rng() * 0.9), y = (rng() - 0.5) * r * 0.25; const sz = r * (0.03 + rng() * 0.07); q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3)); s3.set(sz, sz * (0.6 + rng()), sz); m4.compose(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr), q, s3); inst.setMatrixAt(i, m4); }
  inst.rotation.x = tilt; grp.add(inst);
  const dp = new Float32Array(nDust * 3); for (let i = 0; i < nDust; i++) { const a = rng() * Math.PI * 2, rr = r * (1.3 + rng() * 1.2), y = (rng() - 0.5) * r * 0.3; dp[i * 3] = Math.cos(a) * rr; dp[i * 3 + 1] = y; dp[i * 3 + 2] = Math.sin(a) * rr; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x8aa0ff, map: dotTex, size: r * 0.04, sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false, alphaTest: 0.05, fog: false })); dust.rotation.x = tilt; grp.add(dust);
  return { inst, dust };
}

// ---------- 1. broken planet ----------
function brokenPlanet(R: number, rng: Rng): Body {
  const COL = { surface: 0xb4bad4, surfaceEm: 0x161c3a, interior: 0x1a1e34, interiorEm: 0x080a16, crack: 0x2ad866, crackPower: 0.9, dust: 0x2ad866, dustPower: 0.12, core: '#2f9a56', coreGlow: 0.55, halo: 0.45 };
  const BREACH = new THREE.Vector3(0, 0.15, 1).normalize(); const CORE_R = R * 0.44;
  const craters: { dir: THREE.Vector3; rad: number; depth: number }[] = []; for (let i = 0; i < 7; i++) craters.push({ dir: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), rad: 0.15 + rng() * 0.25, depth: 0.05 + rng() * 0.07 });
  const surf = (n: THREE.Vector3, off: number) => { let k = 1 + (fbm3(n.x * 3 + off, n.y * 3, n.z * 3) - 0.5) * 0.14; for (const c of craters) { const d = n.distanceTo(c.dir); if (d < c.rad) { const t = d / c.rad; k -= c.depth * (1 - sm(t)) * (t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15 * 2); } } return k; };
  const rimAngle = (n: THREE.Vector3) => 1.05 + (fbm3(n.x * 2.2 + 2, n.y * 2.2, n.z * 2.2, 3) - 0.5) * 1.6 + (fbm3(n.x * 6 + 5, n.y * 6, n.z * 6, 2) - 0.5) * 0.5;
  const bU = new THREE.Vector3(1, 0, 0).cross(BREACH).normalize(), bV = BREACH.clone().cross(bU).normalize(); const azimuth = (n: THREE.Vector3) => Math.atan2(n.dot(bV), n.dot(bU));
  const std = (color: number, emissive: number, extra: Record<string, unknown> = {}) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.6, roughness: 0.95, metalness: 0.02, flatShading: true, fog: false, ...extra });
  const surfaceTex = planetSurfaceTexture(rng);
  const surfaceMat = new THREE.MeshStandardMaterial({ color: COL.surface, emissive: COL.surfaceEm, emissiveIntensity: 0.6, map: surfaceTex, bumpMap: surfaceTex, bumpScale: 0.35, roughness: 0.95, metalness: 0.02, fog: false });
  const interiorMat = std(COL.interior, COL.interiorEm, { vertexColors: true });
  const glowMat = (color: number, power: number) => new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: power } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    vertexShader: 'attribute float aGlow; varying float vG; void main(){ vG = aGlow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * 0.03, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uPower; varying float vG; void main(){ gl_FragColor = vec4(uColor * uPower * vG, vG); }' });
  const crackMat = glowMat(COL.crack, COL.crackPower), dustMat = glowMat(COL.dust, COL.dustPower);
  // crust: faces sorted into surface / crater interior
  const src = new THREE.SphereGeometry(R, 72, 48).toNonIndexed(); const p = src.attributes.position;
  const outS: number[] = [], outI: number[] = [], colI: number[] = [], glowI: number[] = [], uvS: number[] = [], nS: number[] = []; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nc = new THREE.Vector3();
  const vert = (v: THREE.Vector3) => { const n = v.clone().normalize(); const ang = Math.acos(THREE.MathUtils.clamp(n.dot(BREACH), -1, 1)); const rim = rimAngle(n); let k = surf(n, 1), depth = 0, gl = 0;
    if (ang < rim) { const t = 1 - ang / rim; depth = sm(Math.min(1, t * 1.7)); const wall = (fbm3(n.x * 9 + 3, n.y * 9, n.z * 9, 3) - 0.5) * 0.12 * (1 - depth); k = (1 - depth) * k + depth * (CORE_R / R * 0.7) + wall; const az = azimuth(n); const crack = Math.pow(Math.max(0, Math.sin(az * 9 + fbm3(n.x * 5, n.y * 5, n.z * 5, 2) * 4)), 14) * (0.3 + 0.7 * depth); gl = Math.min(1, crack + depth * depth * 0.15); }
    return { x: n.x * R * k, y: n.y * R * k, z: n.z * R * k, depth, gl, n }; };
  for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2); nc.copy(a).add(b).add(c).normalize();
    const inside = Math.acos(THREE.MathUtils.clamp(nc.dot(BREACH), -1, 1)) < rimAngle(nc); const ws = [a, b, c].map((v) => vert(v));
    if (inside) { for (const w of ws) { outI.push(w.x, w.y, w.z); const sh = 1 - 0.85 * w.depth; colI.push(sh, sh, sh); glowI.push(w.gl); } }
    else { const uv = ws.map((w) => [0.5 + Math.atan2(w.n.z, w.n.x) / (2 * Math.PI), 0.5 - Math.asin(w.n.y) / Math.PI]); const umin = Math.min(uv[0][0], uv[1][0], uv[2][0]), umax = Math.max(uv[0][0], uv[1][0], uv[2][0]); if (umax - umin > 0.5) for (const t of uv) if (t[0] < 0.5) t[0] += 1; ws.forEach((w, k) => { outS.push(w.x, w.y, w.z); uvS.push(uv[k][0], uv[k][1]); nS.push(w.n.x, w.n.y, w.n.z); }); } }
  const gS = new THREE.BufferGeometry(); gS.setAttribute('position', new THREE.Float32BufferAttribute(outS, 3)); gS.setAttribute('uv', new THREE.Float32BufferAttribute(uvS, 2)); gS.setAttribute('normal', new THREE.Float32BufferAttribute(nS, 3));
  const gI = new THREE.BufferGeometry(); gI.setAttribute('position', new THREE.Float32BufferAttribute(outI, 3)); gI.setAttribute('color', new THREE.Float32BufferAttribute(colI, 3)); gI.setAttribute('aGlow', new THREE.Float32BufferAttribute(glowI, 1)); gI.computeVertexNormals();
  const group = new THREE.Group(); group.add(mesh(gS, surfaceMat), mesh(gI, interiorMat), mesh(gI, crackMat));
  // core + halo
  const [cc, cq] = canvas2d(256, 128); cq.fillStyle = COL.core; cq.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 70; i++) { const x = rng() * 256, y = rng() * 128, rr = 6 + rng() * 22; const g = cq.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(10,40,20,0.85)'); g.addColorStop(1, 'rgba(10,40,20,0)'); cq.fillStyle = g; cq.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  for (let i = 0; i < 30; i++) { const x = rng() * 256, y = rng() * 128, rr = 3 + rng() * 8; const g = cq.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(200,255,180,0.7)'); g.addColorStop(1, 'rgba(200,255,180,0)'); cq.fillStyle = g; cq.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x0a1a10, emissive: 0xffffff, emissiveMap: srgb(new THREE.CanvasTexture(cc)), emissiveIntensity: COL.coreGlow, roughness: 1, toneMapped: false, fog: false });
  group.add(mesh(new THREE.SphereGeometry(CORE_R, 24, 16), coreMat));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture('rgba(120,255,150,0.55)', 'rgba(90,220,120,0.22)', 'rgba(60,180,90,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })); halo.scale.setScalar(R * 0.85); halo.position.copy(BREACH).multiplyScalar(R * 0.3); group.add(halo);
  // boulders with a curved cap from the old surface; debris clouds; settled ring
  const boulder = (size: number, curvedFrac: number) => { const s0 = new THREE.IcosahedronGeometry(size, 2).toNonIndexed(); const pp = s0.attributes.position; const off = rng() * 9; const body: number[] = [], cap: number[] = [], glow: number[] = [];
    const vv = (v: THREE.Vector3, isCap: boolean) => { const n = v.clone().normalize(); let k = 1 + (fbm3(n.x * 2.5 + off, n.y * 2.5, n.z * 2.5, 3) - 0.5) * 0.7; if (isCap) k = 1 + (0.98 - 1) * Math.max(0, (n.y - curvedFrac) / (1 - curvedFrac)); return [n.x * size * k, n.y * size * k * 0.75, n.z * size * k, isCap ? 0 : Math.max(0, (fbm3(n.x * 6 + off, n.y * 6, n.z * 6, 2) - 0.55) * 1.2)]; };
    for (let i = 0; i < pp.count; i += 3) { a.fromBufferAttribute(pp, i); b.fromBufferAttribute(pp, i + 1); c.fromBufferAttribute(pp, i + 2); nc.copy(a).add(b).add(c).normalize(); const isCap = nc.y > curvedFrac; for (const v of [a, b, c]) { const w = vv(v, isCap); if (isCap) cap.push(w[0], w[1], w[2]); else { body.push(w[0], w[1], w[2]); glow.push(w[3]); } } }
    const g = new THREE.Group(); const gB = new THREE.BufferGeometry(); gB.setAttribute('position', new THREE.Float32BufferAttribute(body, 3)); gB.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1)); gB.computeVertexNormals(); g.add(mesh(gB, rockMat), mesh(gB, dustMat));
    const gC = new THREE.BufferGeometry(); gC.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3)); const cu: number[] = [], cn: number[] = []; for (let k = 0; k < cap.length; k += 3) { const n = new THREE.Vector3(cap[k], cap[k + 1], cap[k + 2]).normalize(); cu.push(0.5 + n.x * 0.12 + off * 0.01, 0.5 + n.z * 0.12); cn.push(n.x, n.y, n.z); } gC.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2)); gC.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3)); g.add(mesh(gC, surfaceMat)); return g; };
  const chunks: THREE.Group[] = []; const debrisGeo = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 7; i++) { const spread = 0.45 + rng() * 0.75, az = rng() * Math.PI * 2; const dir = new THREE.Vector3(Math.sin(spread) * Math.cos(az), Math.sin(spread) * Math.sin(az), Math.cos(spread)).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), BREACH));
    const size = R * (0.16 + rng() * 0.18); const grp = new THREE.Group(); grp.position.copy(dir).multiplyScalar(R * (1.15 + rng() * 0.5)); const bo = boulder(size, 0.45); bo.lookAt(dir); bo.rotateX(Math.PI / 2); bo.rotateY(rng() * 6); grp.add(bo);
    const n = 12; const inst = new THREE.InstancedMesh(debrisGeo, rubbleMat, n); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(); for (let k = 0; k < n; k++) { const d = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(size * (1.3 + rng() * 1.6)); const sz = size * (0.06 + rng() * 0.14); q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3)); s3.set(sz, sz * (0.6 + rng()), sz); m4.compose(d, q, s3); inst.setMatrixAt(k, m4); } grp.add(inst);
    grp.userData = { dir, base: grp.position.length(), ph: rng() * 6, debris: inst }; group.add(grp); chunks.push(grp); }
  const ring = new THREE.Group(); group.add(ring); addRing(ring, R, 60, 300, rng); ring.rotation.x = 0.5; ring.rotation.z = 0.2;
  group.rotation.y = Math.PI / 2; // breach (+z) towards the road: the body is placed facing the player anyway
  return { group, radius: R, update: (dt, t) => { ring.rotation.y -= dt * 0.03; coreMat.emissiveIntensity = COL.coreGlow * (0.9 + 0.15 * Math.sin(t * 0.9)); (halo.material as THREE.SpriteMaterial).opacity = COL.halo * (0.85 + 0.3 * Math.sin(t * 0.9 + 1)); for (const ch of chunks) { const d = ch.userData.base + R * 0.03 * Math.sin(t * 0.05 + ch.userData.ph); ch.position.copy(ch.userData.dir).multiplyScalar(d); (ch.userData.debris as THREE.Object3D).rotation.y += dt * 0.02; } } };
}

// ---------- 2. dying sun (hue -40, brightness 0.52, cracks 1.5, crust 0.7, corona 1.37, size 1.3) ----------
/** Cracked-crust shader (the dying sun's skin, reused by the Unknown Future obstacles): dark crust scabs, glowing cracks that creep, a rim tint.
 *  Unlit, HDR → bloom. `uCurve` is the game's road-curvature uniform (set by the game; zero elsewhere), `uTime` must be fed per frame. */
export interface CrackLook { crustA: THREE.Color; crustB: THREE.Color; lava: THREE.Color; rim: THREE.Color; hue: number; bright: number; crack: number; crust: number; scale: number /* noise units per world unit: the pattern repeats every ~1/scale units */ }
export const SUN_LOOK: CrackLook = { crustA: new THREE.Color(0.07, 0.012, 0.01), crustB: new THREE.Color(0.30, 0.05, 0.02), lava: new THREE.Color(2.0, 0.45, 0.08), rim: new THREE.Color(0.5, 0.08, 0.02), hue: -40, bright: 0.52, crack: 1.5, crust: 0.7, scale: 1 };
export function makeCrackMaterial(look: CrackLook): THREE.ShaderMaterial {
  const U = { uTime: { value: 0 }, uHue: { value: look.hue }, uBright: { value: look.bright }, uCrack: { value: look.crack }, uCrust: { value: look.crust }, uScale: { value: look.scale },
    uCrustA: { value: look.crustA }, uCrustB: { value: look.crustB }, uLava: { value: look.lava }, uRim: { value: look.rim }, uCurve: { value: new THREE.Vector2(0, 0) } };
  return new THREE.ShaderMaterial({ uniforms: U, toneMapped: false, fog: false,
    vertexShader: `uniform vec2 uCurve; uniform float uScale; varying vec3 vN; varying vec3 vNv;
      void main(){ vN = position * uScale; vNv = normalize(normalMatrix * normal); vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float cDist = -mvPosition.z; mvPosition.x += uCurve.x * cDist * cDist; mvPosition.y += uCurve.y * cDist * cDist; gl_Position = projectionMatrix * mvPosition; }`,
    fragmentShader: `uniform float uTime, uHue, uBright, uCrack, uCrust; uniform vec3 uCrustA, uCrustB, uLava, uRim; varying vec3 vN; varying vec3 vNv; ${GLSL_NOISE}
      void main(){ vec3 n = vN; float t = uTime * 0.05; float scab = fbm(n * 2.5 + t); float crack = fbm(n * 9.0 - t * 2.0);
        float c = smoothstep(0.52, 0.62, crack) * smoothstep(0.35, 0.6, scab) * uCrack;
        vec3 crust = mix(uCrustA, uCrustB, scab) * (1.0 - uCrust * 0.6);
        vec3 col = mix(crust, uLava, clamp(c, 0.0, 1.0)); float limb = pow(1.0 - abs(vNv.z), 2.0); col += uRim * limb * 0.5;
        col = hueShift(col, uHue) * uBright; gl_FragColor = vec4(col, 1.0); }` });
}
function dyingSun(R: number, rng: Rng): Body {
  const mat = makeCrackMaterial({ ...SUN_LOOK, scale: 1 / R }); const U = mat.uniforms;
  const g = new THREE.SphereGeometry(R, 40, 28); const p = g.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize(); const k = 1 + (fbm3(n.x * 3, n.y * 3, n.z * 3) - 0.5) * 0.03; p.setXYZ(i, n.x * R * k, n.y * R * k, n.z * R * k); } g.computeVertexNormals();
  const group = new THREE.Group(); const sun = mesh(g, mat); group.add(sun);
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture('rgba(255,90,30,0.6)', 'rgba(200,50,20,0.22)', 'rgba(120,20,10,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })); corona.scale.setScalar(R * 3.2); group.add(corona);
  void rng;
  return { group, radius: R, update: (dt, t) => { U.uTime.value = t; (corona.material as THREE.SpriteMaterial).opacity = 1.37 * (0.85 + 0.2 * Math.sin(t * 0.7)); sun.rotation.y += dt * 0.02; } };
}

// ---------- 3. ringed giant (hue -9, contrast 1.42, tilt 20, ring 1.2) with nuclear explosions (4, every 0.5 s, life 8 s) ----------
const NEXP = 4;
function ringedGiant(R: number, rng: Rng): Body {
  const U = { uTime: { value: 0 }, uHue: { value: -9 }, uContrast: { value: 1.42 }, uFlash: { value: 1 }, uLife: { value: 8 }, uScar: { value: 0.5 }, uExp: { value: Array.from({ length: NEXP }, () => new THREE.Vector4(0, 0, 1, -1e3)) } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, toneMapped: false, fog: false,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(position); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uTime, uHue, uContrast, uFlash, uLife, uScar; uniform vec4 uExp[${NEXP}]; varying vec3 vN; varying vec3 vV; ${GLSL_NOISE}
      void main(){ vec3 n = vN; float lat = n.y; float swirl = noise(n * 4.0 + uTime * 0.02) * 0.25;
        float band = sin((lat + swirl) * 22.0) * 0.5 + 0.5; float band2 = sin((lat - swirl) * 7.0 + 1.3) * 0.5 + 0.5;
        vec3 a = vec3(0.17, 0.20, 0.42), b = vec3(0.06, 0.07, 0.19), c = vec3(0.28, 0.21, 0.48); vec3 col = mix(mix(a, b, band), c, band2 * 0.35);
        float storm = smoothstep(0.75, 0.9, noise(n * 6.0 + 3.0)); col = mix(col, vec3(0.6, 0.5, 0.75), storm * 0.6);
        col = (col - 0.4) * uContrast + 0.4; col = hueShift(col, uHue);
        float ndl = max(0.0, dot(n, normalize(vec3(0.5, 0.6, 0.6)))); col *= 0.2 + 0.8 * ndl; float limb = pow(1.0 - max(0.0, dot(normalize(n), normalize(vV))), 3.0); col += vec3(0.3, 0.4, 0.9) * limb * 0.5;
        for (int i = 0; i < ${NEXP}; i++) { float age = uTime - uExp[i].w; if (age < 0.0 || age > uLife * 4.0) continue; float d = acos(clamp(dot(n, normalize(uExp[i].xyz)), -1.0, 1.0));
          float flash = exp(-d / 0.07) * exp(-age * 5.0) * 10.0 * uFlash; float rr = 0.03 + age * 0.08; float ring = exp(-pow((d - rr) / 0.016, 2.0)) * exp(-age * 1.1) * 2.5 * uFlash;
          float spot = exp(-d / 0.065) * pow(max(0.0, 1.0 - age / uLife), 0.8) * 2.2; float scar = smoothstep(0.09, 0.03, d) * smoothstep(0.4, 2.0, age) * max(0.0, 1.0 - age / (uLife * 4.0)) * uScar * 2.0;
          col = col * (1.0 - clamp(scar, 0.0, 0.92)); col += vec3(1.2, 1.1, 0.9) * flash + vec3(1.0, 0.7, 0.35) * ring + mix(vec3(0.5, 0.08, 0.02), vec3(1.1, 0.55, 0.15), max(0.0, 1.0 - age / uLife)) * spot * (0.4 + 0.6 * uFlash); }
        gl_FragColor = vec4(col, 1.0); }` });
  const group = new THREE.Group(); const globe = mesh(new THREE.SphereGeometry(R, 48, 32), mat); group.add(globe);
  const [rc, rq] = canvas2d(256, 1); for (let x = 0; x < 256; x++) { const t = x / 255; const a = (t < 0.08 || t > 0.95) ? 0 : 0.35 + 0.45 * Math.abs(Math.sin(t * 40)) * (0.5 + 0.5 * Math.sin(t * 7)); const v = 150 + 60 * Math.sin(t * 23); rq.fillStyle = `rgba(${v | 0},${(v - 20) | 0},${(v + 40) | 0},${a.toFixed(2)})`; rq.fillRect(x, 0, 1, 1); }
  const r0 = R * 1.4, r1 = R * 2.6; const ring = new THREE.RingGeometry(r0, r1, 96, 1); { const uv = ring.attributes.uv, p = ring.attributes.position; for (let i = 0; i < uv.count; i++) { const rr = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (rr - r0) / (r1 - r0), 0.5); } }
  const ringGrp = new THREE.Group(); group.add(ringGrp); const rm = mesh(ring, new THREE.MeshBasicMaterial({ map: srgb(new THREE.CanvasTexture(rc)), transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false })); rm.rotation.x = Math.PI / 2; ringGrp.add(rm);
  { const n = 60; const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rubbleMat, n); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(); for (let i = 0; i < n; i++) { const a = rng() * Math.PI * 2, rr = r0 + rng() * (r1 - r0), y = (rng() - 0.5) * R * 0.08; const sz = R * (0.02 + rng() * 0.05); q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3)); s3.set(sz, sz * (0.6 + rng()), sz); m4.compose(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr), q, s3); inst.setMatrixAt(i, m4); } ringGrp.add(inst); }
  ringGrp.rotation.x = THREE.MathUtils.degToRad(20); ringGrp.rotation.z = 0.2;
  const [sc, sq] = canvas2d(64, 64); { const g = sq.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(120,110,120,0.55)'); g.addColorStop(0.5, 'rgba(90,80,95,0.25)'); g.addColorStop(1, 'rgba(60,50,70,0)'); sq.fillStyle = g; sq.fillRect(0, 0, 64, 64); }
  const smokeTex = new THREE.CanvasTexture(sc); const smokes: THREE.Sprite[] = []; for (let i = 0; i < NEXP; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, fog: false })); s.visible = false; group.add(s); smokes.push(s); }
  let nextAt = 0; const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(); const LIFE = 8, EVERY = 0.5;
  const spawn = (now: number, camLocal: THREE.Vector3) => { const E = U.uExp.value; if (E.filter((e) => now - e.w < LIFE).length >= NEXP) return; let slot = 0; for (let i = 1; i < NEXP; i++) if (E[i].w < E[slot].w) slot = i;
    for (let tries = 0; tries < 12; tries++) { const v = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.8, Math.random() - 0.5).normalize(); if (v.dot(camLocal) < 0.25) v.negate(); let ok = true; for (let i = 0; i < NEXP; i++) if (i !== slot && now - E[i].w < LIFE * 2 && v.angleTo(E[i] as unknown as THREE.Vector3) < 0.35) ok = false; if (ok || tries === 11) { E[slot].set(v.x, v.y, v.z, now); break; } } };
  return { group, radius: R, update: (dt, t, camLocal) => { U.uTime.value = t; globe.rotation.y += dt * 0.01; ringGrp.rotation.y -= dt * 0.02; if (t >= nextAt) { globe.getWorldQuaternion(tmpQ).invert(); spawn(t, tmpV.copy(camLocal).applyQuaternion(tmpQ)); nextAt = t + EVERY; }
    for (let i = 0; i < NEXP; i++) { const e = U.uExp.value[i]; const age = t - e.w; const sp = smokes[i]; if (age < 0.3 || age > LIFE * 0.8) { sp.visible = false; continue; } sp.visible = true; const k = (age - 0.3) / (LIFE * 0.8); tmpV.set(e.x, e.y, e.z).applyQuaternion(globe.quaternion).multiplyScalar(R * 1.03); sp.position.copy(tmpV); sp.scale.setScalar(R * (0.08 + k * 0.34)); (sp.material as THREE.SpriteMaterial).opacity = (1 - k) * 0.9; } } };
}

// ---------- 4. shattered world (hue -60, brightness 1.45, core 1.12, spread 0.45) ----------
function shatteredWorld(R: number, rng: Rng): Body {
  const crustTex = crustTexture(rng); const base = new THREE.Color(0x8a7aa8); const hsl = { h: 0, s: 0, l: 0 }; base.getHSL(hsl);
  const crustMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((hsl.h - 60 / 360 + 1) % 1, hsl.s, Math.min(1, hsl.l * 1.45)), emissive: 0x1a1030, emissiveIntensity: 0.6, map: crustTex, bumpMap: crustTex, bumpScale: 0.3, roughness: 0.95, metalness: 0.02, fog: false });
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x2a2238, emissive: 0x3a2a10, emissiveIntensity: 0.5, roughness: 1, flatShading: true, side: THREE.DoubleSide, fog: false });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x3a3048, emissive: 0x4a3414, emissiveIntensity: 0.7, roughness: 1, flatShading: true, side: THREE.DoubleSide, fog: false });
  const group = new THREE.Group(); const cuts = [0, 1.1, 2.6, 4.2, 6.2832]; const chunks: THREE.Group[] = []; const v = new THREE.Vector3();
  for (let i = 0; i < 4; i++) { const a0 = cuts[i] + 0.12, a1 = cuts[i + 1] - 0.12, off = i * 3.1; const g = new THREE.Group();
    const outer = new THREE.SphereGeometry(R, 40, 26, a0, a1 - a0); { const p = outer.attributes.position, n = outer.attributes.normal; for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k); const d = v.clone().normalize(); const kk = 1 + (fbm3(d.x * 3 + off, d.y * 3, d.z * 3) - 0.5) * 0.1; p.setXYZ(k, d.x * R * kk, d.y * R * kk, d.z * R * kk); n.setXYZ(k, d.x, d.y, d.z); } } g.add(mesh(outer, crustMat));
    const inner = new THREE.SphereGeometry(R * 0.82, 20, 14, a0, a1 - a0).toNonIndexed(); { const ip = inner.attributes.position; for (let k = 0; k < ip.count; k++) { v.fromBufferAttribute(ip, k); const d = v.clone().normalize(); const kk = 1 + (fbm3(d.x * 4 + off + 3, d.y * 4, d.z * 4, 3) - 0.5) * 0.18; ip.setXYZ(k, d.x * R * 0.82 * kk, d.y * R * 0.82 * kk, d.z * R * 0.82 * kk); } } inner.computeVertexNormals(); g.add(mesh(inner, innerMat));
    for (const a of [a0, a1]) { const pts: number[] = [], idx: number[] = []; const segs = 20; for (let s = 0; s <= segs; s++) { const ph = (s / segs) * Math.PI; const dir = new THREE.Vector3(-Math.cos(a) * Math.sin(ph), Math.cos(ph), Math.sin(a) * Math.sin(ph)); const jag = 0.985 - Math.abs(fbm3(dir.x * 7 + off, dir.y * 7, dir.z * 7, 2) - 0.5) * 0.12; pts.push(dir.x * R * jag, dir.y * R * jag, dir.z * R * jag, dir.x * R * 0.82, dir.y * R * 0.82, dir.z * R * 0.82); if (s < segs) { const b = s * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); } }
      const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); eg.setIndex(idx); eg.computeVertexNormals(); g.add(mesh(eg, edgeMat)); }
    const mid = (a0 + a1) / 2; g.userData = { dir: new THREE.Vector3(-Math.cos(mid), 0, Math.sin(mid)), ph: rng() * 6 }; group.add(g); chunks.push(g); }
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2e0).multiplyScalar(1.12), toneMapped: false, fog: false }); group.add(mesh(new THREE.SphereGeometry(R * 0.55, 20, 14), coreMat));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture('rgba(255,235,200,0.8)', 'rgba(255,220,160,0.4)', 'rgba(255,200,120,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, opacity: 0.86 })); glow.scale.setScalar(R * 1.7); group.add(glow);
  const ring = new THREE.Group(); group.add(ring); addRing(ring, R, 50, 250, rng, 0.5);
  return { group, radius: R, update: (dt, t) => { group.rotation.y += dt * 0.015; ring.rotation.y -= dt * 0.03; for (const c of chunks) c.position.copy(c.userData.dir).multiplyScalar(R * (0.45 + 0.04 * Math.sin(t * 0.3 + c.userData.ph))); } };
}

// ---------- 5. dead moon (hue 44, brightness 0.53, craters 0.91) ----------
function deadMoon(R: number, rng: Rng): Body {
  const W = 1024, H = 512;
  let s = 977 + Math.floor(rng() * 1000); const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const list: { lon: number; lat: number; rad: number; fresh: boolean; age: number }[] = [];
  for (let i = 0; i < 820; i++) { const u = r(); const lat = Math.asin(2 * r() - 1); const lon = r() * Math.PI * 2; const rad = 0.006 + Math.pow(u, 6) * 0.11; list.push({ lon, lat, rad, fresh: r() < 0.04 && rad > 0.02, age: r() }); }
  for (const c of list.slice()) if (c.rad > 0.06) for (let k = 0; k < 10; k++) { const a = r() * 6.28, d = c.rad * (1.3 + r() * 1.5); list.push({ lon: c.lon + Math.cos(a) * d / Math.max(0.2, Math.cos(c.lat)), lat: c.lat + Math.sin(a) * d, rad: 0.004 + r() * 0.01, fresh: false, age: 0.2 }); }
  list.sort((a, b) => b.age - a.age);
  const [cc, q] = canvas2d(W, H), [hc, h] = canvas2d(W, H);
  q.fillStyle = '#8f8d8a'; q.fillRect(0, 0, W, H); h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  q.globalAlpha = 0.5; for (let i = 0; i < 9; i++) { const x = r() * W, y = H * (0.25 + r() * 0.5), rx = 45 + r() * 130, ry = 30 + r() * 75; const g = q.createRadialGradient(x, y, 0, x, y, rx); g.addColorStop(0, '#5a5c62'); g.addColorStop(0.7, '#5f6166'); g.addColorStop(1, 'rgba(95,97,102,0)'); q.fillStyle = g; q.beginPath(); q.ellipse(x, y, rx, ry, r() * 3, 0, 6.2832); q.fill(); } q.globalAlpha = 1;
  q.globalAlpha = 0.22; for (let i = 0; i < 30000; i++) { const v = (90 + r() * 120) | 0; q.fillStyle = `rgb(${v},${v},${v})`; q.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); } q.globalAlpha = 1;
  h.globalAlpha = 0.18; for (let i = 0; i < 20000; i++) { const v = (100 + r() * 56) | 0; h.fillStyle = `rgb(${v},${v},${v})`; h.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); } h.globalAlpha = 1;
  const px = (lon: number, lat: number) => [((lon / 6.2832) % 1 + 1) % 1 * W, (0.5 - lat / Math.PI) * H];
  for (const c of list) { const [x, y] = px(c.lon, c.lat); const ry = c.rad / Math.PI * H; const rx = ry / Math.max(0.15, Math.cos(c.lat));
    const draw = (ctx: CanvasRenderingContext2D, fn: (ctx: CanvasRenderingContext2D) => void) => { for (const dx of [0, W, -W]) { ctx.save(); ctx.translate(x + dx, y); ctx.scale(rx / ry, 1); fn(ctx); ctx.restore(); } };
    if (c.fresh) draw(q, (ctx) => { ctx.globalAlpha = 0.35; for (let k = 0; k < 14; k++) { const a = r() * 6.2832, L = ry * (2.5 + r() * 4); const g = ctx.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L); g.addColorStop(0, 'rgba(230,228,222,0.9)'); g.addColorStop(1, 'rgba(230,228,222,0)'); ctx.strokeStyle = g; ctx.lineWidth = ry * (0.12 + r() * 0.2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke(); } ctx.globalAlpha = 1; });
    draw(q, (ctx) => { const floor = ctx.createRadialGradient(0, 0, 0, 0, 0, ry); floor.addColorStop(0, c.rad > 0.05 ? 'rgba(120,118,114,0.9)' : 'rgba(96,94,92,0.85)'); floor.addColorStop(0.72, 'rgba(88,86,84,0.85)'); floor.addColorStop(0.86, 'rgba(70,68,66,0.9)'); floor.addColorStop(0.9, 'rgba(176,174,168,0.95)'); floor.addColorStop(1, 'rgba(160,158,152,0)'); ctx.fillStyle = floor; ctx.beginPath(); ctx.arc(0, 0, ry * 1.08, 0, 6.2832); ctx.fill();
      const sh = ctx.createLinearGradient(-ry, -ry, ry, ry); sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(255,255,255,0.18)'); ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, ry * 0.9, 0, 6.2832); ctx.fill();
      if (c.rad > 0.05) { const pk = ctx.createRadialGradient(0, 0, 0, 0, 0, ry * 0.22); pk.addColorStop(0, 'rgba(170,168,162,0.95)'); pk.addColorStop(1, 'rgba(170,168,162,0)'); ctx.fillStyle = pk; ctx.beginPath(); ctx.arc(0, 0, ry * 0.22, 0, 6.2832); ctx.fill(); } });
    draw(h, (ctx) => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry * 1.15); const d = c.rad > 0.03 ? 1 : 0.6; const lv = (k: number) => `rgba(${(128 + k * d) | 0},${(128 + k * d) | 0},${(128 + k * d) | 0},1)`; g.addColorStop(0, c.rad > 0.05 ? 'rgba(150,150,150,1)' : lv(-60)); g.addColorStop(0.2, lv(-70)); g.addColorStop(0.8, lv(-50)); g.addColorStop(0.9, lv(90)); g.addColorStop(1, 'rgba(128,128,128,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry * 1.15, 0, 6.2832); ctx.fill(); }); }
  const map = srgb(new THREE.CanvasTexture(cc)); map.wrapS = THREE.RepeatWrapping; map.anisotropy = 8; const bump = new THREE.CanvasTexture(hc); bump.wrapS = THREE.RepeatWrapping; bump.anisotropy = 8;
  const g = new THREE.SphereGeometry(R, 96, 64); const p = g.attributes.position; const v = new THREE.Vector3(); const big = list.filter((c) => c.rad > 0.025); const dirs = big.map((c) => new THREE.Vector3(-Math.cos(c.lon) * Math.cos(c.lat), Math.sin(c.lat), Math.sin(c.lon) * Math.cos(c.lat)));
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize(); let k = 1; for (let j = 0; j < big.length; j++) { const c = big[j]; const d = n.angleTo(dirs[j]); if (d > c.rad * 1.2) continue; const t = d / c.rad; const depth = c.rad * 0.16; if (t < 0.7) k -= depth * (c.rad > 0.05 && t < 0.18 ? 1 - 0.5 * (1 - t / 0.18) : 1); else if (t < 0.9) k -= depth * (1 - sm((t - 0.7) / 0.2)) - depth * 0.5 * sm((t - 0.7) / 0.2); else if (t < 1.2) k += depth * 0.5 * (1 - sm((t - 0.9) / 0.3)); } p.setXYZ(i, n.x * R * k, n.y * R * k, n.z * R * k); }
  g.computeVertexNormals();
  const base = new THREE.Color(0xd2cfc8); const hsl = { h: 0, s: 0, l: 0 }; base.getHSL(hsl);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((hsl.h + 44 / 360) % 1, Math.min(1, hsl.s + 44 / 400), Math.min(1, hsl.l * 0.53)), roughness: 1, metalness: 0, map, bumpMap: bump, bumpScale: 1.2, fog: false });
  const group = new THREE.Group(); const m = mesh(g, mat); group.add(m);
  return { group, radius: R, update: (dt) => { m.rotation.y += dt * 0.04; } };
}

// ---------- 6. lone rocks (hue 6, brightness 1.52, roughness 1.75) ----------
const SHAPES: ((n: THREE.Vector3) => number)[] = [
  (n) => 1 / Math.hypot(n.x / 1.7, n.y / 0.8, n.z / 0.9),
  (n) => 1 / Math.hypot(n.x / 1.3, n.y / 0.55, n.z / 1.2),
  (n) => { const a = 1 / Math.hypot((n.x - 0.45) / 0.8, n.y / 0.75, n.z / 0.75), b = 1 / Math.hypot((n.x + 0.45) / 0.7, n.y / 0.65, n.z / 0.65); return Math.max(a, b) * 0.62 + Math.min(a, b) * 0.15; },
  (n) => { const d = n.angleTo(new THREE.Vector3(0.6, 0.5, 0.6).normalize()); return 1 - 0.42 * (1 - sm(Math.min(1, d / 1.1))); },
  (n) => 1 / Math.max(Math.abs(n.x) / 1.05, Math.abs(n.y) / 0.9, Math.abs(n.z) / 0.95, Math.hypot(n.x, n.y, n.z) * 0.92),
  (n) => 1 / Math.max(Math.abs(n.x) / 1.4, Math.abs(n.y) / 0.45, Math.abs(n.z) / 1.0, Math.hypot(n.x, n.y, n.z) * 0.8),
];
/** asteroid geometry: one of the 6 shapes, radius r, noise offset off (also used by the Unknown Future obstacles) */
export function rockGeometry(shape: number, r: number, off: number, segs = 40): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, segs, Math.round(segs * 0.7)); const p = g.attributes.position, uv = g.attributes.uv; const v = new THREE.Vector3(); const K = 1.75;
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize(); let k = SHAPES[shape](n); k *= 1 + (fbm3(n.x * 2.2 + off, n.y * 2.2, n.z * 2.2, 3) - 0.5) * 0.45 * K + (fbm3(n.x * 6 + off * 2, n.y * 6, n.z * 6, 2) - 0.5) * 0.12 * K; p.setXYZ(i, n.x * r * k, n.y * r * k, n.z * r * k); uv.setXY(i, uv.getX(i) * 2, uv.getY(i)); }
  g.computeVertexNormals(); return g;
}
/** the approved loose-rock material (hue 6, brightness 1.52), fog off: for the sky; with fog for things near the road */
export function makeRockMaterial(rng: Rng, fog = false): THREE.MeshStandardMaterial {
  const rockTex = rockTexture(rng); const base = new THREE.Color(0x4a5078); const hsl = { h: 0, s: 0, l: 0 }; base.getHSL(hsl);
  return new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((hsl.h + 6 / 360) % 1, hsl.s, Math.min(1, hsl.l * 1.52)), roughness: 1, metalness: 0, map: rockTex, bumpMap: rockTex, bumpScale: 0.25, fog });
}
function loneRock(shape: number, r: number, off: number): Body {
  const m = mesh(rockGeometry(shape, r, off), rockMat); const group = new THREE.Group(); group.add(m);
  const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.12);
  return { group, radius: r, update: (dt) => { m.rotation.x += spin.x * dt; m.rotation.y += spin.y * dt; m.rotation.z += spin.z * dt; } };
}

// ---------- the sky: bodies built once, composed at every entry ----------
export class SpaceSky {
  readonly group = new THREE.Group(); // add to the game's sky group (turns with the road's heading)
  private bodies: Body[] = []; // 4 feature bodies: broken, sun, giant, shattered
  private moons: Body[] = []; // 2 dead moons (different crater seeds)
  private rocks: Body[] = []; // 32 rocks (6 shapes)
  private active: Body[] = [];
  private tmp = new THREE.Vector3();

  /** builds everything (call once, on the start screen) */
  build(rng: Rng) {
    dotTex = dotTexture();
    rockMat = makeRockMaterial(rng);
    rubbleMat = new THREE.MeshStandardMaterial({ color: 0x2e3452, emissive: 0x0c1024, emissiveIntensity: 0.6, roughness: 0.95, flatShading: true, fog: false });
    this.bodies = [brokenPlanet(22, rng), dyingSun(26 * 1.3, rng), ringedGiant(20, rng), shatteredWorld(14, rng)];
    this.moons = [deadMoon(10, rng), deadMoon(10, rng)];
    for (let i = 0; i < 32; i++) this.rocks.push(loneRock(i % 6, 5, rng() * 9));
    for (const b of [...this.bodies, ...this.moons, ...this.rocks]) { b.group.visible = false; this.group.add(b.group); }
  }

  /** a new composition (call at every entry into the era): 2 feature bodies in the portrait zone (above or below the
   * horizon), 1-2 moons anywhere, every rock thrown at random (size 0.6..1.2) */
  compose(rng: Rng) {
    for (const b of [...this.bodies, ...this.moons, ...this.rocks]) b.group.visible = false;
    this.active = [];
    const place = (b: Body, az: number, el: number, dist: number, scale = 1) => { b.group.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist); b.group.scale.setScalar(scale); b.group.visible = true; b.group.lookAt(0, 0, 0); b.group.rotateY(Math.PI); this.active.push(b); };
    // feature bodies: pick 2 of 4; one above the horizon, one below (seen through the glass road), both within ±12° azimuth
    const idx = [0, 1, 2, 3].sort(() => rng() - 0.5).slice(0, 2);
    const aboveFirst = rng() < 0.5;
    idx.forEach((i, k) => { const above = (k === 0) === aboveFirst; const az = (rng() < 0.5 ? -1 : 1) * THREE.MathUtils.degToRad(4 + rng() * 8) * (k === 0 ? 1 : -1); const el = THREE.MathUtils.degToRad(above ? 10 + rng() * 14 : -(8 + rng() * 14)); place(this.bodies[i], az, el, 130 + rng() * 50); });
    // moons: 1-2, anywhere (sides and below included)
    const nMoons = 1 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < nMoons; i++) place(this.moons[i], (rng() - 0.5) * Math.PI * 1.6, THREE.MathUtils.degToRad(-40 + rng() * 90), 110 + rng() * 80);
    // rocks: all over the sphere, random size
    for (const r of this.rocks) place(r, rng() * Math.PI * 2, Math.asin(2 * rng() - 1), 100 + rng() * 150, 0.6 + rng() * 0.6);
  }

  /** shows/hides every body (used by the shader warm-up; compose() sets the real visibility) */
  setAllVisible(v: boolean) { for (const b of [...this.bodies, ...this.moons, ...this.rocks]) b.group.visible = v; }

  /** per-frame animation (only the active bodies); camera position in the sky group's local space */
  update(dt: number, t: number, camWorld: THREE.Vector3) {
    for (const b of this.active) { if (!b.update) continue; this.tmp.copy(camWorld); b.group.worldToLocal(this.tmp); b.update(dt, t, this.tmp.normalize()); }
  }
}

// ---------- nebula texture for the sky dome (equirect; sampled by the dome shader) ----------
export function makeNebulaTexture(rng: Rng): THREE.CanvasTexture {
  const W = 512, H = 256; const [c, q] = canvas2d(W, H);
  q.fillStyle = '#000'; q.fillRect(0, 0, W, H);
  const cols = ['rgba(58,26,106,A)', 'rgba(15,58,90,A)', 'rgba(70,30,120,A)', 'rgba(20,40,110,A)'];
  for (let i = 0; i < 26; i++) { const x = rng() * W, y = H * (0.1 + rng() * 0.8), rx = 40 + rng() * 120, ry = 20 + rng() * 70; const g = q.createRadialGradient(x, y, 0, x, y, rx); const col = cols[(rng() * cols.length) | 0]; g.addColorStop(0, col.replace('A', (0.35 + rng() * 0.3).toFixed(2))); g.addColorStop(0.6, col.replace('A', '0.12')); g.addColorStop(1, col.replace('A', '0')); q.fillStyle = g; for (const dx of [0, W, -W]) { q.save(); q.translate(x + dx, y); q.scale(1, ry / rx); q.beginPath(); q.arc(0, 0, rx, 0, 6.2832); q.fill(); q.restore(); } }
  const t = srgb(new THREE.CanvasTexture(c)); t.wrapS = THREE.RepeatWrapping; return t;
}

// ---------- glass road extras per track segment: floating light tubes with emitters instead of curbs (no filaments under the glass: they confused the player) ----------
export interface VoidRoadMats { railL: THREE.Material; railR: THREE.Material; emitter: THREE.Material }
export function buildVoidRoad(len: number, halfW: number, m: VoidRoadMats): THREE.Group {
  const grp = new THREE.Group();
  for (const s of [-1, 1]) { const tube = mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 8), s < 0 ? m.railL : m.railR); tube.rotation.x = Math.PI / 2; tube.position.set(s * (halfW + 0.3), 0.55, 0); grp.add(tube);
    for (let z = -len / 2 + 4; z < len / 2; z += 8) { const e = mesh(new THREE.OctahedronGeometry(0.22, 0), m.emitter); e.position.set(s * (halfW + 0.3), 0.55, z); grp.add(e); } }
  return grp;
}

/** cosmic dust drifting past the player (positions recycled along z) */
export class CosmicDust {
  readonly points: THREE.Points; private readonly n = 400; private readonly geo: THREE.BufferGeometry;
  private place(p: THREE.BufferAttribute, i: number, z: number) { let x = (Math.random() - 0.5) * 60, y = (Math.random() - 0.3) * 24; if (Math.abs(x) < 6 && y < 6 && y > -2) x += x < 0 ? -6 : 6; p.setXYZ(i, x, y, z); } // never through the lane near the camera
  constructor() { this.geo = new THREE.BufferGeometry(); const p = new THREE.BufferAttribute(new Float32Array(this.n * 3), 3); this.geo.setAttribute('position', p); for (let i = 0; i < this.n; i++) this.place(p, i, -Math.random() * 120 + 10); this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({ color: 0xbfd4ff, map: dotTexture(), size: 0.1, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false, alphaTest: 0.05 })); this.points.visible = false; }
  update(move: number) { const p = this.geo.attributes.position as THREE.BufferAttribute; for (let i = 0; i < this.n; i++) { const z = p.getZ(i) + move; if (z > 12) this.place(p, i, z - 120); else p.setZ(i, z); } p.needsUpdate = true; }
}
