import * as THREE from 'three';
import { rockGeometry, makeCrackMaterial, SUN_LOOK, type CrackLook } from './space';

/**
 * Unknown Future obstacle looks: pieces of the sky brought down onto the road.
 *  - block (jump over): a plain boulder (the lone rocks' grain) settled on the road: wider at the base, the underside cut flat
 *  - overhead (slide under): an elongated boulder with the broken planet's green iridescence (cracked-crust shader,
 *    green glow in the cracks), lying across the road like a log, slowly rolling about its own axis (`userData.spinX`:
 *    the axis is in the road plane, perpendicular to the direction of travel)
 *  - wall (change lane): a big chunk of the dying sun (same cracked-crust shader and values as the sun in the sky) that
 *    has smashed into the glass road: it sinks below the surface and a crack decal spreads from the impact
 * Same collision sizes as the Neo looks, centred at the origin. The shader materials need `uTime` fed per frame
 * (`animateVoidObstacle`) and get the game's curvature through `uniforms.uCurve`.
 */
export interface VoidObstacleMats {
  rock: THREE.Material; // the lone rocks' material (grain texture)
  sun: THREE.ShaderMaterial; // makeCrackMaterial(SUN_LOOK)
  green: THREE.ShaderMaterial; // makeCrackMaterial(GREEN_LOOK)
  crack: THREE.Material; // the impact cracks on the glass road (decal)
}
/** impact cracks in glass: radial cracks with branches and two irregular rings, white-cyan on transparent */
export function makeImpactTexture(rng: () => number): THREE.CanvasTexture {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const q = c.getContext('2d')!; q.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2; q.strokeStyle = 'rgba(220,240,255,0.9)'; q.lineCap = 'round';
  const walk = (x: number, y: number, a: number, len: number, w: number, depth: number) => { q.lineWidth = w; q.beginPath(); q.moveTo(x, y); let d = 0; while (d < len) { const st = 8 + rng() * 10; a += (rng() - 0.5) * 0.7; x += Math.cos(a) * st; y += Math.sin(a) * st; d += st; q.lineTo(x, y); if (depth < 2 && rng() < 0.18) walk(x, y, a + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6), len * 0.35, w * 0.55, depth + 1); } q.stroke(); };
  const n = 7 + Math.floor(rng() * 4); for (let i = 0; i < n; i++) walk(cx, cy, (i / n) * 6.2832 + rng() * 0.6, 120 + rng() * 120, 2.6 + rng() * 1.5, 0);
  for (const r of [46, 110]) { q.lineWidth = 1.4; q.beginPath(); for (let k = 0; k <= 40; k++) { const a = (k / 40) * 6.2832; const rr = r * (1 + (rng() - 0.5) * 0.35); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (k) q.lineTo(x, y); else q.moveTo(x, y); } q.closePath(); q.stroke(); }
  const g = q.createRadialGradient(cx, cy, 0, cx, cy, 70); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); q.fillStyle = g; q.fillRect(0, 0, S, S); // crushed centre
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** the broken planet's look as a crust: cold grey scabs, green glowing cracks, green rim */
// values tuned by the owner on the preview page (2026-10-21): glow 0.53, scale 0.20, rim 1.94, spin 0.68
export const GREEN_LOOK: CrackLook = { crustA: new THREE.Color(0.10, 0.11, 0.15), crustB: new THREE.Color(0.45, 0.48, 0.58), lava: new THREE.Color(0.2, 1.3, 0.45), rim: new THREE.Color(0.2, 0.9, 0.45).multiplyScalar(1.94), hue: 0, bright: 1.0, crack: 1.2 * 0.53, crust: 0.3, scale: 0.2 };
export const SUN_CHUNK_LOOK: CrackLook = { ...SUN_LOOK, rim: SUN_LOOK.rim.clone().multiplyScalar(1.94), crack: 1.5 * 0.53, scale: 0.2 };
export const ROLL_SPEED = 0.5 * 0.68;
export function makeVoidObstacleMats(rock: THREE.Material, rng: () => number): VoidObstacleMats {
  return { rock, sun: makeCrackMaterial(SUN_CHUNK_LOOK), green: makeCrackMaterial(GREEN_LOOK), crack: new THREE.MeshBasicMaterial({ map: makeImpactTexture(rng), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: 0xcfeaff }) };
}

/** fits a rock geometry into w x h x d (the rock shapes are not unit spheres: measure, then scale) */
function fitted(shape: number, off: number, w: number, h: number, d: number, segs = 28): THREE.BufferGeometry {
  const g = rockGeometry(shape, 1, off, segs); g.computeBoundingBox(); const b = g.boundingBox!; const s = new THREE.Vector3().subVectors(b.max, b.min);
  g.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2); g.scale(w / s.x, h / s.y, d / s.z); g.computeVertexNormals(); return g;
}

/** Plain boulder settled on the road: the base spreads ~20 % wider than the top and is cut flat on the surface. 1.7 x 1.1 x 1.2, centred (the game places it at y = h/2). */
export function buildVoidBlock(mats: VoidObstacleMats, w = 1.7, h = 1.1, d = 1.2): THREE.Group {
  const geo = fitted(4, 2.3, w * 0.92, h * 1.08, d * 0.92); const p = geo.attributes.position; const y0 = -h / 2;
  for (let i = 0; i < p.count; i++) { let y = p.getY(i); const t = Math.max(0, Math.min(1, (y - y0) / h)); const k = 1.22 - 0.26 * t; /* wider at the bottom */ if (y < y0 + 0.14) y = y0; /* flat underside, on the road */ p.setXYZ(i, p.getX(i) * k, Math.min(y, h / 2), p.getZ(i) * k); }
  geo.computeVertexNormals();
  const g = new THREE.Group(); const m = new THREE.Mesh(geo, mats.rock); m.rotation.y = 0.4; g.add(m); return g;
}

/** Elongated green-cracked boulder lying across the road, rolling slowly about its long axis (x). 2.0 x 0.7 x 1.0, centred. */
export function buildVoidOverhead(mats: VoidObstacleMats, w = 2.0, h = 0.7, d = 1.0): THREE.Group {
  const g = new THREE.Group(); const geo = fitted(0, 5.1, w * 0.98, h * 0.98, d * 0.96); // shape 0 is long along x
  const m = new THREE.Mesh(geo, mats.green); g.add(m); g.userData.spinX = ROLL_SPEED; return g;
}

/** Big chunk of the dying sun smashed into the road: 2.5 x 3.6 x 1.7 rock, sunk ~0.9 below the surface, impact cracks on the glass. Collision 1.8 x 2.6 x 1.0, centred (the game places it at y = h/2). */
export function buildVoidWall(mats: VoidObstacleMats, w = 1.8, h = 2.6, d = 1.0): THREE.Group {
  const g = new THREE.Group(); const m = new THREE.Mesh(fitted(3, 7.7, w * 1.4, h * 1.38, d * 1.7), mats.sun); m.position.y = -0.45; m.rotation.set(-0.1, 0.3, 0.12); g.add(m);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), mats.crack); decal.rotation.x = -Math.PI / 2; decal.position.y = -h / 2 + 0.015; decal.renderOrder = 2; g.add(decal);
  return g;
}

/** per-frame: feeds the crust shaders and rolls the overhead boulder */
export function animateVoidObstacles(mats: VoidObstacleMats, elapsed: number) { mats.sun.uniforms.uTime.value = elapsed; mats.green.uniforms.uTime.value = elapsed; }
export function animateVoidObstacle(look: THREE.Group, dt: number) { const s = look.userData.spinX as number | undefined; if (s) look.rotation.x += s * dt; }
