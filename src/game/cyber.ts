import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural art for the Neo-Cyberpunk ("home") era: canvas-generated facades with lit windows,
 * satirical neon billboards, wet asphalt, and small helpers (scanline hologram shader hook).
 * Everything is generated at start-up, no asset downloads.
 */

export interface FacadeSet {
  map: THREE.CanvasTexture; // base colour (dark concrete + window frames)
  emissive: THREE.CanvasTexture; // lit windows + neon strips only
  lit: THREE.CanvasTexture; // composite, for unlit materials (horizon backdrop)
}

const WINDOW_TINTS = ['#e8eeff', '#fff6e6', '#ffd98a', '#ffb866']; // interior light only: cold white -> warm orange
const NEON = ['#00eaff', '#ff36c8', '#ffd23a', '#7eff9a'];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** One facade tile covers ~4 x 4 world units: 5 window columns x 10 floors. */
export function makeFacadeTextures(count: number, rng: () => number): FacadeSet[] {
  const W = 128, H = 256; // small: every building clones the texture for its own repeat (GPU memory on phones)
  const cols = 5, rows = 10;
  const out: FacadeSet[] = [];
  for (let k = 0; k < count; k++) {
    const [cm, m] = canvas(W, H);
    const [ce, e] = canvas(W, H);
    const [cl, l] = canvas(W, H);
    const base = ['#0d1430', '#1b1234', '#0c1c38', '#101a2c'][k % 4];
    m.fillStyle = base;
    m.fillRect(0, 0, W, H);
    e.fillStyle = '#000';
    e.fillRect(0, 0, W, H);
    l.fillStyle = base;
    l.fillRect(0, 0, W, H);
    // floor bands (slightly darker) for a concrete rhythm
    m.fillStyle = 'rgba(0,0,0,0.25)';
    l.fillStyle = 'rgba(0,0,0,0.25)';
    for (let r = 0; r < rows; r++) {
      m.fillRect(0, (r * H) / rows, W, 4);
      l.fillRect(0, (r * H) / rows, W, 4);
    }
    const litP = 0.3 + rng() * 0.25;
    const cw = W / cols, rh = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + cw * 0.22, y = r * rh + rh * 0.3, w = cw * 0.56, h = rh * 0.42;
        m.fillStyle = '#05060f';
        m.fillRect(x, y, w, h);
        if (rng() < litP) {
          const tint = WINDOW_TINTS[(rng() * WINDOW_TINTS.length) | 0];
          const a = 0.45 + rng() * 0.55;
          e.globalAlpha = a;
          e.fillStyle = tint;
          e.fillRect(x, y, w, h);
          e.globalAlpha = 1;
          l.globalAlpha = a;
          l.fillStyle = tint;
          l.fillRect(x, y, w, h);
          l.globalAlpha = 1;
        } else {
          l.fillStyle = '#05060f';
          l.fillRect(x, y, w, h);
        }
      }
    }
    // an occasional neon strip along one floor
    if (rng() < 0.6) {
      const r = (rng() * rows) | 0;
      const col = NEON[(rng() * NEON.length) | 0];
      for (const ctx of [e, l]) {
        ctx.fillStyle = col;
        ctx.fillRect(0, r * rh + 2, W, 3);
      }
    }
    out.push({ map: tex(cm), emissive: tex(ce), lit: tex(cl) });
  }
  return out;
}

/**
 * A unique facade for ONE building, sized to it: fixed window cells (0.9 wide x 1.4 tall world units,
 * portrait windows), so nothing repeats. Returns a base map and an emissive map; neon strips are drawn
 * at full brightness while windows stay at 30-70%.
 */
