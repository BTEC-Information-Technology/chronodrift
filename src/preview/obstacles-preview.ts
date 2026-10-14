// Standalone preview of the obstacle looks (bundled with esbuild into an HTML page). Not part of the game build.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ERAS } from '../game/eras';
import { buildBlock, buildOverhead, buildWall, buildTrain, type ObstacleMats, type TrainMats } from '../game/obstacles';

const TRAIN_W = 1.9, TRAIN_H = 2.8, RAMP_LEN = 3.6, TRAIN_RIDE = 0x18ffc2, TRAIN_BLOCK = 0xff2a4a;
const BLOCK_H = 1.1, OVERHEAD_Y = 1.5, WALL_H = 2.6;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05010f);
scene.fog = new THREE.Fog(0x0a0420, 18, 60);
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
scene.add(new THREE.HemisphereLight(0x6688ff, 0x140022, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(3, 6, 5);
scene.add(key);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x0b0820, roughness: 0.9, emissive: 0x0a0526, emissiveIntensity: 0.4 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
scene.add(new THREE.GridHelper(60, 30, 0x3344aa, 0x1a1a3a));
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(2, 1.4, 1);
camera.position.set(10, 9, 32);
const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
new ResizeObserver(resize).observe(canvas);
resize();

// --- materials (the game's: dark flat-shaded body with the type's emissive colour)
const emissiveMat = (color: number, intensity: number) => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: color, emissiveIntensity: intensity, roughness: 0.6, metalness: 0.2, flatShading: true });
const current = { block: emissiveMat(ERAS[0].block, 0.55), overhead: emissiveMat(ERAS[0].overhead, 0.6), wall: emissiveMat(ERAS[0].wall, 0.5), ride: emissiveMat(TRAIN_RIDE, 0.5), blockT: emissiveMat(TRAIN_BLOCK, 0.4) };
const accent = { block: emissiveMat(ERAS[0].block, 1.6), overhead: emissiveMat(ERAS[0].overhead, 1.6), wall: emissiveMat(ERAS[0].wall, 1.5), ride: emissiveMat(TRAIN_RIDE, 1.5), blockT: emissiveMat(TRAIN_BLOCK, 1.4) };
const std = (color: number, roughness: number, metalness: number) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const mats = (a: THREE.Material): ObstacleMats => ({ body: std(0x1b1f33, 0.42, 0.25), dark: std(0x0a0b14, 0.6, 0.3), accent: std(0xd9dde9, 0.5, 0.1), glass: std(0x0b1a2c, 0.08, 0.9), neon: a, white: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.7), toneMapped: false }) });

// --- "current" row (z = -3) and "proposal" row (z = +3), one column per type
const cols = [-12, -8.5, -5, 3, 9];
const label = (text: string, x: number, z: number) => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 256, 64);
  g.font = '700 30px Rajdhani, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#9a94c4';
  g.fillText(text, 128, 44);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(3, 0.75, 1);
  s.position.set(x, -0.01, z + 1.6);
  s.center.set(0.5, 1);
  scene.add(s);
};
// current
const cur = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); scene.add(mesh); return mesh; };
cur(new RoundedBoxGeometry(1.7, BLOCK_H, 1.2, 2, 0.1), current.block, cols[0], BLOCK_H / 2, -3);
cur(new RoundedBoxGeometry(2.0, 0.7, 1.0, 2, 0.1), current.overhead, cols[1], OVERHEAD_Y + 0.35, -3);
cur(new RoundedBoxGeometry(1.8, WALL_H, 1.0, 2, 0.1), current.wall, cols[2], WALL_H / 2, -3);
const trainGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);
cur(trainGeo, current.blockT, 15, TRAIN_H / 2, -8, TRAIN_W, TRAIN_H, 7);
cur(trainGeo, current.ride, 5, TRAIN_H / 2, -8, TRAIN_W, TRAIN_H, 7);
const rampGeo = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5,0,0, -0.5,1,0, -0.5,0,1, 0.5,0,0, 0.5,1,0, 0.5,0,1]), 3)); g.setIndex([0,2,1, 3,4,5, 1,4,5,1,5,2, 0,1,4,0,4,3, 0,3,5,0,5,2]); g.computeVertexNormals(); return g; })();
cur(rampGeo, current.ride, 5, 0, -4.5, TRAIN_W, TRAIN_H, RAMP_LEN);
label('current', 0, -3);
// proposal
const place = (g: THREE.Group, x: number, y: number, z: number) => { g.position.set(x, y, z); scene.add(g); return g; };
place(buildBlock(mats(accent.block)), cols[0], BLOCK_H / 2, 3);
place(buildOverhead(mats(accent.overhead)), cols[1], OVERHEAD_Y + 0.35, 3);
place(buildWall(mats(accent.wall)), cols[2], WALL_H / 2, 3);
const mag = (neonColor: number): TrainMats => ({ body: std(0x1b1f33, 0.42, 0.25), dark: std(0x0a0b14, 0.6, 0.3), pad: std(0x15172a, 0.55, 0.4), accent: std(0xd9dde9, 0.5, 0.1), glass: std(0x0b1a2c, 0.08, 0.9), shield: std(0x1a3550, 0.06, 0.85), neon: new THREE.MeshBasicMaterial({ color: new THREE.Color(neonColor).multiplyScalar(1.5), toneMapped: false }), red: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 0, 0), toneMapped: false }), white: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.7), toneMapped: false }) });
// climbable (nose towards the player = +z) at three lengths, blocking (tail towards the player) at two
for (const [len, x] of [[6, 1], [9, 5], [12, 10]] as [number, number][]) place(buildTrain(mag(TRAIN_RIDE), len), x, 0, 3 + 3);
for (const [len, x] of [[7, 15], [10, 20]] as [number, number][]) { const g = buildTrain(mag(TRAIN_BLOCK), len); g.rotation.y = Math.PI; place(g, x, 0, 3 + 3); }
label('proposal', 0, 3 + 5);

// era palette → accent colours (as the game's palette morph does)
const sel = document.getElementById('era') as HTMLSelectElement;
sel.addEventListener('change', () => {
  const p = ERAS[parseInt(sel.value)];
  for (const m of [current.block, accent.block]) m.emissive.set(p.block);
  for (const m of [current.overhead, accent.overhead]) m.emissive.set(p.overhead);
  for (const m of [current.wall, accent.wall]) m.emissive.set(p.wall);
  (scene.background as THREE.Color).set(p.bg);
  (scene.fog as THREE.Fog).color.set(p.fog);
  (ground.material as THREE.MeshStandardMaterial).color.set(p.ground);
  (ground.material as THREE.MeshStandardMaterial).emissive.set(p.groundEmissive);
});
const camBtn = document.getElementById('camGame') as HTMLButtonElement;
camBtn.addEventListener('click', () => { controls.target.set(0, 1.4, -1); camera.position.set(0, 4.2, 22); controls.update(); });
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
