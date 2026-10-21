import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildSocle, SOCLE_H, type BuildingSpec, type CityMats } from './city';

/**
 * Unknown Future side scenery: a dead Neo-Cyberpunk block (no power: dark windows, dead neon tubes, black
 * shopfronts) broken into two pieces along one jagged cut, at 20-80 % of the height. Each piece is a group centred on its own
 * bounding box (so it can tumble in place); `userData.center` holds where its centre sat in the whole
 * building (local building space, base at y = 0), so the pieces can be shown assembled or drifting apart.
 * The cut surfaces are value-noise functions of (x, z): the walls, the caps, the tubes and the rebar of
 * two neighbouring pieces all sample the same function, so the pieces fit together exactly.
 */
export interface RuinMats {
  body: THREE.Material; // facade of the main volume (map + normal map, no emissive)
  tower: THREE.Material; // facade of the setback tower
  inner: THREE.Material; // broken concrete (the cut surfaces), flat shaded
  rebar: THREE.Material; // rusted bars sticking out of the cuts
  tube: THREE.Material; // dead neon tubes (dark glass)
  city: CityMats; // unlit set for the socle, parapets, cornices
}
export interface RuinOptions {
  jag?: number; // amplitude of the cut surfaces, world units (default 0.7)
  rebar?: number; // density of the bars along the cuts (default 1)
}
type Rng = () => number;
type Part = { geo: THREE.BufferGeometry; mat: THREE.Material };

// ---------- 2D value noise (cut surfaces) ----------
const sm = (t: number) => t * t * (3 - 2 * t);
const hash2 = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(hash2(ix, iy), hash2(ix + 1, iy), fx), l(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), fx), fy);
}
function fbm2(x: number, y: number, oct = 2): number { let a = 0.5, s = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2.1; a *= 0.5; } return s; }

/** A cut surface: height `y` plus noise of amplitude `amp`, offset by `seed`. */
export interface Cut { y: number; amp: number; seed: number }
export const cutY = (c: Cut, x: number, z: number) => c.y + c.amp * (fbm2(x * 0.55 + c.seed, z * 0.55 + c.seed * 0.7) - 0.5) * 2;

// ---------- geometry helpers ----------
function withUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) { const n = g.attributes.position.count; const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  return g;
}
function mergeByMaterial(parts: Part[], into: THREE.Object3D) {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const p of parts) { const g = withUv(p.geo); (byMat.get(p.mat) ?? byMat.set(p.mat, []).get(p.mat)!).push(g); }
  for (const [mat, geos] of byMat) { const merged = mergeGeometries(geos); for (const g of geos) g.dispose(); if (merged) into.add(new THREE.Mesh(merged, mat)); }
}
function place(parts: Part[], geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  parts.push({ geo, mat });
}
const segsFor = (len: number) => Math.max(2, Math.ceil(len / 0.35));

