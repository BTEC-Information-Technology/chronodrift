import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Neo-Cyberpunk street relief: ground-floor catalogue (10 shopfronts + 10 gates) and the building look
 * with volume (socle with a random frontage, main body, setback tower, parapets, neon tubes).
 * Pieces are built in local space (wall plane z = 0 facing +z, x centred, y from the ground) from simple
 * solids, then merged per material. Every material comes from `CityMats`, created once by the game
 * (so the curvature shader is applied once); per-building facade materials are created by the game.
 */
export interface CityMats {
  concrete: THREE.Material;
  dark: THREE.Material;
  white: THREE.Material;
  red: THREE.Material;
  warm: THREE.Material; // warm interior light (transoms, slits)
  glassDark: THREE.Material;
  glassSheen: THREE.Material; // faint reflective overlay on shop panes
  hazardY: THREE.Material;
  hazardK: THREE.Material;
  interiors: Record<InteriorKind, THREE.Material[]>; // shop displays (symbols / patterns), a few variants each
}
export type InteriorKind = 'shelves' | 'bottles' | 'screens' | 'holo' | 'art' | 'food' | 'sparks' | 'stripes';
const SYMBOL: Record<InteriorKind, boolean> = { shelves: false, bottles: false, screens: false, holo: true, art: false, food: true, sparks: false, stripes: false };
const TEX_W = 128, TEX_H = 96;

/** Small emissive interior displays (symbols only, no text). */
export function makeInteriorTexture(kind: InteriorKind, rng: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const q = c.getContext('2d')!;
  q.fillStyle = '#07080f';
  q.fillRect(0, 0, TEX_W, TEX_H);
  const pal = ['#ffd9a0', '#9fdcff', '#ff9ad8', '#b8ff9a', '#fff2d0'];
  const pick = () => pal[(rng() * pal.length) | 0];
  if (kind === 'shelves') { for (let r = 0; r < 4; r++) { q.fillStyle = '#1a1c2c'; q.fillRect(6, 14 + r * 20, 116, 3); for (let i = 0; i < 9; i++) { q.fillStyle = pick(); q.globalAlpha = 0.7; q.fillRect(8 + i * 13, 4 + r * 20, 8, 10); } q.globalAlpha = 1; } }
  else if (kind === 'bottles') { q.fillStyle = '#12141f'; q.fillRect(0, 60, 128, 36); for (let i = 0; i < 14; i++) { q.fillStyle = pick(); q.globalAlpha = 0.8; q.fillRect(6 + i * 9, 30 + rng() * 12, 5, 28); } q.globalAlpha = 1; }
  else if (kind === 'screens') { for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { q.fillStyle = pick(); q.globalAlpha = 0.55; q.fillRect(8 + i * 40, 8 + j * 42, 32, 34); q.globalAlpha = 1; } }
  else if (kind === 'holo') { q.strokeStyle = pick(); q.lineWidth = 4; q.beginPath(); q.arc(64, 48, 28, 0, Math.PI * 2); q.stroke(); q.beginPath(); q.arc(64, 48, 14, 0, Math.PI * 2); q.stroke(); }
  else if (kind === 'art') { for (let i = 0; i < 5; i++) { q.fillStyle = pick(); q.globalAlpha = 0.75; q.fillRect(10 + rng() * 90, 10 + rng() * 50, 14 + rng() * 20, 14 + rng() * 20); } q.globalAlpha = 1; }
  else if (kind === 'food') { q.fillStyle = pick(); q.beginPath(); q.arc(64, 48, 30, 0, Math.PI * 2); q.fill(); q.fillStyle = '#07080f'; q.beginPath(); q.arc(64, 48, 18, 0, Math.PI * 2); q.fill(); }
  else if (kind === 'sparks') { for (let i = 0; i < 40; i++) { q.fillStyle = rng() < 0.5 ? '#ffd23a' : '#9fdcff'; q.fillRect(rng() * 128, rng() * 96, 2, 2); } }
  else if (kind === 'stripes') { for (let i = -3; i < 8; i++) { q.fillStyle = pick(); q.globalAlpha = 0.5; q.beginPath(); q.moveTo(i * 24, 0); q.lineTo(i * 24 + 10, 0); q.lineTo(i * 24 + 60, 96); q.lineTo(i * 24 + 50, 96); q.fill(); } q.globalAlpha = 1; }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = SYMBOL[kind] ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  return t;
}

