// Standalone preview: brightness of the Unknown Future rock convoys and jump boulders. Bundled with esbuild; not part of the game build.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ERAS } from '../game/eras';
import { makeRockMaterial, makeCrackMaterial, rockColor, rockGeometry, ROCK_BRIGHT } from '../game/space';
import { buildVoidBlock, buildVoidOverhead, makeVoidObstacleMats, SUN_CHUNK_LOOK, animateVoidObstacles, animateVoidObstacle } from '../game/voidObstacles';
import { buildRockTrain, makeVeinMaterial, type RockTrainMats } from '../game/voidTrain';

const BLOCK_H = 1.1, OVERHEAD_Y = 1.5;
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
let seed = 41; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
{ const N = 1200; const pos = new Float32Array(N * 3), size = new Float32Array(N), bright = new Float32Array(N);
  for (let i = 0; i < N; i++) { const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), r = 650; pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.cos(ph); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); const t = rnd() * rnd(); size[i] = 2.5 + 6 * t; bright[i] = 0.88 + 0.12 * t; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  scene.add(new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aSize; attribute float aBright; uniform float uPixelRatio; varying float vB; void main(){ vB = aBright; gl_PointSize = aSize * uPixelRatio; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying float vB; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.35, d); if (a < 0.02) discard; gl_FragColor = vec4(vec3(vB), a); }' }))); }
const road = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 160), new THREE.MeshStandardMaterial({ color: era.ground, emissive: era.groundEmissive, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.55 }));
road.rotation.x = -Math.PI / 2; road.position.z = -60; scene.add(road);
for (const x of [-1.1, 1.1]) for (let z = 8; z > -140; z -= 4) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 2), new THREE.MeshBasicMaterial({ color: era.line })); m.position.set(x, 0.011, z); scene.add(m); }
const tubeMat = (c: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.5), toneMapped: false });
for (const [s, c] of [[-1, era.railL], [1, era.railR]] as [number, number][]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 160, 8), tubeMat(c)); t.rotation.x = Math.PI / 2; t.position.set(s * 3.9, 0.55, -60); scene.add(t); }

// two rock materials: one for the convoys, one for the jump boulders (separate brightness)
const convoyRock = makeRockMaterial(rnd, true, 0.6), boulderRock = makeRockMaterial(rnd, true, 4);
const ck = 0.6 / ROCK_BRIGHT; const convoySun = makeCrackMaterial({ ...SUN_CHUNK_LOOK, bright: SUN_CHUNK_LOOK.bright * ck }), convoyVeins = makeVeinMaterial(); convoyVeins.uniforms.uCrack.value *= ck; // reference: the convoy at 0.6
const convoyMats: RockTrainMats = { rock: convoyRock, veins: convoyVeins, sun: convoySun };
const obMats = makeVoidObstacleMats(boulderRock, rnd);
const put = (g: THREE.Group, x: number, y: number, z: number, ry = 0) => { g.position.set(x, y, z); g.rotation.y = ry; scene.add(g); return g; };
put(buildRockTrain(convoyMats, 10), 0, 0, -6);
put(buildRockTrain(convoyMats, 14), -2.2, 0, -40);
put(buildRockTrain(convoyMats, 7), 2.2, 0, -70, Math.PI);
put(buildRockTrain(convoyMats, 12), 0, 0, -115);
for (const [x, z] of [[2.2, -12], [-2.2, -30], [2.2, -56], [0, -80], [-2.2, -120]]) put(buildVoidBlock(obMats), x, BLOCK_H / 2, z); // the jump boulders, at several distances
const rollers = [[2.2, -22], [-2.2, -96]].map(([x, z]) => put(buildVoidOverhead(obMats), x, OVERHEAD_Y + 0.35, z)); // reference, unchanged
// the sky's lone rocks, unchanged (reference only)
const skyRock = makeRockMaterial(rnd, false);
for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(rockGeometry(i % 6, 5, rnd() * 9, 24), skyRock); const az = (rnd() - 0.5) * 2.4, el = (rnd() - 0.45) * 1.2, dist = 60 + rnd() * 190; m.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist); m.scale.setScalar(0.6 + rnd() * 0.6); m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); scene.add(m); }

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.3, 0.9); composer.addPass(bloom); composer.addPass(new OutputPass());
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
const camGame = () => { controls.target.set(0, 1.2, -8); camera.position.set(0, 3.6, 7.5); controls.update(); };
const camRoof = () => { controls.target.set(0, 2.8, -20); camera.position.set(0, 5.6, 2); controls.update(); }; // as when running on a convoy's roof
camGame();
const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
new ResizeObserver(resize).observe(canvas); resize();
const press = (id: string, on: boolean) => document.getElementById(id)!.setAttribute('aria-pressed', String(on));
let bloomOn = true;
document.getElementById('bloom')!.addEventListener('click', () => { bloomOn = !bloomOn; bloom.enabled = bloomOn; press('bloom', bloomOn); });
document.getElementById('camGame')!.addEventListener('click', camGame);
document.getElementById('camRoof')!.addEventListener('click', camRoof);
const vals = document.getElementById('vals')!;
const S = { green: 0.6, boulder: 4 };
const show = () => { vals.textContent = 'green ' + S.green.toFixed(2) + '\nboulder ' + S.boulder.toFixed(2); };
const slider = (id: string, fn: (v: number) => void) => { const el = document.getElementById(id) as HTMLInputElement; el.addEventListener('input', () => { const v = Number(el.value) / 100; el.nextElementSibling!.textContent = v.toFixed(2); fn(v); show(); }); };
slider('green', (v) => { S.green = v; convoyRock.color.copy(rockColor(v)); convoyVeins.uniforms.uCrack.value = 0.7 * 0.42 * (v / ROCK_BRIGHT); }); // the convoys' green-veined boulders: rock face + veins (the sun chunk stays at its dimmed value)
slider('boulder', (v) => { S.boulder = v; boulderRock.color.copy(rockColor(v)); }); // the jump boulders on the road
show();
const clock = new THREE.Clock(); let t = 0;
renderer.setAnimationLoop(() => { const dt = Math.min(0.05, clock.getDelta()); t += dt; animateVoidObstacles(obMats, t); for (const r of rollers) animateVoidObstacle(r, dt); convoySun.uniforms.uTime.value = t; controls.update(); composer.render(); });
