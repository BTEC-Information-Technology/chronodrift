import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Pickup tokens, one look per era (approved concepts): the game's 0.9-unit core.
 *  - coin (Neo-Cyberpunk): bevelled disc, neon rim, neon hourglass emblem on both faces
 *  - hourglass (Prehistoric): glass hourglass with glowing sand and a trickling stream
 *  - shard (Ancient): elongated crystal, bright core inside, a thin orbiting neon ring
 *  - gear (Solarpunk): dark cog, neon line on the teeth, lit hub and spokes on both faces, spins on its axis
 *  - orb (Unknown Future): glass sphere, bright inner ball, two tilted neon rings
 * Materials come from the game: dark (metal), glass, neon (the era's core colour, HDR → bloom).
 * Children named 'spin' / 'ring' / 'ring2' are animated by the game.
 */
export type TokenKind = 'coin' | 'hourglass' | 'shard' | 'gear' | 'orb';
export const TOKEN_BY_ERA: TokenKind[] = ['coin', 'hourglass', 'shard', 'gear', 'orb'];

export interface TokenMats {
  dark: THREE.Material;
  glass: THREE.Material;
  neon: THREE.Material;
}

const mesh = (geo: THREE.BufferGeometry, m: THREE.Material) => new THREE.Mesh(geo, m);

function coin(m: TokenMats): THREE.Group {
  const grp = new THREE.Group();
  const disc = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 32), m.dark);
  disc.rotation.x = Math.PI / 2;
  grp.add(disc);
  grp.add(mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 40), m.neon));
  const face = (z: number) => {
    const f = new THREE.Group();
    const t = 0.05;
    const bar = (x0: number, y0: number, x1: number, y1: number) => {
      const L = Math.hypot(x1 - x0, y1 - y0);
      const b = mesh(new RoundedBoxGeometry(L, t, 0.02, 1, 0.01), m.neon);
      b.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
      b.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      f.add(b);
    };
    bar(-0.2, 0.26, 0.2, 0.26);
    bar(-0.2, -0.26, 0.2, -0.26);
    bar(-0.2, 0.26, 0.2, -0.26);
    bar(0.2, 0.26, -0.2, -0.26);
    const sand = mesh(new THREE.CircleGeometry(0.06, 12), m.neon);
    sand.position.set(0, -0.17, z);
    f.add(sand);
    return f;
  };
  grp.add(face(0.052));
  const back = face(0.052);
  back.rotation.y = Math.PI; // → sits at -z, facing backwards
  grp.add(back);
  return grp;
}

function hourglass(m: TokenMats): THREE.Group {
  const grp = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, y = -0.3 + 0.6 * t;
    const r = 0.07 + 0.22 * Math.pow(Math.abs(2 * t - 1), 1.6);
    pts.push(new THREE.Vector2(r, y));
  }
  grp.add(mesh(new THREE.LatheGeometry(pts, 24), m.glass));
  const top = mesh(new THREE.ConeGeometry(0.2, 0.2, 20), m.neon);
  top.rotation.x = Math.PI;
  top.position.y = 0.17;
  grp.add(top);
  const bot = mesh(new THREE.ConeGeometry(0.22, 0.14, 20), m.neon);
  bot.position.y = -0.22;
  grp.add(bot);
  const stream = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), m.neon);
  stream.position.y = -0.02;
  grp.add(stream);
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 24), m.dark);
    cap.position.y = s * 0.34;
    grp.add(cap);
    const lip = mesh(new THREE.TorusGeometry(0.3, 0.018, 6, 32), m.neon);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = s * 0.3;
    grp.add(lip);
  }
  return grp;
}

function shard(m: TokenMats): THREE.Group {
  const grp = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(0.32, 0);
  geo.scale(1, 1.6, 1);
  grp.add(mesh(geo, m.glass));
  const core = new THREE.OctahedronGeometry(0.17, 0);
  core.scale(1, 1.5, 1);
  grp.add(mesh(core, m.neon));
  const ring = mesh(new THREE.TorusGeometry(0.42, 0.018, 6, 40), m.neon);
  ring.rotation.x = Math.PI / 2;
  ring.name = 'ring';
  grp.add(ring);
  return grp;
}

function gear(m: TokenMats): THREE.Group {
  const grp = new THREE.Group();
  const teeth = 10, R = 0.36, r = 0.3;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2, a2 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    if (i === 0) shape.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else shape.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    shape.lineTo(Math.cos(a2) * rad, Math.sin(a2) * rad);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.12, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
  geo.translate(0, 0, -0.05);
  const body = new THREE.Group();
  body.name = 'spin';
  body.add(mesh(geo, m.dark));
  for (const z of [-0.065, 0.065]) {
    const rim = mesh(new THREE.TorusGeometry(0.25, 0.018, 6, 40), m.neon);
    rim.position.z = z;
    body.add(rim);
    const hub = mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 24), m.neon);
    hub.position.z = z;
    body.add(hub);
    for (let i = 0; i < 4; i++) {
      const sp = mesh(new RoundedBoxGeometry(0.1, 0.035, 0.025, 1, 0.01), m.neon);
      const a = i * Math.PI / 2 + Math.PI / 4;
      sp.position.set(Math.cos(a) * 0.19, Math.sin(a) * 0.19, z);
      sp.rotation.z = a;
      body.add(sp);
    }
  }
  body.add(mesh(new THREE.TorusGeometry(0.36, 0.012, 6, 60), m.neon));
  grp.add(body);
  return grp;
}

function orb(m: TokenMats): THREE.Group {
  const grp = new THREE.Group();
  grp.add(mesh(new THREE.SphereGeometry(0.3, 24, 16), m.glass));
  grp.add(mesh(new THREE.SphereGeometry(0.13, 16, 12), m.neon));
  const r1 = mesh(new THREE.TorusGeometry(0.4, 0.02, 6, 40), m.neon);
  r1.rotation.x = Math.PI / 2;
  r1.name = 'ring';
  grp.add(r1);
  const r2 = mesh(new THREE.TorusGeometry(0.4, 0.02, 6, 40), m.neon);
  r2.rotation.x = Math.PI / 2 + 0.9;
  r2.name = 'ring2';
  grp.add(r2);
  return grp;
}

export function buildToken(kind: TokenKind, mats: TokenMats): THREE.Group {
  switch (kind) {
    case 'coin': return coin(mats);
    case 'hourglass': return hourglass(mats);
    case 'shard': return shard(mats);
    case 'gear': return gear(mats);
    case 'orb': return orb(mats);
  }
}

/** Per-frame animation of a token look: rings orbit, the gear turns on its axis. */
export function animateToken(look: THREE.Group, dt: number): void {
  const ring = look.getObjectByName('ring');
  if (ring) ring.rotation.z += dt * 0.8;
  const ring2 = look.getObjectByName('ring2');
  if (ring2) ring2.rotation.y += dt * 1.1;
  const spin = look.getObjectByName('spin');
  if (spin) spin.rotation.z += dt * 0.7;
}