export const INTERIOR_KINDS: InteriorKind[] = ['shelves', 'bottles', 'screens', 'holo', 'art', 'food', 'sparks', 'stripes'];

type Part = { geo: THREE.BufferGeometry; mat: THREE.Material };
/** position + normal + uv only, indexed (all the primitives used here are indexed → merged without expanding). */
function normalizeGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) { const n = g.attributes.position.count; const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  return g;
}
/** Merges parts into one mesh per material (indexed merge: no vertex expansion). */
function mergeByMaterial(parts: Part[], into: THREE.Object3D) {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const p of parts) { const g = normalizeGeo(p.geo); (byMat.get(p.mat) ?? byMat.set(p.mat, []).get(p.mat)!).push(g); }
  for (const [mat, geos] of byMat) { const merged = mergeGeometries(geos); for (const g of geos) g.dispose(); if (merged) into.add(new THREE.Mesh(merged, mat)); }
}
type Ctx = { parts: Part[]; m: CityMats; neon: THREE.Material; rng: () => number };

/** Rounded box for parts big enough to show it; thin bars/slats are plain boxes (cheap: 12 tris instead of ~300). */
const rb = (w: number, h: number, d: number, r = 0.03): THREE.BufferGeometry => (Math.min(w, h, d) < 0.16 || r < 0.025 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 1, r));
function add(c: Ctx, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  c.parts.push({ geo, mat });
  return geo;
}
/** A plane whose UVs keep a 128x96 image's aspect on a w x h pane: symbols centred, patterns tiled. */
function fitPlane(w: number, h: number, symbol: boolean): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const k = (w / h) / (TEX_W / TEX_H);
  const rx = Math.max(1, k), ry = Math.max(1, 1 / k);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, symbol ? (u - 0.5) * rx + 0.5 : u * rx, symbol ? (v - 0.5) * ry + 0.5 : v * ry);
  }
  return g;
}
function interior(c: Ctx, kind: InteriorKind): THREE.Material {
  const list = c.m.interiors[kind];
  return list[(c.rng() * list.length) | 0];
}
function frame(c: Ctx, mat: THREE.Material, x: number, y: number, w: number, h: number, t: number, depth: number, z = 0) {
  add(c, rb(w, t, depth), mat, x, y + h / 2 - t / 2, z + depth / 2);
  add(c, rb(w, t, depth), mat, x, y - h / 2 + t / 2, z + depth / 2);
  add(c, rb(t, h, depth), mat, x - w / 2 + t / 2, y, z + depth / 2);
  add(c, rb(t, h, depth), mat, x + w / 2 - t / 2, y, z + depth / 2);
}
function pane(c: Ctx, kind: InteriorKind, x: number, y: number, w: number, h: number, z = 0.02) {
  add(c, fitPlane(w, h, SYMBOL[kind]), interior(c, kind), x, y, z);
  add(c, new THREE.PlaneGeometry(w, h), c.m.glassSheen, x, y, z + 0.015);
}
function neonBar(c: Ctx, x: number, y: number, len: number, z: number, vertical = false) {
  add(c, rb(vertical ? 0.06 : len, vertical ? len : 0.06, 0.06, 0.02), c.neon, x, y, z);
}
function awning(c: Ctx, x: number, y: number, w: number, depth: number) {
  const a = 0.35;
  add(c, rb(w, 0.06, depth, 0.02), c.neon, x, y + Math.sin(a) * depth / 2, Math.cos(a) * depth / 2, a);
}
function signBox(c: Ctx, x: number, y: number, w: number, h: number, kind: InteriorKind) {
  add(c, rb(w, h, 0.25, 0.04), c.m.dark, x, y, 0.125);
  add(c, fitPlane(w - 0.16, h - 0.16, SYMBOL[kind]), interior(c, kind), x, y, 0.26);
  frame(c, c.neon, x, y, w - 0.04, h - 0.04, 0.05, 0.05, 0.25);
}

