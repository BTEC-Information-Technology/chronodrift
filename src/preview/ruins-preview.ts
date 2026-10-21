// Standalone preview of the Unknown Future ruins (dead Neo-Cyberpunk block broken in three). Bundled with esbuild; not part of the game build.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { INTERIOR_KINDS, type BuildingSpec, type CityMats } from '../game/city';
import { makeFacade } from '../game/cyber';
import { buildRuin, type RuinMats } from '../game/ruins';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01020a);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
scene.add(new THREE.HemisphereLight(0x4a5a9a, 0x05060f, 0.7));
const key = new THREE.DirectionalLight(0xfff4e8, 1.2); key.position.set(6, 4, 8); scene.add(key);
const rim = new THREE.DirectionalLight(0x6af0ff, 0.4); rim.position.set(-6, 5, -8); scene.add(rim);
let seed = 23; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rr = (a: number, b: number) => a + rnd() * (b - a);
// stars
{ const N = 1200; const pos = new Float32Array(N * 3), size = new Float32Array(N), bright = new Float32Array(N);
  for (let i = 0; i < N; i++) { const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), r = 650; pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.cos(ph); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); const t = rnd() * rnd(); size[i] = 2.5 + 6 * t; bright[i] = 0.88 + 0.12 * t; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  scene.add(new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aSize; attribute float aBright; uniform float uPixelRatio; varying float vB; void main(){ vB = aBright; gl_PointSize = aSize * uPixelRatio; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying float vB; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.35, d); if (a < 0.02) discard; gl_FragColor = vec4(vec3(vB), a); }' }))); }

// ---------- unlit materials: the city's set without any light ----------
const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1, ...o });
const interiors = {} as CityMats['interiors'];
for (const k of INTERIOR_KINDS) interiors[k] = [std({ color: 0x05060a })];
const city: CityMats = {
  concrete: std({ color: 0x3a3f5c, roughness: 0.7 }), dark: std({ color: 0x0a0b14, roughness: 0.6, metalness: 0.3 }), white: std({ color: 0x7a7d88 }), red: std({ color: 0x4a161c }),
  warm: std({ color: 0x14110c }), glassDark: std({ color: 0x0b1a2c, roughness: 0.1, metalness: 0.8 }),
  glassSheen: new THREE.MeshStandardMaterial({ color: 0x9fdcff, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.1, depthWrite: false }),
  hazardY: std({ color: 0x8a7a2a }), hazardK: std({ color: 0x15161e }), interiors,
};
const innerMat = std({ color: 0x343746, emissive: 0x14151c, emissiveIntensity: 0.6, roughness: 1, flatShading: true }); // a little self-light: the cuts stay readable in shadow
const rebarMat = std({ color: 0x4a3426, roughness: 0.7, metalness: 0.4 });
const tubeMat = std({ color: 0x0c1018, roughness: 0.35, metalness: 0.2 });
const facadeMat = (w: number, h: number) => { const f = makeFacade(w, h, rnd, { normal: true, dead: true }); return new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normal ?? null, normalScale: new THREE.Vector2(0.9, 0.9), color: 0xb4bace, roughness: 0.7, metalness: 0.1 }); };

// ---------- the field: two dead blocks ----------
interface Shown { pieces: THREE.Group[]; home: THREE.Vector3[]; dir: THREE.Vector3[]; tilt: THREE.Vector3[]; spin: THREE.Vector3[]; debris: THREE.Mesh[] }
const shown: Shown[] = []; let field: THREE.Group | null = null;
const S: Record<string, number> = {};
function buildAll() {
  if (field) { field.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); scene.remove(field); }
  field = new THREE.Group(); scene.add(field); shown.length = 0;
  const specs: BuildingSpec[] = [
    { w: 10, topH: rr(26, 32), d: 10, side: -1, h1: 0, tw: 7, td: 8, towerX: rr(-1, 1) },
    { w: rr(7, 9), topH: rr(20, 26), d: 9, side: 1, h1: 0, tw: 5.5, td: 7, towerX: rr(-1, 1) },
  ];
  specs.forEach((spec, k) => {
    spec.h1 = 4.2 + (spec.topH - 4.2) * rr(0.55, 0.8);
    const m: RuinMats = { body: facadeMat(spec.w, spec.h1 - 4.2), tower: facadeMat(spec.tw, spec.topH - spec.h1), inner: innerMat, rebar: rebarMat, tube: tubeMat, city };
    const ruin = buildRuin(spec, m, rnd, { jag: S.jag / 100, rebar: S.rebar / 100 });
    const root = new THREE.Group(); root.position.set(k === 0 ? -15 : 13, 0, 0); field!.add(root);
    const bc = new THREE.Vector3(0, spec.topH / 2, 0); // building centre: pieces drift away from it
    const s: Shown = { pieces: ruin.pieces, home: [], dir: [], tilt: [], spin: [], debris: [] };
    ruin.pieces.forEach((p, i) => {
      root.add(p);
      const c = (p.userData.center as THREE.Vector3).clone().sub(bc); s.home.push(c);
      const dir = c.clone().normalize(); dir.x += rr(-0.5, 0.5); dir.z += rr(-0.5, 0.5); if (i === 1) dir.y *= 0.3; s.dir.push(dir.normalize());
      s.tilt.push(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1))); s.spin.push(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(0.06));
    });
    for (let i = 0; i < S.debris; i++) { const g = rnd() < 0.5 ? new THREE.BoxGeometry(rr(0.3, 0.9), rr(0.2, 0.5), rr(0.3, 0.8)) : new THREE.TetrahedronGeometry(rr(0.3, 0.6), 0); const d = new THREE.Mesh(g, rnd() < 0.3 ? rebarMat : innerMat); d.userData = { a: rnd() * 6.28, r: rr(7, 12), y: rr(-10, 12), w: rr(0.04, 0.1) * (rnd() < 0.5 ? -1 : 1), spin: new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)) }; root.add(d); s.debris.push(d); }
    shown.push(s);
  });
  apply();
}

