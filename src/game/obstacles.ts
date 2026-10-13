import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Neo-Cyberpunk obstacle looks, built from solid low-poly parts (no transparency, no stripes):
 *  - block (jump over): a cargo pod with a lit top frame and a chevron on the face
 *  - overhead (slide under): a floating sign gantry with a lit underside and a down-chevron
 *  - wall (change lane): a barrier emitter — two posts, a solid plate, a lit band
 *  - train hull: a maglev capsule — dark body, window strip, roof edge lines, underglow
 * Every piece is one of three materials: body (dark), accent (the type's emissive colour, driven
 * by the era palette in the game) and light (white). Dimensions match the game's collision specs.
 */
export interface ObstacleMats {
  body: THREE.Material;
  accent: THREE.Material;
  light: THREE.Material;
}

type Part = { geo: THREE.BufferGeometry; mat: 'body' | 'accent' | 'light' };

function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: Part['mat'], rz = 0, ry = 0): Part {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return { geo: g, mat };
}

function assemble(parts: Part[], mats: ObstacleMats): THREE.Group {
  const group = new THREE.Group();
  for (const key of ['body', 'accent', 'light'] as const) {
    const raw = parts.filter((p) => p.mat === key).map((p) => p.geo);
    if (!raw.length) continue;
    // normalise before merging: non-indexed, position + normal only (RoundedBox and Box differ in attributes)
    const geos = raw.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
      return n;
    });
    const merged = mergeGeometries(geos);
    if (!merged) throw new Error('obstacles: merge failed for ' + key);
    for (const g of raw) g.dispose();
    const mesh = new THREE.Mesh(merged, mats[key]);
    mesh.name = key;
    group.add(mesh);
  }
  return group;
}

/** Cargo pod, centred at the origin (the game places it at y = h/2). w x h x d = 1.7 x 1.1 x 1.2. */
export function buildBlock(mats: ObstacleMats, w = 1.7, h = 1.1, d = 1.2): THREE.Group {
  const parts: Part[] = [];
  const body = new RoundedBoxGeometry(w * 0.94, h * 0.9, d * 0.92, 2, 0.08);
  parts.push({ geo: body, mat: 'body' });
  const t = 0.07;
  const top = h / 2 - 0.02;
  // lit top frame
  parts.push(box(w, t, t, 0, top, d / 2 - t / 2, 'accent'), box(w, t, t, 0, top, -d / 2 + t / 2, 'accent'));
  parts.push(box(t, t, d, w / 2 - t / 2, top, 0, 'accent'), box(t, t, d, -w / 2 + t / 2, top, 0, 'accent'));
  // chevron on the face towards the player (+z)
  const zf = d / 2 + 0.01;
  parts.push(box(0.5, 0.08, 0.04, -0.2, -0.05, zf, 'accent', 0.6), box(0.5, 0.08, 0.04, 0.2, -0.05, zf, 'accent', -0.6));
  parts.push(box(0.5, 0.08, 0.04, -0.2, 0.25, zf, 'accent', 0.6), box(0.5, 0.08, 0.04, 0.2, 0.25, zf, 'accent', -0.6));
  // corner lights
  for (const sx of [-1, 1]) parts.push(box(0.12, 0.12, 0.06, sx * (w / 2 - 0.14), -h / 2 + 0.16, zf, 'light'));
  return assemble(parts, mats);
}

/** Floating sign gantry, centred at the origin (the game places it at OVERHEAD_Y + h/2). 2.0 x 0.7 x 1.0. */
export function buildOverhead(mats: ObstacleMats, w = 2.0, h = 0.7, d = 1.0): THREE.Group {
  const parts: Part[] = [];
  parts.push({ geo: new RoundedBoxGeometry(w * 0.96, h * 0.8, d * 0.9, 2, 0.06), mat: 'body' });
  // lit underside strip (what the player sees when sliding under)
  parts.push(box(w * 0.9, 0.06, d * 0.5, 0, -h / 2 + 0.03, 0, 'accent'));
  // down-chevron on the face towards the player
  const zf = d / 2 + 0.01;
  parts.push(box(0.55, 0.08, 0.04, -0.22, 0.04, zf, 'accent', -0.55), box(0.55, 0.08, 0.04, 0.22, 0.04, zf, 'accent', 0.55));
  // end caps lit
  for (const sx of [-1, 1]) parts.push(box(0.08, h * 0.7, d * 0.7, sx * (w / 2 - 0.04), 0, 0, 'light'));
  return assemble(parts, mats);
}

