import './style.css';
import { Game } from './game/Game';
import { loadSettings, saveSettings, DIFFICULTY_PRESETS } from './game/settings';

// Bump the number on every change → on the phone you can confirm the new code has loaded.
const BUILD = 70;
const verEl = document.getElementById('ver');
if (verEl) verEl.textContent = `build ${BUILD}`;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const scoreEl = document.getElementById('score') as HTMLElement;
const bestEl = document.getElementById('best') as HTMLElement;
const sessionEl = document.getElementById('session') as HTMLElement;
const coinsEl = document.getElementById('coins') as HTMLElement;
const pickupEl = document.getElementById('pickup') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const msg = document.getElementById('msg') as HTMLElement;
const startBtn = document.getElementById('startBtn') as HTMLElement;

const BEST_KEY = 'chronodrift:best';
let best = Number(localStorage.getItem(BEST_KEY) ?? 0);
bestEl.textContent = `Best: ${best}`;

// Session total = the sum of runs; persists in memory while in the game, resets on reload.
const fmt = (n: number) => Math.floor(n).toLocaleString('ro-RO');
let sessionBanked = 0;
sessionEl.textContent = `Session: ${fmt(sessionBanked)}`;

// Cores = persistent currency (for future skins).
const COINS_KEY = 'chronodrift:coins';
let coins = Number(localStorage.getItem(COINS_KEY) ?? 0);
coinsEl.textContent = `◈ ${fmt(coins)}`;

const game = new Game(canvas);

game.onScore = (s) => {
  scoreEl.textContent = String(s);
  sessionEl.textContent = `Session: ${fmt(sessionBanked + s)}`;
};

let pickupTimer = 0;
game.onCore = (value, mult) => {
  coins += 1;
  localStorage.setItem(COINS_KEY, String(coins));
  coinsEl.textContent = `◈ ${fmt(coins)}`;
  pickupEl.textContent = mult > 1 ? `+${value}  ×${mult}` : `+${value}`;
  pickupEl.classList.remove('show');
  void pickupEl.offsetWidth; // restarts the animation
  pickupEl.classList.add('show');
  clearTimeout(pickupTimer);
  pickupTimer = window.setTimeout(() => pickupEl.classList.remove('show'), 650);
};

const eraEl = document.getElementById('era') as HTMLElement;
let eraTimer = 0;
game.onEra = (name) => {
  eraEl.textContent = name;
  eraEl.classList.add('show');
  clearTimeout(eraTimer);
  eraTimer = window.setTimeout(() => eraEl.classList.remove('show'), 1800);
};

game.onGameOver = (s) => {
  const record = s > best;
  if (record) {
    best = s;
    localStorage.setItem(BEST_KEY, String(best));
    bestEl.textContent = `Best: ${best}`;
  }
  sessionBanked += s;
  sessionEl.textContent = `Session: ${fmt(sessionBanked)}`;
  msg.textContent = `Game Over\nScore: ${s}${record ? '\n🏆 New best!' : ''}`;
  startBtn.textContent = 'AGAIN';
  overlay.classList.add('show');
};

function startGame() {
  overlay.classList.remove('show');
  scoreEl.textContent = '0';
  game.start();
}

startBtn.addEventListener('click', startGame);

// --- Settings (live camera + difficulty) ---
const settings = loadSettings();
game.applySettings(settings);

const settingsEl = document.getElementById('settings') as HTMLElement;
document.getElementById('settingsBtn')!.addEventListener('click', () => settingsEl.classList.add('show'));
document.getElementById('settingsClose')!.addEventListener('click', () => settingsEl.classList.remove('show'));

// Sliders → settings (camera applies live; difficulty is used on the next run)
// Only the numeric keys (testEras is boolean[], handled separately via checkboxes).
type NumKey = 'camHeight' | 'camDistance' | 'camTilt' | 'camFov' | 'speedMult' | 'densityMult';
const SLIDERS: { id: NumKey; digits: number }[] = [
  { id: 'camHeight', digits: 1 },
  { id: 'camDistance', digits: 1 },
  { id: 'camTilt', digits: 2 },
  { id: 'camFov', digits: 0 },
  { id: 'speedMult', digits: 2 },
  { id: 'densityMult', digits: 2 },
];
for (const sl of SLIDERS) {
  const input = document.getElementById(sl.id) as HTMLInputElement;
  const val = document.getElementById(`${sl.id}Val`) as HTMLElement;
  input.value = String(settings[sl.id]);
  val.textContent = settings[sl.id].toFixed(sl.digits);
  input.addEventListener('input', () => {
    settings[sl.id] = Number(input.value);
    val.textContent = settings[sl.id].toFixed(sl.digits);
    game.applySettings(settings);
    saveSettings(settings);
    markActivePreset();
  });
}

// Difficulty presets → set the two sliders
function markActivePreset() {
  document.querySelectorAll<HTMLElement>('.presets button').forEach((b) => {
    const p = DIFFICULTY_PRESETS[b.dataset.preset!];
    const on = p && p.speedMult === settings.speedMult && p.densityMult === settings.densityMult;
    b.classList.toggle('active', !!on);
  });
}
document.querySelectorAll<HTMLElement>('.presets button').forEach((b) => {
  b.addEventListener('click', () => {
    const p = DIFFICULTY_PRESETS[b.dataset.preset!];
    settings.speedMult = p.speedMult;
    settings.densityMult = p.densityMult;
    (document.getElementById('speedMult') as HTMLInputElement).value = String(p.speedMult);
    (document.getElementById('densityMult') as HTMLInputElement).value = String(p.densityMult);
    document.getElementById('speedMultVal')!.textContent = p.speedMult.toFixed(2);
    document.getElementById('densityMultVal')!.textContent = p.densityMult.toFixed(2);
    game.applySettings(settings);
    saveSettings(settings);
    markActivePreset();
  });
});
markActivePreset();

// Eras (TEST) — checkboxes: only the checked eras appear in a run (bouncing between them).
document.querySelectorAll<HTMLInputElement>('.eraChk').forEach((chk) => {
  const i = Number(chk.dataset.era);
  chk.checked = settings.testEras[i] !== false;
  chk.addEventListener('change', () => {
    settings.testEras[i] = chk.checked;
    game.applySettings(settings);
    saveSettings(settings);
  });
});
