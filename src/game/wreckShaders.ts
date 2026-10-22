import * as THREE from 'three';
import { GLSL_NOISE } from './space';

/**
 * Surfaces for the aged maglev (Unknown Future wreck), after photo references of abandoned trains and broken car glass.
 *  - rust: faded paint with rust blooms (soft-edged patches of a second noise, darker and orange), a lighter blistered
 *    ring of lifting paint around each patch, vertical runs below them, pitting, more corrosion low on the hull
 *  - broken glass: dark matte glass; per cell (object space) one impact point with a web of radial cracks and
 *    concentric rings, fine crazing, and a jagged black hole at the centre; cells without an impact stay plain
 * Both sample object-space position (no UVs needed), are shaded by a fixed light from the upper front, and carry the
 * road curvature through `uniforms.uCurve` (zero outside the game).
 */
const VERTEX = `uniform vec2 uCurve; varying vec3 vP; varying vec3 vN; varying vec3 vNv;
  void main(){ vP = position; vN = normal; vNv = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float cDist = -mv.z; mv.x += uCurve.x * cDist * cDist; mv.y += uCurve.y * cDist * cDist; gl_Position = projectionMatrix * mv; }`;
const LIGHT = `vec3 nv = normalize(vNv); float lam = max(0.0, dot(nv, normalize(vec3(0.35, 0.8, 0.5)))); col *= (0.4 + 0.7 * lam) * uBright;`;

export interface RustParams { rust?: number; scale?: number; streak?: number; bright?: number; paint?: THREE.Color; hullHeight?: number }
export function makeRustMaterial(o: RustParams = {}): THREE.ShaderMaterial {
  const U = { uCurve: { value: new THREE.Vector2(0, 0) }, uRust: { value: o.rust ?? 0.55 }, uScale: { value: o.scale ?? 1 }, uStreak: { value: o.streak ?? 1 }, uBright: { value: o.bright ?? 1 }, uH: { value: o.hullHeight ?? 2.8 },
    uPaint: { value: o.paint ?? new THREE.Color(0.05, 0.055, 0.08) }, uRustA: { value: new THREE.Color(0.09, 0.035, 0.015) }, uRustB: { value: new THREE.Color(0.45, 0.17, 0.04) } };
  return new THREE.ShaderMaterial({ uniforms: U, toneMapped: false, fog: false, vertexShader: VERTEX,
    fragmentShader: `uniform float uRust, uScale, uStreak, uBright, uH; uniform vec3 uPaint, uRustA, uRustB; varying vec3 vP; varying vec3 vN; varying vec3 vNv; ${GLSL_NOISE}
      void main(){ vec3 p = vP * uScale;
        float bloom = fbm(p * 1.3); float detail = fbm(p * 5.0 + 3.1);
        float runs = fbm(vec3(p.x * 6.0, p.y * 0.35, p.z * 6.0) + 7.0); // stretched vertically: rust running down
        float low = 1.0 - smoothstep(0.0, uH, vP.y); // more corrosion low on the hull
        float r = bloom + (detail - 0.5) * 0.35 + (runs - 0.5) * uStreak * 0.45 + low * 0.12;
        float th = 0.66 - uRust * 0.3; float rust = smoothstep(th, th + 0.09, r);
        float ring = (1.0 - smoothstep(0.0, 0.05, abs(r - th))) * (1.0 - rust); // lifting paint around the patch
        vec3 rustCol = mix(uRustA, uRustB, smoothstep(0.3, 0.7, fbm(p * 2.2 + 11.0)));
        float pits = smoothstep(0.62, 0.8, noise(p * 40.0)); rustCol *= 1.0 - pits * 0.5;
        vec3 paint = uPaint * (0.8 + 0.4 * fbm(p * 0.7 + 5.0)); paint = mix(paint, paint * 1.8 + 0.05, ring);
        vec3 col = mix(paint, rustCol, rust); ${LIGHT} gl_FragColor = vec4(col, 1.0); }` });
}

export interface GlassParams { glass?: number; hole?: number; scale?: number; bright?: number }
export function makeBrokenGlassMaterial(o: GlassParams = {}): THREE.ShaderMaterial {
  const U = { uCurve: { value: new THREE.Vector2(0, 0) }, uGlass: { value: o.glass ?? 0.7 }, uHole: { value: o.hole ?? 1 }, uScale: { value: o.scale ?? 1 }, uBright: { value: o.bright ?? 1 } };
  return new THREE.ShaderMaterial({ uniforms: U, toneMapped: false, fog: false, vertexShader: VERTEX,
    fragmentShader: `uniform float uGlass, uHole, uScale, uBright; varying vec3 vP; varying vec3 vN; varying vec3 vNv; ${GLSL_NOISE}
      void main(){ vec3 p = vP; vec3 n = normalize(vN);
        float C = 1.4 / uScale; vec3 cell0 = floor(p / C);
        // nearest impact among this cell and its neighbours (a web may cross a cell border: no straight cut edges)
        float d = 1e9; vec3 dv = vec3(0.0); vec3 cell = cell0; float has = 0.0;
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
          vec3 cc = cell0 + vec3(float(i), float(j), float(k)); if (hash(cc + 2.2) < 1.0 - uGlass) continue; // this pane was not hit
          vec3 c = (cc + vec3(hash(cc + 0.37), hash(cc + 5.1), hash(cc + 9.7))) * C; vec3 v = p - c; v -= dot(v, n) * n; float dd = length(v);
          if (dd < d) { d = dd; dv = v; cell = cc; has = 1.0; } }
        vec3 t1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0))); vec3 t2 = cross(n, t1);
        float ang = atan(dot(dv, t2), dot(dv, t1));
        float R = 0.6 * C; float fall = 1.0 - smoothstep(R * 0.35, R, d);
        float jit = fbm(p * 9.0) - 0.5;
        float spokes = 1.0 - smoothstep(0.0, 0.12, abs(sin(ang * 7.0 + jit * 2.5)));
        float rings = 1.0 - smoothstep(0.0, 0.14, abs(sin(d * 22.0 + jit * 4.0)));
        float web = max(spokes, rings * 0.7) * fall;
        float craze = (1.0 - smoothstep(0.0, 0.06, abs(fbm(p * 14.0) - 0.5))) * fall * 0.6;
        float holeR = uHole * C * (0.1 + 0.1 * fbm(vec3(cos(ang), sin(ang), 0.0) * 2.0 + cell)); // jagged rim
        float hole = 1.0 - smoothstep(holeR, holeR + 0.015, d);
        vec3 col = vec3(0.03, 0.035, 0.045) + vec3(0.05, 0.06, 0.07) * pow(1.0 - abs(normalize(vNv).z), 3.0); // dark matte glass, soft rim
        col = mix(col, vec3(0.55, 0.65, 0.7), clamp(web + craze, 0.0, 1.0) * 0.85 * has);
        col = mix(col, vec3(0.0), hole * has);
        ${LIGHT} gl_FragColor = vec4(col, 1.0); }` });
}