export function makeFacade(
  wUnits: number,
  hUnits: number,
  rng: () => number,
  opts: { cellScale?: number; px?: number; composite?: boolean } = {},
): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture; neon: string } {
  const cs = opts.cellScale ?? 1; // >1 = bigger cells (distant skyline)
  const pxs = opts.px ?? 1; // <1 = lower resolution
  const cols = Math.max(2, Math.round(wUnits / (0.9 * cs)));
  const rows = Math.max(4, Math.round(hUnits / (1.4 * cs)));
  const cw = Math.max(6, Math.round(14 * pxs)); // px per cell column
  const rh = Math.min(Math.max(8, Math.round(22 * pxs)), Math.floor(1024 / rows)); // px per floor, capped so the canvas stays <= 1024 px tall
  const W = cols * cw, H = rows * rh;
  const [cm, m] = canvas(W, H);
  const [ce, e] = canvas(W, H);
  const base = ['#0d1430', '#1b1234', '#0c1c38', '#101a2c'][(rng() * 4) | 0];
  m.fillStyle = base;
  m.fillRect(0, 0, W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const litP = 0.2 + rng() * 0.15;
  const winW = Math.round(cw * 0.55), winH = Math.round(rh * 0.62);
  const ox = Math.round((cw - winW) / 2), oy = Math.round((rh - winH) * 0.55);
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh;
    m.fillStyle = 'rgba(0,0,0,0.3)'; // floor band
    m.fillRect(0, y0, W, Math.max(2, Math.round(rh * 0.14)));
    const roll = rng();
    const floorMode = roll < 0.12 ? 'dark' : roll < 0.17 ? 'office' : 'mixed';
    for (let c = 0; c < cols; c++) {
      const x = c * cw + ox, y = y0 + oy;
      m.fillStyle = '#05060f';
      m.fillRect(x, y, winW, winH);
      const lit = floorMode === 'office' ? rng() < 0.9 : floorMode === 'dark' ? false : rng() < litP;
      if (!lit) continue;
      const tint = WINDOW_TINTS[(rng() * WINDOW_TINTS.length) | 0];
      const a = floorMode === 'office' ? 0.55 : 0.3 + rng() * 0.4;
      e.globalAlpha = a;
      e.fillStyle = tint;
      e.fillRect(x, y, winW, winH);
      e.globalAlpha = 1;
      if (opts.composite) {
        m.globalAlpha = a;
        m.fillStyle = tint;
        m.fillRect(x, y, winW, winH);
        m.globalAlpha = 1;
      }
    }
  }
  // neon strips on 1-3 floors (full width, full brightness), one colour per building
  const neon = NEON[(rng() * NEON.length) | 0];
  const nStrips = 1 + ((rng() * 3) | 0);
  for (let i = 0; i < nStrips; i++) {
    const r = (rng() * rows) | 0;
    const y = r * rh;
    for (const ctx of [m, e]) {
      ctx.fillStyle = neon;
      ctx.fillRect(0, y, W, Math.max(2, Math.round(rh * 0.16)));
    }
  }
  const mt = tex(cm, false), et = tex(ce, false);
  mt.anisotropy = et.anisotropy = 2;
  return { map: mt, emissive: et, neon };
}

const BRANDS: [string, string][] = [
  ['NEON NOODLES', 'slurp the future'],
  ['CHRONO-COLA', 'tastes like yesterday'],
  ['DRIFT INSURANCE', 'we cover any era'],
  ['SLEEP.EXE', 'now with fewer dreams'],
  ['BYTE BURGER', '100% synthetic beef'],
  ['TEMPORAL TAXI', 'arrive before you leave'],
  ['NOVA BANK', 'your future, our interest'],
  ['GRAVITY GYM', 'lift what you cannot'],
  ['HOLO-DENTIST', 'smiles in 4K'],
  ['SYNTH-SOUP', 'mother never made it'],
];

export type AdFormat = 'square' | 'portrait' | 'landscape';
export const AD_ASPECT: Record<AdFormat, number> = { square: 1, portrait: 3 / 4, landscape: 16 / 9 };