/** One wall of a box volume between two corners, its top/bottom edge following a cut (or flat at y0/y1). UVs stay those of the whole volume. */
function wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, cutB: Cut | null, cutT: Cut | null, nx: number, nz: number): THREE.BufferGeometry {
  const n = segsFor(Math.hypot(bx - ax, bz - az));
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const yb = cutB ? cutY(cutB, x, z) : y0, yt = cutT ? cutY(cutT, x, z) : y1;
    pos.push(x, yb, z, x, yt, z); nor.push(nx, 0, nz, nx, 0, nz); uv.push(t, (yb - y0) / (y1 - y0), t, (yt - y0) / (y1 - y0));
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
/** The broken surface closing a cut: the rim follows the cut exactly (same samples as the walls), the inside is recessed and rough. */
function cap(x0: number, x1: number, z0: number, z1: number, cut: Cut, up: boolean): THREE.BufferGeometry {
  const nx = segsFor(x1 - x0), nz = segsFor(z1 - z0);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz;
    const de = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    const inset = Math.min(1, de / 0.7) * (0.3 + 0.6 * fbm2(x * 1.3 + cut.seed * 3, z * 1.3 + cut.seed));
    pos.push(x, cutY(cut, x, z) + (up ? -inset : inset), z); uv.push(i / nx, j / nz);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if (up) idx.push(a, d, b, a, c, d); else idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Rusted bars along the rim of a cut, pointing out of the piece. */
function rebar(parts: Part[], x0: number, x1: number, z0: number, z1: number, cut: Cut, up: boolean, density: number, mat: THREE.Material, rng: Rng) {
  const per = 2 * (x1 - x0 + z1 - z0); const n = Math.round(per * 0.3 * density);
  for (let i = 0; i < n; i++) {
    let t = rng() * per, x: number, z: number;
    if (t < x1 - x0) { x = x0 + t; z = z0 + 0.12; } else if ((t -= x1 - x0) < z1 - z0) { x = x1 - 0.12; z = z0 + t; } else if ((t -= z1 - z0) < x1 - x0) { x = x1 - t; z = z1 - 0.12; } else { x = x0 + 0.12; z = z1 - (t - (x1 - x0)); }
    const len = 0.4 + rng() * 0.8, y = cutY(cut, x, z) + (up ? len / 2 - 0.15 : -len / 2 + 0.15);
    place(parts, new THREE.CylinderGeometry(0.03, 0.03, len, 5), mat, x, y, z, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5);
  }
}
/** The slice [lo, hi] of a box volume [x0..x1] x [y0..y1] x [z0..z1]: walls (facade) + broken caps where the slice is cut. */
function brokenBox(parts: Part[], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, cutB: Cut | null, cutT: Cut | null, facade: THREE.Material, m: RuinMats, density: number, rng: Rng) {
  parts.push({ geo: wall(x0, z1, x1, z1, y0, y1, cutB, cutT, 0, 1), mat: facade });
  parts.push({ geo: wall(x1, z0, x0, z0, y0, y1, cutB, cutT, 0, -1), mat: facade });
  parts.push({ geo: wall(x1, z1, x1, z0, y0, y1, cutB, cutT, 1, 0), mat: facade });
  parts.push({ geo: wall(x0, z0, x0, z1, y0, y1, cutB, cutT, -1, 0), mat: facade });
  if (cutT) { parts.push({ geo: cap(x0, x1, z0, z1, cutT, true), mat: m.inner }); rebar(parts, x0, x1, z0, z1, cutT, true, density, m.rebar, rng); }
  if (cutB) { parts.push({ geo: cap(x0, x1, z0, z1, cutB, false), mat: m.inner }); rebar(parts, x0, x1, z0, z1, cutB, false, density, m.rebar, rng); }
}

export interface Ruin { pieces: THREE.Group[]; cuts: Cut[] }
/** The dead block broken into two pieces (see the module comment). */
export function buildRuin(spec: BuildingSpec, m: RuinMats, rng: Rng, opts: RuinOptions = {}): Ruin {
  const sh = SOCLE_H; const { w, d, h1, topH, tw, td, towerX } = spec;
  const amp = opts.jag ?? 0.7, density = opts.rebar ?? 1;
  // one cut at 20-80 % of the height, kept inside the facades (above the socle cornice, below the roof)
  const c1 = Math.min(topH - 1.5, Math.max(sh + 1.5, topH * (0.2 + rng() * 0.6)));
  const cuts: Cut[] = [{ y: c1, amp, seed: rng() * 40 }];
  const ranges: [number, number, Cut | null, Cut | null][] = [[0, c1, null, cuts[0]], [c1, topH + 10, cuts[0], null]];
  const vols = [
    { x0: -w / 2, x1: w / 2, y0: sh, y1: h1, z0: -d / 2, z1: d / 2, mat: m.body },
    { x0: towerX - tw / 2, x1: towerX + tw / 2, y0: h1, y1: topH, z0: -td / 2, z1: td / 2, mat: m.tower },
  ];
  const pieces: THREE.Group[] = [];
  for (const [pLo, pHi, cutB, cutT] of ranges) {
    const parts: Part[] = []; const g = new THREE.Group();
    if (pLo === 0) g.add(buildSocle(spec, m.city, m.tube, rng));
    for (const v of vols) {
      const a = Math.max(pLo, v.y0), b = Math.min(pHi, v.y1);
      if (b - a < 0.3) continue;
      brokenBox(parts, v.x0, v.x1, v.y0, v.y1, v.z0, v.z1, a > v.y0 + 1e-3 ? cutB : null, b < v.y1 - 1e-3 ? cutT : null, v.mat, m, density, rng);
    }
    // intact tops (body roof around the tower, tower roof): parapet + dead tube ring, as in the lit building
    const parapet = (cx: number, cy: number, cw: number, cd: number) => {
      place(parts, new THREE.BoxGeometry(cw + 0.3, 0.25, cd + 0.3), m.city.dark, cx, cy + 0.12, 0);
      for (const [sx, sz, ww, dd] of [[-1, 0, 0.15, cd + 0.3], [1, 0, 0.15, cd + 0.3], [0, -1, cw + 0.3, 0.15], [0, 1, cw + 0.3, 0.15]]) place(parts, new THREE.BoxGeometry(ww, 0.6, dd), m.city.concrete, cx + sx * (cw + 0.15) / 2, cy + 0.5, sz * (cd + 0.15) / 2);
      for (const sz of [-1, 1]) place(parts, new THREE.CylinderGeometry(0.07, 0.07, cw + 0.3, 8), m.tube, cx, cy + 0.9, sz * (cd / 2 + 0.1), 0, Math.PI / 2);
      for (const sx of [-1, 1]) place(parts, new THREE.CylinderGeometry(0.07, 0.07, cd + 0.3, 8), m.tube, cx + sx * (cw / 2 + 0.1), cy + 0.9, 0, Math.PI / 2);
    };
    if (h1 > pLo && h1 <= pHi) parapet(0, h1, w, d);
    if (topH > pLo && topH <= pHi) parapet(towerX, topH, tw, td);
    // vertical tubes on the body edges, cut flat at the cut height of their corner
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = sx * (w / 2 + 0.05), cz = sz * (d / 2 + 0.05);
      const yb = pLo > sh ? cutY(cutB!, cx, cz) : sh, yt = pHi < h1 ? cutY(cutT!, cx, cz) : h1;
      if (pLo >= h1 || pHi <= sh || yt - yb < 0.3) continue;
      place(parts, new THREE.CylinderGeometry(0.07, 0.07, yt - yb, 8), m.tube, cx, (yb + yt) / 2, cz);
    }
    mergeByMaterial(parts, g);
    // centre the piece on its bounding box; remember where it sat
    const box = new THREE.Box3().setFromObject(g); const c = box.getCenter(new THREE.Vector3());
    for (const ch of g.children) ch.position.sub(c);
    g.userData.center = c;
    pieces.push(g);
  }
  return { pieces, cuts };
}