type Piece = (c: Ctx, w: number, h: number) => void;
const SHOPS: Piece[] = [
  (c, w, h) => { frame(c, c.m.dark, 0, h / 2, w, h, 0.12, 0.2); pane(c, 'shelves', 0, h / 2, w - 0.24, h - 0.24); awning(c, 0, h + 0.1, w + 0.2, 0.7); neonBar(c, 0, h + 0.02, w, 0.1); },
  (c, w, h) => { frame(c, c.m.dark, 0, h / 2, w, h, 0.12, 0.2); add(c, rb(0.16, h, 0.2), c.m.dark, 0, h / 2, 0.1); pane(c, 'shelves', -w / 4, h / 2, w / 2 - 0.2, h - 0.24); pane(c, 'screens', w / 4, h / 2, w / 2 - 0.2, h - 0.24); signBox(c, 0, h + 0.45, w * 0.8, 0.7, 'holo'); },
  (c, w, h) => { frame(c, c.m.dark, 0, h / 2, w, h, 0.1, 0.16); pane(c, 'bottles', 0, h / 2, w - 0.2, h - 0.2); neonBar(c, 0, 0.25, w - 0.3, 0.2); for (let i = 0; i < 3; i++) { const x = -w / 3 + i * w / 3; add(c, new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), c.m.dark, x, 0.3, 0.6); add(c, new THREE.CylinderGeometry(0.18, 0.18, 0.06, 10), c.m.dark, x, 0.62, 0.6); } signBox(c, 0, h + 0.4, w * 0.6, 0.6, 'food'); },
  (c, w, h) => { add(c, rb(w, 0.3, 0.6, 0.05), c.m.dark, 0, 0.15, 0.3); add(c, fitPlane(w - 0.4, h - 0.6, true), interior(c, 'holo'), 0, h / 2 + 0.1, 0.35, -0.18); frame(c, c.neon, 0, h / 2 + 0.1, w - 0.3, h - 0.5, 0.05, 0.05, 0.3); for (const sx of [-1, 1]) add(c, new THREE.CylinderGeometry(0.04, 0.04, h - 0.4, 6), c.m.dark, sx * (w / 2 - 0.25), h / 2 + 0.05, 0.25); },
  (c, w, h) => { const r = w / 2 - 0.12; add(c, new THREE.CircleGeometry(r, 24, 0, Math.PI), interior(c, 'art'), 0, h - r, 0.02); pane(c, 'art', 0, (h - r) / 2, w - 0.24, h - r); add(c, new THREE.TorusGeometry(r + 0.06, 0.06, 6, 24, Math.PI), c.neon, 0, h - r, 0.08); frame(c, c.m.dark, 0, (h - r) / 2, w, h - r, 0.12, 0.2); },
  (c, w, h) => { signBox(c, 0, h + 0.5, w, 0.9, 'food'); frame(c, c.m.dark, 0, h / 2, w, h, 0.12, 0.2); pane(c, 'screens', 0, h / 2, w - 0.24, h - 0.24); neonBar(c, 0, 0.12, w, 0.14); add(c, rb(w * 0.6, 0.5, 0.5, 0.05), c.m.dark, 0, 0.25, 0.25); },
  (c, w, h) => { frame(c, c.m.dark, 0, h / 2, w, h, 0.12, 0.2); pane(c, 'sparks', 0, h / 4, w - 0.24, h / 2); for (let i = 0; i < 6; i++) add(c, rb(w - 0.2, 0.14, 0.08, 0.02), c.m.concrete, 0, h - 0.1 - i * 0.16, 0.08); add(c, rb(0.3, 0.12, 0.3, 0.02), c.m.dark, w / 2 - 0.3, h + 0.2, 0.15); add(c, new THREE.SphereGeometry(0.07, 8, 6), c.m.hazardY, w / 2 - 0.3, h + 0.12, 0.15); },
  (c, w, h) => { frame(c, c.m.dark, 0, h / 2, w, h, 0.12, 0.2); pane(c, 'stripes', 0, h / 2, w - 0.24, h - 0.24); add(c, rb(w * 0.45, 0.6, 0.45, 0.05), c.m.dark, w * 0.2, h * 0.3, 0.22); add(c, fitPlane(w * 0.4, 0.5, true), interior(c, 'holo'), w * 0.2, h * 0.3, 0.46); for (const sx of [-1, 1]) neonBar(c, sx * (w / 2 - 0.06), h / 2, h, 0.22, true); },
  (c, w, h) => { const nw = (w - 0.4) / 3; for (let i = 0; i < 3; i++) { const x = -w / 2 + 0.2 + nw * (i + 0.5); frame(c, c.m.dark, x, h / 2, nw - 0.1, h - 0.3, 0.08, 0.3); pane(c, 'art', x, h / 2, nw - 0.26, h - 0.46); add(c, new THREE.CylinderGeometry(0.05, 0.08, 0.12, 6), c.m.dark, x, h + 0.1, 0.25); add(c, new THREE.SphereGeometry(0.05, 6, 4), c.m.white, x, h + 0.03, 0.25); } neonBar(c, 0, h + 0.3, w, 0.1); },
  (c, w, h) => { add(c, rb(w, h * 0.9, 0.5, 0.06), c.m.dark, 0, h * 0.45, 0.25); const n = w > 3 ? 3 : 2; for (let i = 0; i < n; i++) { const x = -w / 2 + (w / n) * (i + 0.5); pane(c, 'screens', x, h * 0.5, w / n - 0.3, h * 0.6, 0.51); neonBar(c, x - (w / n) / 2 + 0.1, h * 0.45, h * 0.8, 0.52, true); } neonBar(c, 0, h * 0.9, w, 0.52); },
];
const GATES: Piece[] = [
  (c, w, h) => { frame(c, c.m.concrete, 0, h / 2, w + 0.3, h + 0.15, 0.2, 0.25); for (const sx of [-1, 1]) { add(c, rb(w / 2 - 0.08, h - 0.2, 0.12, 0.03), c.m.dark, sx * w / 4, h / 2, 0.06); for (let r = 0; r < 5; r++) add(c, rb(w / 2 - 0.3, 0.06, 0.06), c.m.concrete, sx * w / 4, 0.4 + r * (h - 0.8) / 4, 0.14); } neonBar(c, 0, h + 0.05, w, 0.26); },
  (c, w, h) => { for (const sx of [-1, 1]) add(c, rb(0.18, h, 0.25), c.m.dark, sx * (w / 2 + 0.09), h / 2, 0.12); const n = Math.round(h / 0.22); for (let i = 0; i < n; i++) add(c, rb(w, 0.2, 0.08, 0.02), i % 2 ? c.m.concrete : c.m.dark, 0, 0.11 + i * 0.22, 0.04); add(c, rb(w + 0.4, 0.3, 0.4, 0.04), c.m.dark, 0, h + 0.15, 0.2); add(c, new THREE.SphereGeometry(0.08, 8, 6), c.m.red, w / 2 + 0.1, h + 0.45, 0.2); },
  (c, w, h) => { const r = w / 2; frame(c, c.m.concrete, 0, (h - r) / 2, w + 0.4, h - r, 0.2, 0.3); add(c, new THREE.TorusGeometry(r + 0.1, 0.12, 8, 24, Math.PI), c.m.concrete, 0, h - r, 0.15); add(c, new THREE.TorusGeometry(r + 0.02, 0.04, 6, 24, Math.PI), c.neon, 0, h - r, 0.3); add(c, rb(w - 0.1, h - r - 0.1, 0.1, 0.03), c.m.dark, 0, (h - r) / 2, 0.05); add(c, rb(0.04, h - r - 0.3, 0.02), c.m.warm, 0, (h - r) / 2, 0.11); add(c, new THREE.CircleGeometry(r - 0.05, 24, 0, Math.PI), c.m.warm, 0, h - r, 0.02); },
  (c, w, h) => { frame(c, c.m.dark, 0, h / 2, w, h, 0.16, 0.3); add(c, new THREE.PlaneGeometry(w - 0.32, h - 0.32), c.m.glassDark, 0, h / 2, 0.02); add(c, rb(w - 0.5, 0.35, 0.02), c.m.warm, 0, h - 0.4, 0.03); add(c, rb(0.6, 0.06, 0.02), c.m.warm, 0, 0.9, 0.03); for (const sx of [-1, 1]) add(c, rb(0.05, 1.0, 0.05), c.neon, sx * 0.15, h / 2, 0.12); neonBar(c, 0, h + 0.1, w, 0.1); },
  (c, w, h) => { add(c, rb(w, h, 0.1, 0.03), c.m.dark, 0, h / 2, 0.05); for (let r = 0; r < 4; r++) add(c, rb(w - 0.2, 0.05, 0.04), c.m.concrete, 0, 0.9 + r * (h - 1.2) / 3, 0.11); const n = Math.round(w / 0.35); for (let i = 0; i < n; i++) add(c, rb(w / n, 0.45, 0.04), i % 2 ? c.m.hazardK : c.m.hazardY, -w / 2 + (w / n) * (i + 0.5), 0.3, 0.11); neonBar(c, 0, h + 0.06, w, 0.1); },
  (c, w, h) => { for (const sx of [-1, 1]) { add(c, rb(0.3, h * 0.6, 0.3, 0.04), c.m.concrete, sx * (w / 2 + 0.3), h * 0.3, 0.5); add(c, rb(0.22, 0.06, 0.22, 0.02), c.m.white, sx * (w / 2 + 0.3), h * 0.63, 0.5); } add(c, rb(w + 0.3, 0.06, 0.06, 0.02), c.neon, 0, h * 0.35, 0.5); frame(c, c.m.dark, 0, h / 2, w, h, 0.12, 0.2); add(c, rb(w - 0.24, h - 0.24, 0.08, 0.02), c.m.dark, 0, h / 2, 0.04); add(c, rb(0.08, h - 0.5, 0.02), c.m.warm, 0, h / 2, 0.09); },
  (c, w, h) => { const r = Math.min(w, h) / 2; add(c, rb(w + 0.3, h + 0.3, 0.2, 0.04), c.m.concrete, 0, h / 2 + 0.1, 0.1); add(c, new THREE.CylinderGeometry(r, r, 0.3, 24), c.m.dark, 0, h / 2 + 0.1, 0.3, Math.PI / 2); add(c, new THREE.TorusGeometry(r - 0.1, 0.04, 6, 32), c.neon, 0, h / 2 + 0.1, 0.46); add(c, new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12), c.neon, 0, h / 2 + 0.1, 0.46, Math.PI / 2); },
  (c, w, h) => { for (let i = 0; i < 3; i++) add(c, rb(w + 0.6, 0.18, 0.4, 0.02), c.m.concrete, 0, 0.09 + i * 0.18, 0.9 - i * 0.35); frame(c, c.m.dark, 0, 0.54 + (h - 0.54) / 2, w, h - 0.54, 0.14, 0.2); add(c, rb(w - 0.28, h - 0.82, 0.08, 0.02), c.m.dark, 0, 0.54 + (h - 0.54) / 2, 0.04); add(c, rb(w - 0.5, 0.3, 0.02), c.m.warm, 0, h - 0.35, 0.09); for (const sx of [-1, 1]) { add(c, new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), c.m.dark, sx * (w / 2 + 0.3), 1.1, 1.0); add(c, rb(0.05, 0.05, 1.2), c.neon, sx * (w / 2 + 0.3), 1.6, 0.5); } },
  (c, w, h) => { add(c, rb(w + 1.6, 0.12, 2.0, 0.03), c.m.dark, 0, h + 0.2, 1.0); for (const sx of [-1, 1]) add(c, new THREE.CylinderGeometry(0.06, 0.06, h + 0.2, 8), c.m.dark, sx * (w / 2 + 0.7), (h + 0.2) / 2, 1.9); neonBar(c, 0, h + 0.13, w + 1.4, 1.0); frame(c, c.m.dark, 0, h / 2, w, h, 0.14, 0.2); add(c, new THREE.PlaneGeometry(w - 0.28, h - 0.28), c.m.glassDark, 0, h / 2, 0.02); add(c, rb(w - 0.9, 0.9, 0.02), c.m.warm, 0, h * 0.55, 0.01); },
  (c, w, h) => { frame(c, c.m.concrete, 0, h / 2, w, h, 0.14, 0.2); add(c, rb(w - 0.28, h - 0.28, 0.08, 0.02), c.m.dark, 0, h / 2, 0.04); add(c, rb(0.3, 0.12, 0.2, 0.02), c.m.dark, 0, h + 0.2, 0.1); add(c, new THREE.SphereGeometry(0.07, 8, 6), c.m.red, 0, h + 0.1, 0.12); neonBar(c, w / 2 + 0.2, h / 2, h, 0.08, true); },
];