/** Neon billboards for all 10 brands, each drawn natively in three formats (square, portrait, landscape). */
export function makeBillboardTextures(rng: () => number): Record<AdFormat, THREE.CanvasTexture>[] {
  const sizes: Record<AdFormat, [number, number]> = { square: [256, 256], portrait: [192, 256], landscape: [320, 180] };
  const out: Record<AdFormat, THREE.CanvasTexture>[] = [];
  for (let i = 0; i < BRANDS.length; i++) {
    const col = NEON[i % NEON.length];
    const col2 = NEON[(i + 1) % NEON.length];
    const tickerW = 0.4 + rng() * 0.6;
    const set = {} as Record<AdFormat, THREE.CanvasTexture>;
    for (const fmt of Object.keys(sizes) as AdFormat[]) {
      const [W, H] = sizes[fmt];
      const [c, g] = canvas(W, H);
      const m = Math.round(Math.min(W, H) * 0.045);
      g.fillStyle = '#04030c';
      g.fillRect(0, 0, W, H);
      g.lineWidth = Math.max(3, m);
      g.strokeStyle = col;
      g.shadowColor = col;
      g.shadowBlur = m * 2.5;
      g.strokeRect(m * 2, m * 2, W - m * 4, H - m * 4);
      // layout: landscape = glyph left, text right; square/portrait = glyph above the text
      const land = fmt === 'landscape';
      const gx = land ? W * 0.22 : W / 2;
      const gy = land ? H * 0.5 : H * 0.33;
      const gr = land ? H * 0.22 : Math.min(W, H) * 0.14;
      const tx = land ? W * 0.63 : W / 2;
      const tw = land ? W * 0.56 : W - m * 8;
      g.shadowBlur = m * 3;
      g.strokeStyle = col2;
      g.lineWidth = Math.max(3, m * 1.4);
      g.beginPath();
      const kind = i % 3;
      if (kind === 0) g.arc(gx, gy, gr, 0, Math.PI * 2);
      else if (kind === 1) {
        g.moveTo(gx, gy - gr);
        g.lineTo(gx + gr * 1.15, gy + gr);
        g.lineTo(gx - gr * 1.15, gy + gr);
        g.closePath();
      } else g.rect(gx - gr, gy - gr, gr * 2, gr * 2);
      g.stroke();
      g.textAlign = 'center';
      g.fillStyle = col;
      g.shadowColor = col;
      g.shadowBlur = m * 3;
      const brandPx = land ? H * 0.17 : Math.min(W * 0.105, H * 0.11);
      g.font = `900 ${Math.round(brandPx)}px Verdana, "Segoe UI", Arial, sans-serif`;
      g.fillText(BRANDS[i][0], tx, land ? H * 0.47 : H * 0.64, tw);
      g.fillStyle = '#e9e6ff';
      g.shadowColor = '#e9e6ff';
      g.shadowBlur = m;
      g.font = `600 ${Math.round(brandPx * 0.55)}px Verdana, "Segoe UI", Arial, sans-serif`;
      g.fillText(BRANDS[i][1], tx, land ? H * 0.64 : H * 0.76, tw);
      g.fillStyle = col2;
      g.shadowColor = col2;
      g.shadowBlur = m * 1.5;
      const bw = land ? W * 0.5 : W - m * 10;
      g.fillRect(land ? W * 0.63 - bw / 2 : m * 5, land ? H * 0.74 : H * 0.84, bw * tickerW, Math.max(2, m * 0.8));
      set[fmt] = tex(c, false);
    }
    out.push(set);
  }
  return out;
}

/** Wet asphalt: dark noise with faint lighter patches and wet streaks; tiles along the road. */
export function makeRoadTexture(rng: () => number): THREE.CanvasTexture {
  const W = 256, H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#9a9ab4';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const v = 110 + rng() * 90;
    g.fillStyle = `rgba(${v + 8},${v + 6},${v + 22},${0.25 + rng() * 0.5})`;
    g.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
  }
  // wet streaks (vertical, soft)
  for (let i = 0; i < 14; i++) {
    const x = rng() * W, w = 6 + rng() * 22;
    const grd = g.createLinearGradient(x, 0, x + w, 0);
    grd.addColorStop(0, 'rgba(230,236,255,0)');
    grd.addColorStop(0.5, `rgba(230,236,255,${0.12 + rng() * 0.16})`);
    grd.addColorStop(1, 'rgba(230,236,255,0)');
    g.fillStyle = grd;
    g.fillRect(x, 0, w, H);
  }
  // seams every ~64px
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < H; y += 128) g.fillRect(0, y, W, 2);
  const t = tex(c);
  t.repeat.set(1, 2);
  return t;
}

/** Hologram look for a material: a faint, sparse line pattern plus a soft scan band sweeping upwards. */
export function holoHook(mat: THREE.Material, timeUniform: { value: number }, density = 4) {
  (mat as THREE.MeshStandardMaterial).userData.shaderHook = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = timeUniform;
    const NL = String.fromCharCode(10);
    shader.vertexShader = 'varying vec3 vHoloPos;' + NL + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + NL + 'vHoloPos = position;');
    shader.fragmentShader =
      'uniform float uTime; varying vec3 vHoloPos;' + NL +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        [
          `float holoLine = 0.92 + 0.08 * smoothstep(0.35, 0.5, fract(vHoloPos.y * ${density.toFixed(1)} - uTime * 0.8));`,
          'float holoBand = 1.0 + 0.35 * exp(-pow((fract(uTime * 0.45) * 1.6 - 0.3 - vHoloPos.y * 0.5) * 6.0, 2.0));',
          'gl_FragColor.rgb *= holoLine * holoBand;',
          '#include <dithering_fragment>',
        ].join(NL),
      );
  };
}

