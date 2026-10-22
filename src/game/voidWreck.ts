import * as THREE from 'three';
import { buildTrain, type TrainMats } from './obstacles';
import { makeRustMaterial, makeBrokenGlassMaterial } from './wreckShaders';

/**
 * Unknown Future "train" variant 2: the wreck of a maglev. The approved procedural train (obstacles.ts), aged: every
 * light out, the hull rusted (wreckShaders.ts: faded paint, rust blooms, lifting paint, runs, pitting), the windows
 * dark matte glass with impact webs and jagged black holes. Same frame as the maglev (ramp nose at +z, tail at -z),
 * so the game handles it exactly like one. The shaders sample object-space position, so no UVs needed.
 */
export interface WreckMats extends TrainMats { rust: THREE.ShaderMaterial; rustDark: THREE.ShaderMaterial; brokenGlass: THREE.ShaderMaterial }
/** the maglev's material set, aged: rust hull (faded paint), the fittings (pods, frames, pads, panels, dead rails and tail bars) rust on a dark brown base, broken glass, the headlights missing (flat black sockets) */
// values tuned by the owner on the preview page (2026-10-22)
export const WRECK_VALUES = { rust: 0.7, scale: 1.09, streak: 1.33, bright: 0.48, glass: 0.63, hole: 1.32, glassScale: 0.92 };
export function makeWreckMats(v = WRECK_VALUES): WreckMats {
  const rust = makeRustMaterial({ rust: v.rust, scale: v.scale, streak: v.streak, bright: v.bright });
  const brokenGlass = makeBrokenGlassMaterial({ glass: v.glass, hole: v.hole, scale: v.glassScale, bright: v.bright });
  const rustDark = makeRustMaterial({ paint: new THREE.Color(0.028, 0.016, 0.009), rust: v.rust * 0.5 / 0.55, scale: v.scale * 1.6, streak: v.streak, bright: v.bright }); // dark brown base, finer rust
  const socket = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }); // the headlights are gone: flat black holes where they sat
  return { body: rust, glass: brokenGlass, shield: brokenGlass, dark: rustDark, pad: rustDark, accent: rustDark, neon: rustDark, red: rustDark, white: socket, rust, rustDark, brokenGlass };
}
export function buildWreckTrain(mats: WreckMats, len: number, w = 1.9, h = 2.8, noseLen = 3.6): THREE.Group {
  return buildTrain(mats, len, w, h, noseLen);
}
