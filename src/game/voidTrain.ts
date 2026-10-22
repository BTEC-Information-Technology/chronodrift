import * as THREE from 'three';
import { rockGeometry, makeCrackMaterial, type CrackLook } from './space';

/**
 * Unknown Future "train": a convoy of boulders drifting in line just above the road. Same frame as the maglev
 * (obstacles.ts): base at y = 0, nose at +z (len/2), tail at -z, width w, roof at y = h; the nose boulder slopes
 * from the road up to the roof over `noseLen` (the climbable ramp). No flat surfaces at all: the boulders keep their
 * own rounded tops and undersides, only fitted so the domes peak at the roof height; the nose boulder is an organic
 * wedge (its height tapered along z). No lights:
 * the grey boulders carry faint green marble-like veins (an additive crust shader over the lit rock), the tail boulder
 * is a chunk of the dying sun, which is what faces the player on a blocking convoy (the game turns it 180°).
 */
export interface RockTrainMats {
  rock: THREE.Material; // the lone rocks' material (lit, grain)
  veins: THREE.Material; // additive green veins (makeVeinMaterial)
  sun: THREE.Material; // dying-sun crust shader (the tail chunk)
}
const HOVER = 0.3; // the boulders float this high above the road
/** faint green marble veins, drawn additively over the grey rock (owner's values 2026-10-22: veins 0.42, scale 0.86) */
export const VEIN_LOOK: CrackLook = { crustA: new THREE.Color(0, 0, 0), crustB: new THREE.Color(0, 0, 0), lava: new THREE.Color(0.2, 0.7, 0.35), rim: new THREE.Color(0.04, 0.2, 0.1).multiplyScalar(0.42), hue: 0, bright: 1, crack: 0.7 * 0.42, crust: 0, scale: 0.86, veins: true };
export function makeVeinMaterial(): THREE.ShaderMaterial { const m = makeCrackMaterial(VEIN_LOOK); m.transparent = true; m.blending = THREE.AdditiveBlending; m.depthWrite = false; return m; }

/** a boulder fitted into w x (hTop - HOVER) x L, its own rounded top and underside kept (nothing cut); `taper` scales the height along z (the ramp) */
function boulder(shape: number, off: number, w: number, L: number, hTop: number, zc: number, taper?: (z: number) => number): THREE.BufferGeometry {
  const g = rockGeometry(shape, 1, off, 22); g.computeBoundingBox(); const b = g.boundingBox!; const s = new THREE.Vector3().subVectors(b.max, b.min);
  g.translate(-(b.max.x + b.min.x) / 2, -b.min.y, -(b.max.z + b.min.z) / 2); g.scale(w / s.x, (hTop - HOVER) / s.y, L / s.z);
  if (taper) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * taper(p.getZ(i) + zc)); }
  g.translate(0, HOVER, zc);
  g.computeVertexNormals();
  return g;
}

export function buildRockTrain(mats: RockTrainMats, len: number, w = 1.9, h = 2.8, noseLen = 3.6): THREE.Group {
  const group = new THREE.Group();
  const rocks: THREE.BufferGeometry[] = [];
  let seed = 11 + len; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // pieces from the nose (+z) to the tail (-z): ramp boulder, middle boulders, sun chunk
  const front = len / 2;
  const tailLen = Math.min(3, Math.max(2, len - noseLen - 0.2));
  const midLen = Math.max(0, len - noseLen - tailLen);
  const nMid = Math.round(midLen / 3.6); const midSeg = nMid ? midLen / nMid : 0;
  const top = h + 0.12; // the domes peak just above the roof height; the collision roof is at h
  // ramp: the nose boulder's height tapers from full at the back of the nose to ~12 % at the tip (organic wedge, no plane)
  rocks.push(boulder(5, rng() * 9, w, noseLen + 0.3, top, front - noseLen / 2, (z) => 0.12 + 0.88 * Math.min(1, Math.max(0, (front - z) / noseLen))));
  for (let i = 0; i < nMid; i++) { const zc = front - noseLen - midSeg * (i + 0.5); rocks.push(boulder(i % 2 ? 5 : 1, rng() * 9, w * (0.92 + rng() * 0.12), midSeg + 0.35, top * (0.96 + rng() * 0.06), zc)); }
  const tailGeo = boulder(3, rng() * 9, w, tailLen + 0.3, top, -len / 2 + tailLen / 2);
  const norm = (geos: THREE.BufferGeometry[]) => geos.map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.index) { const n = g.attributes.position.count; const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); } return g; });
  const rockGeo = mergeAll(norm(rocks)); for (const g of rocks) g.dispose();
  const rock = new THREE.Mesh(rockGeo, mats.rock); rock.name = 'rock'; group.add(rock);
  const veins = new THREE.Mesh(rockGeo, mats.veins); veins.name = 'veins'; veins.renderOrder = 1; group.add(veins); // same geometry, additive
  const sun = new THREE.Mesh(mergeAll(norm([tailGeo])), mats.sun); sun.name = 'sun'; group.add(sun);
  return group;
}

/** indexed merge of geometries with position + normal + uv */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index!.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of geos) { const n = g.attributes.position.count; pos.set(g.attributes.position.array as Float32Array, ov * 3); nor.set(g.attributes.normal.array as Float32Array, ov * 3); uv.set(g.attributes.uv.array as Float32Array, ov * 2); const ia = g.index!.array; for (let i = 0; i < ia.length; i++) idx[oi + i] = ia[i] + ov; ov += n; oi += ia.length; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setIndex(new THREE.BufferAttribute(idx, 1)); return out;
}