/** Lays out 1 gate (80%) + 1-3 shopfronts on a wall of width `avail`; random types, sizes and positions within limits. */
function frontage(c: Ctx, avail: number, ox: number, oy: number, rotY: number) {
  const items: { w: number; h: number; fn: Piece }[] = [];
  const rng = c.rng;
  if (rng() < 0.8) items.push({ w: 2.2 + rng() * 2, h: 2.9 + rng() * 0.7, fn: GATES[(rng() * GATES.length) | 0] });
  const nShops = 1 + Math.min(2, Math.floor((avail - 6) / 4.5));
  for (let i = 0; i < nShops; i++) items.push({ w: 2.6 + rng() * 2.6, h: 2.2 + rng() * 0.8, fn: SHOPS[(rng() * SHOPS.length) | 0] });
  items.sort(() => rng() - 0.5);
  const gap = 0.5, margin = 0.6;
  let total = items.reduce((a, it) => a + it.w, 0) + gap * (items.length - 1) + margin * 2;
  if (total > avail) { const k = (avail - gap * (items.length - 1) - margin * 2) / (total - gap * (items.length - 1) - margin * 2); for (const it of items) it.w *= k; total = avail; }
  const slack = avail - total;
  let x = -avail / 2 + margin + rng() * slack * 0.5;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  for (const it of items) {
    x += rng() * Math.max(0, (slack * 0.5) / items.length);
    const start = c.parts.length;
    it.fn(c, it.w, it.h);
    // move the piece from local wall space to the building: shift along the wall, rotate to the wall's facing, offset
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const t = new THREE.Vector3(x + it.w / 2, 0, 0).applyQuaternion(q).add(new THREE.Vector3(ox, oy, 0));
    m.setPosition(t);
    for (let i = start; i < c.parts.length; i++) c.parts[i].geo.applyMatrix4(m);
    x += it.w + gap;
  }
}

