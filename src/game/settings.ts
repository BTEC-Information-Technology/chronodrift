// Player-adjustable settings: camera (live tweaking) + difficulty (multipliers).
export interface Settings {
  camHeight: number; // camera height
  camDistance: number; // how far behind the camera sits
  camTilt: number; // look-at target on Y (lower = looks further down)
  camFov: number; // field of view
  speedMult: number; // speed multiplier on top of the difficulty curve
  densityMult: number; // density multiplier (obstacles + cores)
  // TEST: allowed eras (index 0..4 = Neo-Cyberpunk/Prehistoric/Ancient/Solarpunk/Unknown Future).
  // All true = normal game (home-dominant). Subset = test mode: bounce ONLY between the checked ones.
  testEras: boolean[];
}

export const DEFAULT_SETTINGS: Settings = {
  camHeight: 3.5,
  camDistance: 7,
  camTilt: 1.4,
  camFov: 64,
  speedMult: 1,
  densityMult: 1,
  testEras: [true, true, true, true, true],
};

// Difficulty presets (set the two multipliers). The keys are lookup ids (data-preset in index.html), not labels.
export const DIFFICULTY_PRESETS: Record<string, { speedMult: number; densityMult: number }> = {
  Relaxat: { speedMult: 0.85, densityMult: 0.8 },
  Normal: { speedMult: 1, densityMult: 1 },
  Rapid: { speedMult: 1.2, densityMult: 1.15 },
  Extrem: { speedMult: 1.45, densityMult: 1.4 },
};

const KEY = 'chronodrift:settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      // guarantees a valid array of 5 booleans (old versions / corrupted data)
      if (!Array.isArray(s.testEras) || s.testEras.length !== 5) s.testEras = [true, true, true, true, true];
      else s.testEras = s.testEras.map((v: unknown) => !!v);
      return s;
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