/** Barrier emitter, centred at the origin (the game places it at y = h/2). 1.8 x 2.6 x 1.0. */
export function buildWall(mats: ObstacleMats, w = 1.8, h = 2.6, d = 1.0): THREE.Group {
  const parts: Part[] = [];
  const post = 0.26;
  for (const sx of [-1, 1]) {
    parts.push({ geo: (() => { const g = new RoundedBoxGeometry(post, h, d * 0.8, 2, 0.05); g.translate(sx * (w / 2 - post / 2), 0, 0); return g; })(), mat: 'body' });
    parts.push(box(0.06, h * 0.9, 0.06, sx * (w / 2 - post / 2), 0, d * 0.4 + 0.02, 'accent')); // lit post edge
    parts.push(box(post * 0.8, 0.1, d * 0.5, sx * (w / 2 - post / 2), h / 2 + 0.05, 0, 'light')); // cap light
  }
  // solid plate between the posts with a lit band at eye height
  parts.push(box(w - post * 2 + 0.02, h * 0.92, d * 0.45, 0, 0, 0, 'body'));
  parts.push(box(w - post * 2, 0.22, d * 0.45 + 0.04, 0, h * 0.12, 0, 'accent'));
  parts.push(box(w - post * 2, 0.06, d * 0.45 + 0.04, 0, -h * 0.3, 0, 'accent'));
  return assemble(parts, mats);
}

/**
 * Maglev train, procedural (after the approved concept): one rounded profile swept along the length,
 * smooth shading, a tapering wedge nose on the locomotive, flat bevelled ends on the wagons, dark window
 * band, light accent panel, neon rails on the skirt and shoulders, red bars on every flat end, a white
 * headlight on the nose, low roof pods, levitation pads with a lit underside.
 * Base at y = 0, nose at +z (len/2), tail at -z. The game rotates it 180° for the blocking train.
 * Long trains are a locomotive plus wagons. Every colour/light comes from `mats`, so other eras can pass
 * unlit, sun-lit materials over the same geometry.
 */
export interface TrainMats {
  body: THREE.Material; // hull
  dark: THREE.Material; // pods, door frames, coupling plates
  pad: THREE.Material; // levitation pads
  accent: THREE.Material; // light panel along the lower side
  glass: THREE.Material; // window band
  shield: THREE.Material; // windshield
  neon: THREE.Material; // skirt/shoulder rails, roof strips, pad underglow (the type's colour)
  red: THREE.Material; // bars on the flat ends
  white: THREE.Material; // headlights
}
type TrainMatKey = keyof TrainMats;

const smooth = (t: number) => t * t * (3 - 2 * t);
const FLOOR = 0.42; // underside of the hull (the pads hang below)