export interface BuildingSpec { w: number; topH: number; d: number; side: number; h1: number; tw: number; td: number; towerX: number }
export interface BuildingLook {
  group: THREE.Group; // container: socle + upper
  body: THREE.Mesh; // facade box of the main volume (its material is created by the game)
  tower: THREE.Mesh; // setback tower (own facade material)
  tubes: THREE.Mesh | null; // neon tubes as geometry (shown only when close; the painted frame covers the distance)
}
export const SOCLE_H = 4.2;

/** Stage A of a building: the socle (wider base, cornice) with the random frontage towards the road. Base at y = 0. */
export function buildSocle(spec: BuildingSpec, m: CityMats, neon: THREE.Material, rng: () => number): THREE.Group {
  const { w, d, side } = spec;
  const c: Ctx = { parts: [], m, neon, rng };
  const sh = SOCLE_H;
  add(c, rb(w + 1.2, sh + 1, d + 1.2, 0.12), m.concrete, 0, (sh - 1) / 2, 0);
  add(c, new THREE.BoxGeometry(w + 1.4, 0.12, d + 1.4), m.dark, 0, sh, 0);
  frontage(c, d + 1.2, -side * (w + 1.2) / 2, 0, side < 0 ? Math.PI / 2 : -Math.PI / 2);
  const group = new THREE.Group();
  mergeByMaterial(c.parts, group);
  return group;
}

