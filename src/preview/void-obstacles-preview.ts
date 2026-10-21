// Standalone preview of the Unknown Future obstacle looks (bundled with esbuild into an HTML page). Not part of the game build.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ERAS } from '../game/eras';
import { makeRockMaterial } from '../game/space';
import { buildVoidBlock, buildVoidOverhead, buildVoidWall, makeVoidObstacleMats, animateVoidObstacles, animateVoidObstacle, ROLL_SPEED } from '../game/voidObstacles';

const BLOCK_H = 1.1, OVERHEAD_Y = 1.5, WALL_H = 2.6;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
const era = ERAS[4];
scene.background = new THREE.Color(era.bg);
scene.fog = new THREE.Fog(era.fog, 30, 250);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
scene.add(new THREE.HemisphereLight(era.hemiSky, era.hemiGround, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 6, 5); scene.add(key);
let seed = 29; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
// stars
{ const N = 1200; const pos = new Float32Array(N * 3), size = new Float32Array(N), bright = new Float32Array(N);
  for (let i = 0; i < N; i++) { const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), r = 650; pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.cos(ph); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); const t = rnd() * rnd(); size[i] = 2.5 + 6 * t; bright[i] = 0.88 + 0.12 * t; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  scene.add(new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aSize; attribute float aBright; uniform float uPixelRatio; varying float vB; void main(){ vB = aBright; gl_PointSize = aSize * uPixelRatio; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying float vB; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.35, d); if (a < 0.02) discard; gl_FragColor = vec4(vec3(vB), a); }' }))); }
// the glass road with its lane lines and the floating tubes (context, as in the era)
const road = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 80), new THREE.MeshStandardMaterial({ color: era.ground, emissive: era.groundEmissive, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.55 }));
road.rotation.x = -Math.PI / 2; road.position.z = -20; scene.add(road);
for (const x of [-1.1, 1.1]) for (let z = 6; z > -60; z -= 4) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 2), new THREE.MeshBasicMaterial({ color: era.line })); m.position.set(x, 0.011, z); scene.add(m); }
const tubeMat = (c: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.5), toneMapped: false });
for (const [s, c] of [[-1, era.railL], [1, era.railR]] as [number, number][]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 80, 8), tubeMat(c)); t.rotation.x = Math.PI / 2; t.position.set(s * 3.9, 0.55, -20); scene.add(t); }

// ---------- materials: the game's Unknown Future set ----------
const mats = makeVoidObstacleMats(makeRockMaterial(rnd, true), rnd);

const looks: THREE.Group[] = [];
const put = (g: THREE.Group, x: number, y: number, z: number) => { g.position.set(x, y, z); scene.add(g); looks.push(g); return g; };
function buildAll() {
  for (const g of looks) { g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); scene.remove(g); } looks.length = 0;
  put(buildVoidBlock(mats), -2.2, BLOCK_H / 2, 0);
  put(buildVoidOverhead(mats), 0, OVERHEAD_Y + 0.35, -3);
  put(buildVoidWall(mats), 2.2, WALL_H / 2, -1);
  // a second set further down the road, to judge them at distance
  put(buildVoidWall(mats), -2.2, WALL_H / 2, -16);
  put(buildVoidBlock(mats), 0, BLOCK_H / 2, -20);
  put(buildVoidOverhead(mats), 2.2, OVERHEAD_Y + 0.35, -24);
}
buildAll();

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.3, 0.9); composer.addPass(bloom); composer.addPass(new OutputPass());
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
const camGame = () => { controls.target.set(0, 1.2, -4); camera.position.set(0, 3.6, 7.5); controls.update(); };
const camClose = () => { controls.target.set(0, 1.2, -1); camera.position.set(3.5, 2.6, 4.5); controls.update(); };
camClose();
const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
new ResizeObserver(resize).observe(canvas); resize();
const press = (id: string, on: boolean) => document.getElementById(id)!.setAttribute('aria-pressed', String(on));
let bloomOn = true;
document.getElementById('bloom')!.addEventListener('click', () => { bloomOn = !bloomOn; bloom.enabled = bloomOn; press('bloom', bloomOn); });
document.getElementById('camGame')!.addEventListener('click', camGame);
document.getElementById('camClose')!.addEventListener('click', camClose);
const glow = document.getElementById('glow') as HTMLInputElement;
glow.addEventListener('input', () => { const g = Number(glow.value) / 100; glow.nextElementSibling!.textContent = g.toFixed(2); mats.sun.uniforms.uCrack.value = 1.5 * g; mats.green.uniforms.uCrack.value = 1.2 * g; });
const scaleEl = document.getElementById('scale') as HTMLInputElement;
scaleEl.addEventListener('input', () => { const v = Number(scaleEl.value) / 100; scaleEl.nextElementSibling!.textContent = v.toFixed(2); mats.sun.uniforms.uScale.value = v; mats.green.uniforms.uScale.value = v; });
const rimEl = document.getElementById('rim') as HTMLInputElement;
rimEl.addEventListener('input', () => { const v = Number(rimEl.value) / 100; rimEl.nextElementSibling!.textContent = v.toFixed(2); (mats.green.uniforms.uRim.value as THREE.Color).set(0.2, 0.9, 0.45).multiplyScalar(v); (mats.sun.uniforms.uRim.value as THREE.Color).set(0.5, 0.08, 0.02).multiplyScalar(v); });
const spin = document.getElementById('spin') as HTMLInputElement;
spin.addEventListener('input', () => { const v = Number(spin.value) / 100; spin.nextElementSibling!.textContent = v.toFixed(2); for (const g of looks) if (g.userData.spinX) g.userData.spinX = ROLL_SPEED * v / 0.68; });
const clock = new THREE.Clock(); let t = 0;
renderer.setAnimationLoop(() => { const dt = Math.min(0.05, clock.getDelta()); t += dt; animateVoidObstacles(mats, t); for (const g of looks) animateVoidObstacle(g, dt); controls.update(); composer.render(); });