// ---------- tuning ----------
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.3, 0.9); composer.addPass(bloom); composer.addPass(new OutputPass());
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.target.set(0, 0, 0); camera.position.set(0, 6, 74);
const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
new ResizeObserver(resize).observe(canvas); resize();
const defaults: Record<string, number> = { gap: 30, tilt: 12, jag: 70, rebar: 100, size: 100, spin: 100, debris: 4 };
const vals = document.getElementById('vals')!; let rebuildTimer = 0; let built = { jag: -1, rebar: -1, debris: -1 };
const apply = () => {
  if (field) field.scale.setScalar(S.size / 100);
  if (built.jag !== S.jag || built.rebar !== S.rebar || built.debris !== S.debris) { clearTimeout(rebuildTimer); rebuildTimer = window.setTimeout(() => { built = { jag: S.jag, rebar: S.rebar, debris: S.debris }; seed = reseedBase; buildAll(); }, 150); }
  vals.textContent = `gap ${(S.gap / 10).toFixed(1)}\ntilt ${S.tilt} deg\njag ${(S.jag / 100).toFixed(2)}\nrebar ${(S.rebar / 100).toFixed(2)}\nsize ${(S.size / 100).toFixed(2)}\nspin ${(S.spin / 100).toFixed(2)}\ndebris ${S.debris}`;
};
const fmt = (k: string, v: number) => k === 'tilt' || k === 'debris' ? `${v}` : k === 'gap' ? (v / 10).toFixed(1) : (v / 100).toFixed(2);
for (const k of Object.keys(defaults)) { const el = document.getElementById(k) as HTMLInputElement; const out = el.nextElementSibling!; S[k] = defaults[k]; out.textContent = fmt(k, S[k]); el.addEventListener('input', () => { S[k] = Number(el.value); out.textContent = fmt(k, S[k]); apply(); }); }
document.getElementById('reset')!.addEventListener('click', () => { for (const k of Object.keys(defaults)) { S[k] = defaults[k]; const el = document.getElementById(k) as HTMLInputElement; el.value = String(defaults[k]); el.nextElementSibling!.textContent = fmt(k, S[k]); } apply(); });
let reseedBase = 23;
document.getElementById('next')!.addEventListener('click', () => { reseedBase = (reseedBase * 7 + 13) % 2147483647; seed = reseedBase; built = { jag: S.jag, rebar: S.rebar, debris: S.debris }; buildAll(); });
built = { jag: defaults.jag, rebar: defaults.rebar, debris: defaults.debris }; buildAll();
const press = (id: string, on: boolean) => document.getElementById(id)!.setAttribute('aria-pressed', String(on));
let bloomOn = true, motionOn = true;
document.getElementById('bloom')!.addEventListener('click', () => { bloomOn = !bloomOn; bloom.enabled = bloomOn; press('bloom', bloomOn); });
document.getElementById('motion')!.addEventListener('click', () => { motionOn = !motionOn; press('motion', motionOn); });
const clock = new THREE.Clock(); let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta()); if (motionOn) t += dt * S.spin / 100;
  const T = S.tilt * Math.PI / 180, gap = S.gap / 10;
  for (const s of shown) {
    s.pieces.forEach((p, i) => { p.position.copy(s.home[i]).addScaledVector(s.dir[i], gap); p.position.y += Math.sin(t * 0.3 + i) * 0.15; const tl = s.tilt[i], sp = s.spin[i]; p.rotation.set(tl.x * T + sp.x * t, tl.y * T + sp.y * t, tl.z * T + sp.z * t); });
    for (const d of s.debris) { const u = d.userData; const a = u.a + t * u.w; d.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.4 + u.a) * 0.4, Math.sin(a) * u.r); d.rotation.x += u.spin.x * dt; d.rotation.y += u.spin.y * dt; }
  }
  controls.update(); composer.render();
});