/** Stage B: main body + setback tower (plain boxes, facade materials from the game), parapets, cornices, neon tubes. */
export function buildUpper(spec: BuildingSpec, m: CityMats, neon: THREE.Material, bodyMat: THREE.Material, towerMat: THREE.Material, rng: () => number): { group: THREE.Group; body: THREE.Mesh; tower: THREE.Mesh; tubes: THREE.Mesh | null } {
  const { w, topH, d, h1, tw, td, towerX } = spec;
  const c: Ctx = { parts: [], m, neon, rng };
  const sh = SOCLE_H;
  const parapet = (cx: number, cy: number, cw: number, cd: number) => {
    add(c, new THREE.BoxGeometry(cw + 0.3, 0.25, cd + 0.3), m.dark, cx, cy + 0.12, 0);
    for (const [sx, sz, ww, dd] of [[-1, 0, 0.15, cd + 0.3], [1, 0, 0.15, cd + 0.3], [0, -1, cw + 0.3, 0.15], [0, 1, cw + 0.3, 0.15]]) add(c, new THREE.BoxGeometry(ww, 0.6, dd), m.concrete, cx + sx * (cw + 0.15) / 2, cy + 0.5, sz * (cd + 0.15) / 2);
  };
  parapet(0, h1, w, d);
  parapet(towerX, topH, tw, td);
  const tubeParts: THREE.BufferGeometry[] = [];
  const tube = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => { if (rx) geo.rotateX(rx); if (rz) geo.rotateZ(rz); geo.translate(x, y, z); tubeParts.push(geo); };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tube(new THREE.CylinderGeometry(0.07, 0.07, h1 - sh, 8), sx * (w / 2 + 0.05), sh + (h1 - sh) / 2, sz * (d / 2 + 0.05));
  for (const sz of [-1, 1]) tube(new THREE.CylinderGeometry(0.07, 0.07, tw + 0.3, 8), towerX, topH + 0.9, sz * (td / 2 + 0.1), 0, Math.PI / 2);
  for (const sx of [-1, 1]) tube(new THREE.CylinderGeometry(0.07, 0.07, td + 0.3, 8), towerX + sx * (tw / 2 + 0.1), topH + 0.9, 0, Math.PI / 2);
  for (const sz of [-1, 1]) tube(new THREE.CylinderGeometry(0.07, 0.07, w + 0.3, 8), 0, h1 + 0.9, sz * (d / 2 + 0.1), 0, Math.PI / 2);
  const group = new THREE.Group();
  mergeByMaterial(c.parts, group);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h1 - sh, d), bodyMat);
  body.position.y = sh + (h1 - sh) / 2;
  group.add(body);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(tw, topH - h1, td), towerMat);
  tower.position.set(towerX, h1 + (topH - h1) / 2, 0);
  group.add(tower);
  let tubes: THREE.Mesh | null = null;
  const tm = mergeGeometries(tubeParts.map(normalizeGeo));
  for (const g of tubeParts) g.dispose();
  if (tm) { tubes = new THREE.Mesh(tm, neon); group.add(tubes); }
  return { group, body, tower, tubes };
}