/** Rounded-rectangle profile walked from the bottom centre counter-clockwise (roof centre mid-list). */
function profile(w: number, yb: number, yt: number, rTop: number, rBot: number, tuck: number, segArc = 7, segEdge = 4): [number, number][] {
  const pts: [number, number][] = [];
  const hw = w / 2;
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => { for (let i = 1; i <= segArc; i++) { const a = a0 + (a1 - a0) * i / segArc; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  const line = (x0: number, y0: number, x1: number, y1: number) => { for (let i = 1; i <= segEdge; i++) { const t = i / segEdge; pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); } };
  pts.push([0, yb]);
  line(0, yb, hw - tuck - rBot, yb);
  arc(hw - tuck - rBot, yb + rBot, rBot, -Math.PI / 2, 0);
  line(hw - tuck, yb + rBot, hw, yb + 0.75);
  line(hw, yb + 0.75, hw, yt - rTop);
  arc(hw - rTop, yt - rTop, rTop, 0, Math.PI / 2);
  line(hw - rTop, yt, 0, yt);
  const n = pts.length;
  for (let i = n - 2; i >= 1; i--) pts.push([-pts[i][0], pts[i][1]]);
  return pts;
}

interface Sweep { geo: THREE.BufferGeometry; zs: number[]; pos: number[]; M: number }

/** Sweeps the profile along z: nose taper on the +z end (noseLen > 0), bevelled flat ends otherwise. */
function sweep(prof: [number, number][], h: number, len: number, noseLen: number, rings: number): Sweep {
  const M = prof.length;
  const pos: number[] = [];
  const zs: number[] = [];
  const bevel = 0.14;
  const taper = (z: number) => {
    if (noseLen <= 0) return { kx: 1, ky: 1, lift: 0 };
    const t = Math.max(0, Math.min(1, (z - (len / 2 - noseLen)) / noseLen));
    const s = smooth(t);
    return { kx: 1 - 0.42 * s * s, ky: 1 - 0.64 * Math.pow(s, 1.25), lift: 0.16 * s * s };
  };
  const zList: number[] = [];
  for (let i = 0; i <= rings; i++) zList.push(-len / 2 + len * i / rings);
  const ends: [number, number][] = noseLen > 0 ? [[-len / 2, 1]] : [[-len / 2, 1], [len / 2, -1]];
  for (const [z0, dir] of ends) { zList.push(z0 + dir * bevel * 0.35); zList.push(z0 + dir * bevel); }
  zList.sort((a, b) => a - b);
  const cy = (FLOOR + h) / 2;
  for (const z of zList) {
    const { kx, ky, lift } = taper(z);
    let shrink = 1;
    for (const [z0] of ends) { const d = Math.abs(z - z0); if (d < bevel) shrink = Math.min(shrink, 0.84 + 0.16 * Math.sqrt(1 - Math.pow(1 - d / bevel, 2))); }
    for (const [x, y] of prof) {
      let px = x * kx;
      let py = FLOOR + lift + (y - FLOOR) * ky;
      px *= shrink;
      py = cy + (py - cy) * shrink;
      pos.push(px, py, z);
    }
    zs.push(z);
  }
  const R = zs.length;
  const idx: number[] = [];
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < M; j++) { const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M; idx.push(a, b, c, b, d, c); }
  const capCentre = (ring: number) => { let cx = 0, cyy = 0; for (let j = 0; j < M; j++) { cx += pos[(ring * M + j) * 3]; cyy += pos[(ring * M + j) * 3 + 1]; } return [cx / M, cyy / M, zs[ring]]; };
  const base = pos.length / 3;
  pos.push(...capCentre(0), ...capCentre(R - 1));
  for (let j = 0; j < M; j++) { idx.push(base, (j + 1) % M, j); idx.push(base + 1, (R - 1) * M + j, (R - 1) * M + (j + 1) % M); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, zs, pos, M };
}