/** Lightweight sky traffic: small lights crossing the skyline at various heights and speeds. */
export class SkyTraffic {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private speed: Float32Array;
  constructor(n: number, rng: () => number) {
    this.pos = new Float32Array(n * 3);
    this.speed = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = -220 + rng() * 440;
      this.pos[i * 3 + 1] = 18 + rng() * 60;
      this.pos[i * 3 + 2] = -140 - rng() * 110;
      this.speed[i] = (rng() < 0.5 ? -1 : 1) * (6 + rng() * 16);
      c.set(['#00eaff', '#ff36c8', '#ffffff', '#ffd23a'][(rng() * 4) | 0]);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const [sc, sg] = canvas(32, 32);
    const grd = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = grd;
    sg.fillRect(0, 0, 32, 32);
    const mat = new THREE.PointsMaterial({ size: 2.2, map: tex(sc, false), vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.points = new THREE.Points(geo, mat);
    this.points.renderOrder = -1;
  }
  update(dt: number) {
    for (let i = 0; i < this.speed.length; i++) {
      let x = this.pos[i * 3] + this.speed[i] * dt;
      if (x > 230) x = -230;
      if (x < -230) x = 230;
      this.pos[i * 3] = x;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Flying vehicles over the skyline: one merged low-poly body per vehicle (vertex colours), with headlights,
 * taillights and an underglow strip; they cross the horizon at different heights, depths and speeds. */
export class SkyVehicles {
  readonly group = new THREE.Group();
  private items: { m: THREE.Mesh; speed: number; baseY: number; phase: number }[] = [];
  constructor(count: number, rng: () => number) {
    const geo = SkyVehicles.buildGeometry();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      const dir = rng() < 0.5 ? -1 : 1;
      const s = 2.2 + rng() * 2.2;
      m.scale.setScalar(s);
      m.rotation.y = dir > 0 ? 0 : Math.PI; // nose along the travel direction
      const baseY = 16 + rng() * 58;
      m.position.set(-230 + rng() * 460, baseY, -130 - rng() * 100);
      this.group.add(m);
      this.items.push({ m, speed: dir * (5 + rng() * 14), baseY, phase: rng() * 6.28 });
    }
  }
  private static buildGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      const c = new THREE.Color(color);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(g);
    };
    box(1.0, 0.22, 0.42, 0, 0, 0, 0x0b0d1a); // hull (nose at +x)
    box(0.42, 0.16, 0.3, -0.08, 0.17, 0, 0x121a3a); // cabin
    box(0.08, 0.06, 0.12, 0.5, 0.02, 0.13, 0xffffff); // headlights
    box(0.08, 0.06, 0.12, 0.5, 0.02, -0.13, 0xffffff);
    box(0.06, 0.07, 0.34, -0.5, 0.02, 0, 0xff2a6a); // taillight bar
    box(0.8, 0.03, 0.2, 0, -0.12, 0, 0x00eaff); // underglow strip
    const merged = mergeGeometries(parts)!;
    for (const p of parts) p.dispose();
    return merged;
  }
  update(dt: number, t: number) {
    for (const it of this.items) {
      let x = it.m.position.x + it.speed * dt;
      if (x > 240) x = -240;
      else if (x < -240) x = 240;
      it.m.position.x = x;
      it.m.position.y = it.baseY + Math.sin(t * 0.7 + it.phase) * 0.8;
    }
  }
}

/**
 * Small equirectangular "neon city at night" environment (dark sky, a band of coloured window lights at the
 * horizon) → PMREM texture for the reflections on the train hulls. Generated once; 256×128 is plenty.
 */
export function makeCityEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#05030f');
  sky.addColorStop(0.45, '#1a0c3a');
  sky.addColorStop(0.5, '#2a1458');
  sky.addColorStop(0.56, '#07040f');
  sky.addColorStop(1, '#020108');
  g.fillStyle = sky;
  g.fillRect(0, 0, 256, 128);
  const cols = ['#00eaff', '#ff36c8', '#ffffff', '#ffd23a', '#7eff9a'];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 256, w = 3 + rnd() * 14, h = 4 + rnd() * 12;
    g.globalAlpha = 0.3 + rnd() * 0.5;
    g.fillStyle = cols[(rnd() * 5) | 0];
    g.fillRect(x, 64 - h + rnd() * 4, w, h);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}