/** Frees the geometries of a look (materials are shared, except the facade materials the game owns). */
export function disposeLook(group: THREE.Group) {
  group.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) mesh.geometry.dispose(); });
  group.removeFromParent();
}

/** Road relief for one track segment (length `len`): curbs with the neon tubes on top, railing posts with lights, drains, lane dashes, a seam. */
export interface RoadMats { concrete: THREE.Material; dark: THREE.Material; white: THREE.Material; railL: THREE.Material; railR: THREE.Material; line: THREE.Material }
export function buildRoadRelief(len: number, halfW: number, m: RoadMats): THREE.Group {
  const grp = new THREE.Group();
  const parts: Part[] = [];
  const c: Ctx = { parts, m: null as unknown as CityMats, neon: m.dark, rng: Math.random };
  for (const s of [-1, 1]) {
    const x = s * (halfW + 0.25);
    add(c, rb(0.5, 0.34, len, 0.08), m.concrete, x, 0.17, 0);
    add(c, new THREE.CylinderGeometry(0.05, 0.05, len, 10), s < 0 ? m.railL : m.railR, s * (halfW + 0.06), 0.36, 0, Math.PI / 2);
    for (let z = -len / 2 + 3; z < len / 2; z += 6) { add(c, rb(0.12, 0.5, 0.12, 0.03), m.dark, s * (halfW + 0.42), 0.55, z); add(c, rb(0.08, 0.05, 0.08, 0.02), m.white, s * (halfW + 0.42), 0.82, z); }
    for (const z of [-len / 4, len / 4]) { add(c, new THREE.BoxGeometry(0.5, 0.03, 0.9), m.dark, s * (halfW - 0.35), 0.01, z); for (let i = -3; i <= 3; i++) add(c, new THREE.BoxGeometry(0.4, 0.02, 0.05), m.concrete, s * (halfW - 0.35), 0.03, z + i * 0.12); }
  }
  const nDash = 8, step = len / nDash;
  for (const x of [-1.1, 1.1]) for (let i = 0; i < nDash; i++) add(c, rb(0.1, 0.02, step * 0.5, 0.008), m.line, x, 0.012, -len / 2 + step * (i + 0.5));
  add(c, new THREE.BoxGeometry(halfW * 2, 0.012, 0.05), m.dark, 0, 0.004, -len / 2);
  mergeByMaterial(parts, grp);
  return grp;
}
