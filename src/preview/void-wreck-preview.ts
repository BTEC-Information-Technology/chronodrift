// Standalone preview of the Unknown Future maglev wreck (train variant 2). Bundled with esbuild into an HTML page; not part of the game build.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ERAS } from '../game/eras';
import { buildWreckTrain, makeWreckMats } from '../game/voidWreck';

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
let seed = 37; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
{ const N = 1200; const pos = new Float32Array(N * 3), size = new Float32Array(N), bright = new Float32Array(N);
  for (let i = 0; i < N; i++) { const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), r = 650; pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.cos(ph); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); const t = rnd() * rnd(); size[i] = 2.5 + 6 * t; bright[i] = 0.88 + 0.12 * t; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  scene.add(new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aSize; attribute float aBright; uniform float uPixelRatio; varying float vB; void main(){ vB = aBright; gl_PointSize = aSize * uPixelRatio; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying float vB; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.35, d); if (a < 0.02) discard; gl_FragColor = vec4(vec3(vB), a); }' }))); }
const road = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 120), new THREE.MeshStandardMaterial({ color: era.ground, emissive: era.groundEmissive, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.55 }));
road.rotation.x = -Math.PI / 2; road.position.z = -40; scene.add(road);
for (const x of [-1.1, 1.1]) for (let z = 8; z > -100; z -= 4) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 2), new THREE.MeshBasicMaterial({ color: era.line })); m.position.set(x, 0.011, z); scene.add(m); }
const tubeMat = (c: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.5), toneMapped: false });
for (const [s, c] of [[-1, era.railL], [1, era.railR]] as [number, number][]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 120, 8), tubeMat(c)); t.rotation.x = Math.PI / 2; t.position.set(s * 3.9, 0.55, -40); scene.add(t); }

const mats = makeWreckMats(); (window as unknown as { __scene: THREE.Scene }).__scene = scene;
const put = (g: THREE.Group, x: number, z: number, blocking: boolean) => { g.position.set(x, 0, z); if (blocking) g.rotation.y = Math.PI; scene.add(g); return g; };
put(buildWreckTrain(mats, 6), -2.2, -3, false);
put(buildWreckTrain(mats, 10), 2.2, -8, false);
put(buildWreckTrain(mats, 7), 0, -22, true);
put(buildWreckTrain(mats, 15), -2.2, -34, false);
put(buildWreckTrain(mats, 12), 2.2, -46, true);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.3, 0.9); composer.addPass(bloom); composer.addPass(new OutputPass());
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
const camGame = () => { controls.target.set(0, 1.2, -6); camera.position.set(0, 3.6, 7.5); controls.update(); };
const camClose = () => { controls.target.set(0, 1.4, -4); camera.position.set(6, 3.2, 6); controls.update(); };
camClose();
const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
new ResizeObserver(resize).observe(canvas); resize();
const press = (id: string, on: boolean) => document.getElementById(id)!.setAttribute('aria-pressed', String(on));
let bloomOn = true;
document.getElementById('bloom')!.addEventListener('click', () => { bloomOn = !bloomOn; bloom.enabled = bloomOn; press('bloom', bloomOn); });
document.getElementById('camGame')!.addEventListener('click', camGame);
document.getElementById('camClose')!.addEventListener('click', camClose);
const slider = (id: string, fn: (v: number) => void) => { const el = document.getElementById(id) as HTMLInputElement; el.addEventListener('input', () => { const v = Number(el.value) / 100; el.nextElementSibling!.textContent = v.toFixed(2); fn(v); }); };
slider('rust', (v) => { mats.rust.uniforms.uRust.value = v; mats.rustDark.uniforms.uRust.value = v * 0.5 / 0.55; });
slider('rscale', (v) => { mats.rust.uniforms.uScale.value = v; mats.rustDark.uniforms.uScale.value = v * 1.6; });
slider('streak', (v) => { mats.rust.uniforms.uStreak.value = v; mats.rustDark.uniforms.uStreak.value = v; });
slider('bright', (v) => { mats.rust.uniforms.uBright.value = v; mats.rustDark.uniforms.uBright.value = v; mats.brokenGlass.uniforms.uBright.value = v; });
slider('glass', (v) => { mats.brokenGlass.uniforms.uGlass.value = v; });
slider('hole', (v) => { mats.brokenGlass.uniforms.uHole.value = v; });
slider('gscale', (v) => { mats.brokenGlass.uniforms.uScale.value = v; });
renderer.setAnimationLoop(() => { controls.update(); composer.render(); });
