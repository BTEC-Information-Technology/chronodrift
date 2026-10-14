import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Neo-Cyberpunk obstacle looks in the maglev's language: smooth rounded bodies with city reflections,
 * light accent panels, neon as emissive geometry (the type's colour, era-tinted by the game), white lights.
 *  - block (jump over): a hover cargo pod on two lit pads, two up-chevrons on the face
 *  - overhead (slide under): a floating gantry with thruster pods, a sign plate with a down-chevron, lit underside
 *  - wall (change lane): a barrier emitter — two posts with lit edges, a solid plate with glass, panel and red bars
 * Dimensions match the game's collision specs. Materials are passed in, so other eras can reuse the geometry.
 */
export interface ObstacleMats {
  body: THREE.Material; // rounded hull
  dark: THREE.Material; // pads, pods, plates
  accent: THREE.Material; // light panel
  glass: THREE.Material; // dark glass
  neon: THREE.Material; // the type's colour (emissive, HDR → bloom)
  white: THREE.Material; // small white lights
}

type Part<K extends string> = { geo: THREE.BufferGeometry; mat: K };

const rbox = (w: number, h: number, d: number, r = 0.06, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r);

function place<K extends string>(parts: Part<K>[], geo: THREE.BufferGeometry, mat: K, x: number, y: number, z: number, rz = 0): void {
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  parts.push({ geo, mat });
}

/** Continuous chevron: two bars whose inner ends meet at the apex (slightly overlapping) + a round knuckle. */
function chevron<K extends string>(parts: Part<K>[], mat: K, x: number, apexY: number, z: number, L: number, a: number, up: boolean, t = 0.07): void {
  const dy = up ? -1 : 1;
  for (const sx of [-1, 1]) place(parts, rbox(L + t, t, 0.03, t * 0.45, 1), mat, x + sx * (L / 2) * Math.cos(a), apexY + dy * (L / 2) * Math.sin(a), z, sx * dy * a);
  place(parts, new THREE.CylinderGeometry(t * 0.5, t * 0.5, 0.03, 10).rotateX(Math.PI / 2), mat, x, apexY, z);
}

/** Merges the parts per material into one mesh each (position + normal only; smooth normals survive). */
function assemble<K extends string>(parts: Part<K>[], mats: Record<K, THREE.Material>, keys: readonly K[]): THREE.Group {
  const group = new THREE.Group();
  for (const key of keys) {
    const raw = parts.filter((p) => p.mat === key).map((p) => p.geo);
    if (!raw.length) continue;
    const geos = raw.map((g) => {
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      if (!g.index) { const n = g.attributes.position.count; const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
      return g;
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

const OB_KEYS = ['body', 'dark', 'accent', 'glass', 'neon', 'white'] as const;
type ObKey = (typeof OB_KEYS)[number];

/** Hover cargo pod, centred at the origin (the game places it at y = h/2). 1.7 x 1.1 x 1.2. */
export function buildBlock(mats: ObstacleMats, w = 1.7, h = 1.1, d = 1.2): THREE.Group {
  const parts: Part<ObKey>[] = [];
  place(parts, rbox(w * 0.94, h * 0.72, d * 0.9, 0.16, 3), 'body', 0, 0.08, 0);
  for (const s of [-1, 1]) place(parts, rbox(0.02, h * 0.26, d * 0.62, 0.008, 1), 'accent', s * (w * 0.47 + 0.004), 0.12, 0);
  const zf = d * 0.45 + 0.012; // face towards the player (+z)
  place(parts, rbox(w * 0.74, h * 0.5, 0.02, 0.01, 1), 'dark', 0, 0.1, zf);
  for (const apexY of [0.08, 0.32]) chevron(parts, 'neon', 0, apexY, zf + 0.02, 0.4, 0.62, true);
  for (const sz of [-1, 1]) place(parts, rbox(w * 0.86, 0.045, 0.045, 0.02, 1), 'neon', 0, 0.08 + h * 0.36 + 0.01, sz * d * 0.44);
  for (const sx of [-1, 1]) place(parts, rbox(0.14, 0.06, 0.04, 0.02, 1), 'white', sx * (w * 0.38), -0.22, zf + 0.02);
  for (const sz of [-1, 1]) {
    place(parts, rbox(w * 0.5, 0.14, 0.34, 0.05, 2), 'dark', 0, -h * 0.5 + 0.09, sz * d * 0.26);
    place(parts, new THREE.BoxGeometry(w * 0.42, 0.015, 0.26), 'neon', 0, -h * 0.5 + 0.015, sz * d * 0.26);
  }
  return assemble(parts, mats, OB_KEYS);
}

/** Floating sign gantry, centred at the origin (the game places it at OVERHEAD_Y + h/2). 2.0 x 0.7 x 1.0. */
export function buildOverhead(mats: ObstacleMats, w = 2.0, h = 0.7, d = 1.0): THREE.Group {
  const parts: Part<ObKey>[] = [];
  place(parts, rbox(w * 0.8, h * 0.56, d * 0.7, 0.12, 3), 'body', 0, 0.04, 0);
  for (const sx of [-1, 1]) {
    place(parts, rbox(0.34, h * 0.86, d * 0.86, 0.1, 3), 'dark', sx * (w / 2 - 0.17), 0, 0);
    place(parts, new THREE.BoxGeometry(0.26, 0.015, d * 0.7), 'neon', sx * (w / 2 - 0.17), -h * 0.43 - 0.005, 0);
  }
  const zf = d * 0.35 + 0.012;
  place(parts, rbox(w * 0.66, h * 0.4, 0.02, 0.01, 1), 'accent', 0, 0.08, zf);
  chevron(parts, 'neon', 0, -0.02, zf + 0.02, 0.34, 0.6, false);
  place(parts, rbox(w * 0.72, 0.05, 0.12, 0.02, 1), 'neon', 0, -h * 0.28 - 0.02, 0); // lit underside (seen when sliding)
  for (const sx of [-1, 1]) place(parts, rbox(0.16, 0.06, 0.04, 0.02, 1), 'white', sx * (w / 2 - 0.17), -0.08, d * 0.43 + 0.02);
  return assemble(parts, mats, OB_KEYS);
}

/** Barrier emitter, centred at the origin (the game places it at y = h/2). 1.8 x 2.6 x 1.0. */
export function buildWall(mats: ObstacleMats, w = 1.8, h = 2.6, d = 1.0): THREE.Group {
  const parts: Part<ObKey>[] = [];
  const post = 0.32;
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - post / 2);
    place(parts, rbox(post, h * 0.98, d * 0.72, 0.09, 3), 'body', x, 0, 0);
    place(parts, rbox(0.05, h * 0.84, 0.05, 0.02, 1), 'neon', x, 0, d * 0.36 + 0.02);
    place(parts, rbox(post * 0.7, 0.08, d * 0.5, 0.03, 1), 'white', x, h * 0.49 + 0.05, 0);
    place(parts, new THREE.BoxGeometry(post * 0.8, 0.015, d * 0.6), 'neon', x, -h * 0.49 - 0.005, 0);
  }
  const pw = w - post * 2 + 0.04;
  place(parts, rbox(pw, h * 0.92, d * 0.4, 0.06, 2), 'dark', 0, 0, 0);
  const zf = d * 0.2 + 0.012;
  place(parts, rbox(pw * 0.9, h * 0.34, 0.02, 0.01, 1), 'glass', 0, h * 0.24, zf);
  place(parts, rbox(pw * 0.9, h * 0.22, 0.02, 0.01, 1), 'accent', 0, -h * 0.3, zf);
  place(parts, rbox(pw * 0.94, 0.16, 0.05, 0.03, 1), 'neon', 0, h * 0.03, zf + 0.02);
  place(parts, rbox(pw * 0.94, 0.06, 0.04, 0.02, 1), 'neon', 0, -h * 0.12, zf + 0.02);
  return assemble(parts, mats, OB_KEYS);
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

type TPart = Part<TrainMatKey>;

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
  return assemble(parts, mats, ['body', 'dark', 'pad', 'accent', 'glass', 'shield', 'neon', 'red', 'white'] as const);
}