/** A surface patch (ring range × profile index range) pushed out along the normal: glass, panels. */
function patch(sw: Sweep, ring0: number, ring1: number, j0: number, j1: number, out: number): THREE.BufferGeometry {
  const n = sw.geo.attributes.normal as THREE.BufferAttribute;
  const p: number[] = [];
  const idx: number[] = [];
  const cols = j1 - j0 + 1;
  for (let i = ring0; i <= ring1; i++) for (let j = j0; j <= j1; j++) { const k = i * sw.M + j; p.push(sw.pos[k * 3] + n.getX(k) * out, sw.pos[k * 3 + 1] + n.getY(k) * out, sw.pos[k * 3 + 2] + n.getZ(k) * out); }
  for (let i = 0; i < ring1 - ring0; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, b, c, b, d, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A neon tube following one profile index along the hull. */
function rail(sw: Sweep, j: number, ring0: number, ring1: number, out: number, radius: number): THREE.BufferGeometry {
  const n = sw.geo.attributes.normal as THREE.BufferAttribute;
  const pts: THREE.Vector3[] = [];
  for (let i = ring0; i <= ring1; i++) { const k = i * sw.M + j; pts.push(new THREE.Vector3(sw.pos[k * 3] + n.getX(k) * out, sw.pos[k * 3 + 1] + n.getY(k) * out, sw.pos[k * 3 + 2] + n.getZ(k) * out)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, radius, 5, false);
}

const ringAt = (sw: Sweep, z: number) => { let best = 0; for (let i = 0; i < sw.zs.length; i++) if (Math.abs(sw.zs[i] - z) < Math.abs(sw.zs[best] - z)) best = i; return best; };
const jAt = (prof: [number, number][], x: number, y: number) => { let best = 0, bd = 1e9; for (let j = 0; j < prof.length; j++) { const d = (prof[j][0] - x) ** 2 + (prof[j][1] - y) ** 2; if (d < bd) { bd = d; best = j; } } return best; };

type TPart = { geo: THREE.BufferGeometry; mat: TrainMatKey };

/** One car (locomotive with `nose`, or a wagon with two flat ends), centred at the origin, base at y = 0. */
function buildCar(parts: TPart[], len: number, nose: boolean, w: number, h: number, noseLen: number, zOff: number) {
  const rTop = Math.min(0.55, w * 0.22), rBot = Math.min(0.28, w * 0.11), tuck = w * 0.06;
  const prof = profile(w, FLOOR, h, rTop, rBot, tuck);
  const M = prof.length;
  const ROOF_C = Math.floor(M / 2);
  const rings = Math.max(16, Math.round(len * 4));
  const sw = sweep(prof, h, len, nose ? noseLen : 0, rings);
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) => { if (ry) g.rotateY(ry); g.translate(x, y, z + zOff); return g; };
  const add = (g: THREE.BufferGeometry, mat: TrainMatKey) => parts.push({ geo: g, mat });
  add(at(sw.geo, 0, 0, 0), 'body');
  const z0 = -len / 2, z1 = len / 2, bodyEnd = nose ? z1 - noseLen : z1;
  const mirror = (j: number) => (M - j) % M;
  const rA = ringAt(sw, z0 + 0.35), rB = ringAt(sw, bodyEnd - 0.25);
  // window band both sides
  const jw0 = jAt(prof, w / 2, h * 0.57), jw1 = jAt(prof, w / 2, h * 0.79);
  add(at(patch(sw, rA + 1, rB, Math.min(jw0, jw1), Math.max(jw0, jw1), 0.012), 0, 0, 0), 'glass');
  add(at(patch(sw, rA + 1, rB, Math.min(mirror(jw0), mirror(jw1)), Math.max(mirror(jw0), mirror(jw1)), 0.012), 0, 0, 0), 'glass');
  // light accent panel along the lower side
  const ja0 = jAt(prof, w / 2, h * 0.36), ja1 = jAt(prof, w / 2, h * 0.5);
  add(at(patch(sw, rA, rB, Math.min(ja0, ja1), Math.max(ja0, ja1), 0.008), 0, 0, 0), 'accent');
  add(at(patch(sw, rA, rB, Math.min(mirror(ja0), mirror(ja1)), Math.max(mirror(ja0), mirror(ja1)), 0.008), 0, 0, 0), 'accent');
  // windshield on the nose
  if (nose) {
    const r0 = ringAt(sw, bodyEnd + 0.3), r1 = ringAt(sw, z1 - 0.75);
    const span = Math.min(14, Math.floor(M / 4));
    add(at(patch(sw, r0, r1, ROOF_C - span, ROOF_C + span, 0.01), 0, 0, 0), 'shield');
  }
  // neon rails: skirt both sides, thinner on the shoulders, into the nose
  const jShoulder = jAt(prof, w / 2 - rTop + rTop * Math.cos(Math.PI / 4), h - rTop + rTop * Math.sin(Math.PI / 4));
  const jSkirt = jAt(prof, w / 2 - tuck - rBot + rBot * Math.cos(-Math.PI / 4), FLOOR + rBot + rBot * Math.sin(-Math.PI / 4));
  const rEnd = ringAt(sw, z1 - (nose ? 0.5 : 0.2));
  add(at(rail(sw, jSkirt, rA, rEnd, 0.02, 0.03), 0, 0, 0), 'neon');
  add(at(rail(sw, mirror(jSkirt), rA, rEnd, 0.02, 0.03), 0, 0, 0), 'neon');
  add(at(rail(sw, jShoulder, rA, rEnd, 0.015, 0.02), 0, 0, 0), 'neon');
  add(at(rail(sw, mirror(jShoulder), rA, rEnd, 0.015, 0.02), 0, 0, 0), 'neon');
  // flat ends: red bars + coupling plate
  const endBar = (z: number, dir: number) => {
    add(at(new RoundedBoxGeometry(w - 0.5, 0.2, 0.1, 2, 0.05), 0, h * 0.54, z + dir * 0.04), 'red');
    add(at(new RoundedBoxGeometry(w - 0.4, 0.12, 0.08, 2, 0.03), 0, 0.62, z + dir * 0.03), 'red');
    add(at(new RoundedBoxGeometry(0.55, 0.45, 0.18, 2, 0.05), 0, 0.95, z + dir * 0.08), 'dark');
  };
  endBar(z0, -1);
  if (!nose) endBar(z1, 1);
  // nose: central headlight + two slits + tip bar
  if (nose) {
    add(at(new RoundedBoxGeometry(0.45, 0.2, 0.12, 2, 0.06), 0, FLOOR + 0.78, z1 - 0.02), 'white');
    for (const s of [-1, 1]) add(at(new RoundedBoxGeometry(0.3, 0.07, 0.1, 2, 0.03), s * w * 0.24, FLOOR + 0.55, z1 - 0.22, s * 0.55), 'white');
    add(at(new RoundedBoxGeometry(w * 0.28, 0.05, 0.06, 2, 0.02), 0, FLOOR + 0.36, z1 - 0.05), 'neon');
  }
  // low roof pods with a strip (they protrude ~0.1 above the running surface)
  const pods: [number, number][] = nose ? [[z0 + 2.0, Math.min(2.4, len * 0.25)], [bodyEnd - 1.4, Math.min(2.0, len * 0.2)]] : len > 6 ? [[-len * 0.18, Math.min(2.4, len * 0.3)], [len * 0.2, Math.min(2.0, len * 0.25)]] : [[0, Math.min(2.0, len * 0.4)]];
  for (const [z, l] of pods) {
    add(at(new RoundedBoxGeometry(w * 0.42, 0.24, l, 3, 0.1), 0, h - 0.02, z), 'dark');
    add(at(new RoundedBoxGeometry(0.05, 0.03, l - 0.4, 1, 0.012), 0, h + 0.1, z), 'neon');
  }
  // door outline on both sides
  for (const s of [-1, 1]) {
    const zD = z0 + 1.5;
    for (const [dz, y, ww, hh] of [[0, h * 0.875, 0.95, 0.04], [0, 0.6, 0.95, 0.04], [-0.47, 1.525, 0.04, 1.9], [0.47, 1.525, 0.04, 1.9]]) add(at(new THREE.BoxGeometry(0.012, hh, ww), s * (w / 2 + 0.004), y, zD + dz), 'dark');
  }
  // levitation pads with a lit underside
  const nPads = nose ? [z0 + 1.3, (z0 + bodyEnd) / 2, bodyEnd - 0.8] : len > 7 ? [z0 + 1.2, 0, z1 - 1.2] : [z0 + 1.0, z1 - 1.0];
  for (const z of nPads) {
    add(at(new RoundedBoxGeometry(w * 0.58, 0.3, 1.3, 2, 0.08), 0, FLOOR - 0.12, z), 'pad');
    add(at(new THREE.BoxGeometry(w * 0.5, 0.02, 1.1), 0, FLOOR - 0.27, z), 'neon');
  }
}

/** Splits a train length into a locomotive and wagons (gap 0.5 between cars). */
function splitCars(len: number): { len: number; nose: boolean }[] {
  if (len < 13) return [{ len, nose: true }];
  const loco = 9;
  const rest = len - loco - 0.5;
  const n = Math.max(1, Math.ceil(rest / 8.5));
  const wl = (rest - 0.5 * (n - 1)) / n;
  const cars = [{ len: loco, nose: true }];
  for (let i = 0; i < n; i++) cars.push({ len: wl, nose: false });
  return cars;
}

export function buildTrain(mats: TrainMats, len: number, w = 1.9, h = 2.8, noseLen = 3.6): THREE.Group {
  const parts: TPart[] = [];
  const cars = splitCars(len);
  let zFront = len / 2; // nose end
  for (const car of cars) {
    const zc = zFront - car.len / 2;
    buildCar(parts, car.len, car.nose, w, h, noseLen, zc);
    zFront -= car.len + 0.5;
  }
  const group = new THREE.Group();
  const keys = ['body', 'dark', 'pad', 'accent', 'glass', 'shield', 'neon', 'red', 'white'] as const;
  for (const key of keys) {
    const raw = parts.filter((p) => p.mat === key).map((p) => p.geo);
    if (!raw.length) continue;
    const geos = raw.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
      return n;
    });
    const merged = mergeGeometries(geos);
    if (!merged) throw new Error('train: merge failed for ' + key);
    for (const g of raw) g.dispose();
    const mesh = new THREE.Mesh(merged, mats[key]);
    mesh.name = key;
    group.add(mesh);
  }
  return group;
}
