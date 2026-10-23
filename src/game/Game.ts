import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  BLOCK_H,
  BASE_SPEED,
  CORE_SCORE,
  LIFE_STEP,
  MAX_LIVES,
  RESPAWN_TIME,
  DESPAWN_Z,
  GRAVITY,
  JUMP_V,
  LANE_LERP,
  LANE_X,
  OVERHEAD_Y,
  PLAYER_D,
  PLAYER_H,
  PLAYER_H_SLIDE,
  PLAYER_W,
  PLAYER_Z,
  SEGMENT_COUNT,
  SEGMENT_LEN,
  SLIDE_TIME,
  SPAWN_Z,
  TRACK_HALF_W,
  WALL_H,
} from './constants';
import { clamp, damp, lerp, rangesOverlap } from './math';
import { mulberry32, randInt, weighted } from './rng';
import { ERAS, RIFT_COLOR, type EraPalette } from './eras';
import { DIFFICULTY, sampleDifficulty } from './difficulty';
import type { ObType, SimpleType } from './types';
import { CharacterController, type CharState } from './character';
import CLIP_WINDOWS from './neon-outlaw.clips.json';
import { makeFacadeTextures, makeFacade, makeBillboardTextures, SkyTraffic, SkyVehicles, AD_ASPECT, type AdFormat, type FacadeSet } from './cyber';
import { Rain } from './rain';
import { Portal } from './portal';
import { buildBlock, buildOverhead, buildWall, buildTrain, type ObstacleMats, type TrainMats } from './obstacles';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeCityEnvMap, makeStarMaterial, makeAsphaltTexture } from './cyber';
import { buildToken, animateToken, TOKEN_BY_ERA, type TokenMats } from './tokens';
import { SpaceSky, CosmicDust, buildVoidRoad, makeNebulaTexture, makeRockMaterial, makeCrackMaterial, ROCK_BRIGHT, type VoidRoadMats } from './space';
import { buildVoidBlock, buildVoidOverhead, buildVoidWall, makeVoidObstacleMats, animateVoidObstacles, animateVoidObstacle, SUN_CHUNK_LOOK, type VoidObstacleMats } from './voidObstacles';
import { buildRockTrain, makeVeinMaterial, type RockTrainMats } from './voidTrain';
import { buildWreckTrain, makeWreckMats, type WreckMats } from './voidWreck';
import { buildRuin, type RuinMats } from './ruins';
import { makeFacade as makeFacadeTex } from './cyber';
import { buildSocle, buildUpper, disposeLook, buildRoadRelief, makeInteriorTexture, INTERIOR_KINDS, SOCLE_H, type CityMats, type BuildingLook, type BuildingSpec } from './city';
import type { Settings } from './settings';

const CAM_LOOK_Z = -22; // fixed look-ahead distance the camera points at

// Airtime of one jump (s) → the base for spacing "in jump units".
const JUMP_AIRTIME = (2 * JUMP_V) / -GRAVITY;

// Eras: Neo-Cyberpunk is "home"; every ROLL_INTERVAL points a die is rolled that
// may open a portal to a special era (excursion) for EXCURSION_MIN..MAX seconds.
const ROLL_INTERVAL = 1000; // points between die rolls (while at home)
const BUILDING_GAP = 6; // distance between buildings (Cyberpunk) — dense metropolis
const BUILD_SPAWN_Z = -165; // buildings appear at the horizon and grow
const GUARD_SPAN = 36; // lateral width of the guard buildings (fills the billboard↔fillers gap)
const SCENERY_SPAWN_Z = -150; // per-era side scenery (non-Cyberpunk) appears from afar
const EXCURSION_MIN = 30; // minimum excursion duration (s)
const EXCURSION_MAX = 90; // maximum excursion duration (s)
const MORPH_DUR = 0.5; // short palette morph when passing through the portal
const SHAKE_DUR = 1.0; // the crossing shakes the whole world (camera) for this long
const PORTAL_Y = 2.2; // height of the portal ring's centre

// Trains (Increment B)
const TRAIN_W = 1.9; // width within a lane
const TRAIN_H = 2.8; // BOTH types — same height; the roof is traversable on both
const ROOF_TOL = 0.35; // "on the roof" tolerance (support + crash immunity)
// Solidity: the logical boxes are tested a little larger than the visuals and over the distance moved in the frame
const HIT_PAD_Z = 0.12, HIT_PAD_X = 0.05;
const FEET_MARGIN = 0.2; // a jump clears a block only with this much air under the feet (the animation's feet hang below py)
const BLOCK_TOP_TOL = 0.12; // landing on a block from this close above its top → stand on it instead of sinking
const ROAD_CLEAR = TRACK_HALF_W + 0.6; // side scenery keeps its low parts at least this far from the centre
const AIR_MARGIN = 0.4; // above this height the player counts as "jumping" → the trampoline catches them
const RAMP_LEN = 3.6; // length of the ramp nose in front of a climbable train (slope towards the player)
const COYOTE_TIME = 0.18; // grace: you can still jump briefly after leaving the support
const DEATH_DELAY = 1.3; // delay before the overlay, so the death animation is visible
const DEATH_BACK = 1.0; // on death the visual character is eased back (towards the camera) so the fall does not sink into the obstacle
const COMBO_WINDOW = 3; // seconds without a core → the combo resets
const MAX_MULT = 5; // maximum combo multiplier

// HORIZONTAL curvature as a SEQUENCE OF ARCS: straight stretches (R=∞) + arcs (random radius R, direction D=±).
const R_MIN = 900; // minimum radius (tighter curve)
const R_MAX = 2500; // maximum radius (gentle curve)
const ARC_LEN_MIN = 110; // length of one arc (road units)
const ARC_LEN_MAX = 220;
const STR_LEN_MIN = 70; // length of one straight stretch
const STR_LEN_MAX = 160;
const ROAD_EASE = 0.04; // smooth curvature transition between segments (like a clothoid)
const SKY_YAW_GAIN = 1; // the sky rotates with the accumulated heading (radians); 1 = exact

// VERTICAL curvature (up/down profile) as a circular arc. uCurve.y = κ_v/2 (negative = crest).
const CURVE_V_BASE = -0.00008; // base crest
const CURVE_V_AMP = 0.00004; // undulation
const CURVE_V_FREQ = 0.045; // ~ one hill every ~140 units
const TRAIN_UNLOCK = 120; // score from which trains appear (low for testing)
const TRAIN_BLOCK_COLOR = 0xff2a4a;
const TRAIN_RIDE_COLOR = 0x18ffc2;

interface Ob {
  mesh: THREE.Mesh;
  type: ObType;
  lane: number;
  active: boolean;
  len: number; // length along Z (trains); 0 for simple obstacles
  trampoline: boolean; // trampoline front (teal: mountable from the ground); red = false
  roofY: number; // roof height (trains); 0 for simple obstacles
  ramp?: THREE.Mesh; // ramp nose (climbable only) — marked by ORIENTATION, not just colour
  decor?: THREE.Group; // sci-fi intrusion decor (Prehistoric/Ancient) — vegetation/debris on the train
  look?: THREE.Group; // Neo-Cyberpunk look (procedural, obstacles.ts); the plain box stays the collision proxy
  lookVoid?: THREE.Group; // Unknown Future look (voidObstacles.ts), built on the first spawn in that era
  looks?: Map<number, THREE.Group>; // tokens: one look per era (tokens.ts), built on first use
}

/** Unit triangular wedge: a ramp rising from the ground (tip towards the player) up to the roof.
 * Local x∈[-0.5,0.5], y∈[0,1], z∈[0,1]; z=0 is flush with the train's front face, z=1 = the tip on the ground. */
function makeRampGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // 6 vertices (triangular prism): L=left(x=-0.5), R=right(x=0.5)
  const v = new Float32Array([
    -0.5, 0, 0,  -0.5, 1, 0,  -0.5, 0, 1, // L0,L1,L2
     0.5, 0, 0,   0.5, 1, 0,   0.5, 0, 1, // R0,R1,R2
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setIndex([
    0, 2, 1,        // left face (triangle)
    3, 4, 5,        // right face
    1, 4, 5, 1, 5, 2, // the slope (from roof z=0,y=1 → tip z=1,y=0)
    0, 1, 4, 0, 4, 3, // vertical back (flush with the train, z=0)
    0, 3, 5, 0, 5, 2, // the base (ground)
  ]);
  g.computeVertexNormals();
  return g;
}

export let BUILD_TAG = '?';
export function setBuildTag(t: string) { BUILD_TAG = t; }

/** One pooled city building: relief look rebuilt at placement; facade materials owned here (curvature applied once). */
/** A queued placement, advanced one stage per frame so no frame carries a whole building. */
interface PendingBuilding { b: CityBuilding; x: number; z: number; w: number; topH: number; d: number; ad: boolean; dist: number; stage: number; spec?: BuildingSpec; group?: THREE.Group }
interface CityBuilding { g: THREE.Group; bm: THREE.MeshStandardMaterial; tm: THREE.MeshStandardMaterial; neonMat: THREE.MeshBasicMaterial; look?: BuildingLook; panel: THREE.Mesh; roof: THREE.Group; active: boolean }

const SPEC: Record<SimpleType, { w: number; h: number; d: number; y: number; color: number }> = {
  block: { w: 1.7, h: BLOCK_H, d: 1.2, y: BLOCK_H / 2, color: 0xff5a1e },
  overhead: { w: 2.0, h: 0.7, d: 1.0, y: OVERHEAD_Y + 0.35, color: 0xff36c8 },
  wall: { w: 1.8, h: WALL_H, d: 1.0, y: WALL_H / 2, color: 0xff2040 },
  core: { w: 0.9, h: 0.9, d: 0.9, y: 1.0, color: 0x7ef9ff },
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private player: THREE.Mesh;
  private character?: CharacterController;
  private airborneKind?: CharState; // jump clip chosen at take-off, kept until landing
  private grounds: THREE.Group[] = [];
  private pools: Record<SimpleType, Ob[]> = { block: [], overhead: [], wall: [], core: [] };
  private geo: Record<SimpleType, THREE.BufferGeometry>;
  private mat: Record<SimpleType, THREE.MeshStandardMaterial>;

  // Trains (separate pool — variable-length geometry)
  private trains: Ob[] = [];
  private hiddenMat!: THREE.MeshBasicMaterial;
  private trainLook!: { ride: TrainMats; block: TrainMats };
  private trainCache = new Map<number, THREE.Group>(); // train looks per integer length (built once; spawns clone them)
  // Unknown Future trains: boulder convoys (voidTrain.ts) and, 1 in 10, maglev wrecks (voidWreck.ts); same caching
  private convoyCache = new Map<number, THREE.Group>();
  private wreckCache = new Map<number, THREE.Group>();
  private convoyMats!: RockTrainMats;
  private wreckMats!: WreckMats;
  private static readonly WRECK_SHARE = 0.1;
  private pendingBuildings: PendingBuilding[] = []; // placements in progress: one stage per frame (textures → socle+frontage → upper+reveal)
  private lookBase!: Omit<TrainMats, 'neon'>; // shared smooth materials (hull, panels, glass, lights)
  private tokenMats!: TokenMats; // pickup tokens: dark metal, glass, neon in the era's core colour // Neo-Cyberpunk train materials per type (neon colour differs)
  private composer!: EffectComposer; // render + bloom (the neon glow) + output
  private lookAccent!: { block: THREE.MeshStandardMaterial; overhead: THREE.MeshStandardMaterial; wall: THREE.MeshStandardMaterial; ride: THREE.MeshStandardMaterial; blockT: THREE.MeshStandardMaterial };
  private trainGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);
  private rampGeo = makeRampGeometry();
  private trainBlockMat!: THREE.MeshStandardMaterial;
  private trainRideMat!: THREE.MeshStandardMaterial;
  // Sci-fi intrusion decor on trains (per era): vegetation (Prehistoric) / sci-fi debris (Ancient).
  private trainVegMat!: THREE.MeshStandardMaterial;
  private trainSfMat!: THREE.MeshStandardMaterial;
  private supportY = 0; // height of the current support (ground=0 or a train roof)
  private coyoteT = 0; // grace window for jumping after leaving the support
  private deathT = 0; // death animation countdown before the overlay
  // Lives
  private lives = 1;
  private lifeBase = 0; // score at the last change of the lives count
  private lastLifeProgress = -1;
  private respawnT = 0; // > 0: world frozen after losing a life, waiting for the player (max RESPAWN_TIME)
  private frozen = false; // world stopped until the player acts (jump / lane change) or the respawn time runs out
  private invuln = false; // from the crash until the world runs again AND nothing overlaps the player any more
  private resumeGrace = 0; // short grace after the world resumes, so a lane change started from the stop can complete
  private shakeT = 0; // portal crossing: camera shake countdown
  private overlapNow = false;
  private deathFloor = 0; // where the body comes to rest after death (ground or the roof it was on)
  private deathBack = 0; // current backward offset of the visual character while dying
  private worldDist = 0; // total distance travelled (drives the curvature)
  private curveUniform = { value: new THREE.Vector2(0, 0) }; // shared curvature uniform
  private seg!: { type: 'straight' | 'arc'; end: number; R: number; D: number }; // current road segment
  private curK = 0; // current curvature (smooth, with transitions between segments)
  private heading = 0; // accumulated heading (radians) → sky rotation
  private lastFreeLane = 1; // free-lane continuity between rows

  // Material/light references for recolouring per era
  private hemi!: THREE.HemisphereLight;
  private pMat!: THREE.MeshStandardMaterial;
  private groundMat!: THREE.MeshStandardMaterial;
  private railLMat!: THREE.MeshStandardMaterial;
  private railRMat!: THREE.MeshStandardMaterial;
  private railGlowL!: THREE.MeshBasicMaterial; // soft additive halo on the road beside each rail (follows the rail colour)
  private railGlowR!: THREE.MeshBasicMaterial;
  private lineMat!: THREE.MeshStandardMaterial;
  private fog!: THREE.Fog;
  private skyUniforms!: { uTop: { value: THREE.Color }; uHorizon: { value: THREE.Color }; uNebula: { value: number }; uNebTex: { value: THREE.Texture } };
  private starMat!: THREE.ShaderMaterial; // round stars with a bright core and a real per-star twinkle (see makeStarMaterial)
  private skyGroup!: THREE.Group; // sky + stars (turns with the curve)
  private space!: SpaceSky; // Unknown Future bodies (built once, composed at every entry)
  private dust!: CosmicDust; // cosmic dust drifting past the player (Unknown Future)
  private voidMats!: VoidRoadMats;
  private voidObMats!: VoidObstacleMats; // Unknown Future obstacle materials (rock, the two crust shaders, the impact decal)
  private roadReliefs: THREE.Group[] = []; // city curbs/posts per track segment (hidden in Unknown Future)
  private voidRoads: THREE.Group[] = []; // floating tubes per segment (Unknown Future only)

  // Ambient: pterodactyl (silhouette) + temporary rain
  private pteroGroup!: THREE.Group;
  private pteroLWing!: THREE.Mesh;
  private pteroRWing!: THREE.Mesh;
  private pteroActive = false;
  private pteroProg = 0;
  private pteroStartX = 0;
  private pteroDelay = 3;
  private rain!: Rain;
  private rainLevel = 0;
  private rainOn = false;
  private rainTimer = 5;
  // Per-era backdrop: megafauna / Olympus / airships
  private megaGroup!: THREE.Group;
  private olympusGroup!: THREE.Group;
  private airshipGroup!: THREE.Group;
  private cyberBackdrop!: THREE.Group; // neon skyline at the horizon (Cyberpunk)
  private airships: THREE.Object3D[] = [];
  private dinoNecks: THREE.Object3D[] = []; // dinosaur heads (Prehistoric) that bend down
  // The Cyberpunk city: buildings + billboards on facades
  private adMats: THREE.MeshBasicMaterial[] = []; // legacy list (kept for the curvature pass); panels own their material
  private adSets: Record<AdFormat, THREE.CanvasTexture>[] = []; // 10 brands x 3 formats
  private moonTimer = 12; // seconds until the sky billboard picks another ad
  private moonFade = 0; // 0 = idle; >0 = fading out, <0 = fading in
  private moonBrand = 1;
  private facades: FacadeSet[] = []; // procedural facade textures (Cyberpunk)
  private skyTraffic?: SkyTraffic;
  private skyVehicles?: SkyVehicles;
  private holoMoon?: THREE.Mesh;
  private extraCurveMats: THREE.Material[] = []; // materials created by the procedural art that need the curvature
  private roofPropMat = new THREE.MeshStandardMaterial({ color: 0x0b0f1c, emissive: 0x101a30, emissiveIntensity: 0.6, roughness: 0.8, flatShading: true });
  private roofLightMat = new THREE.MeshBasicMaterial({ color: 0xff3050, toneMapped: false });

  private buildGeo = new THREE.BoxGeometry(1, 1, 1); // unit box (skyline backdrop)
  private buildings: CityBuilding[] = [];
  private cityMats!: CityMats; // shared street-relief materials (socles, frontages, curbs)
  private buildAccum = 0;
  private buildSide = -1;
  private buildMats: THREE.MeshStandardMaterial[] = [];
  private buildLineMats: THREE.LineBasicMaterial[] = [];
  private adCountdown = [7, 9]; // how many fillers until the next billboard block (per side)
  // Reserved billboard↔guards corridor: no filler closer to the road than reserveOuterX,
  // while the billboard block is still in the scene (worldDist < reserveUntil). Per side [left, right].
  private reserveOuterX = [0, 0];
  private reserveUntil = [0, 0];

  // Per-era side scenery (non-Cyberpunk): composable pool (5 reusable pieces per slot).
  private scenery: { g: THREE.Group; box: THREE.Mesh; post: THREE.Mesh; blobA: THREE.Mesh; blobB: THREE.Mesh; panel: THREE.Mesh; active: boolean }[] = [];
  private sceneryAccum = 0;
  private scenerySide = -1;
  private sceneryMats: THREE.Material[] = []; // all scenery materials (for the curvature shader)
  private scnBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  private scnPostGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  private scnBlobGeo = new THREE.IcosahedronGeometry(1, 0);
  private scnPanelGeo = new THREE.BoxGeometry(1, 1, 0.12);
  // Prehistoric materials (jungle): trunk, two foliage greens, stone.
  private scnTrunkMat!: THREE.MeshStandardMaterial;
  private scnLeafA!: THREE.MeshStandardMaterial;
  private scnLeafB!: THREE.MeshStandardMaterial;
  private scnRockMat!: THREE.MeshStandardMaterial;
  // Ancient materials: marble (ivory) + gold.
  private scnMarbleMat!: THREE.MeshStandardMaterial;
  private scnGoldMat!: THREE.MeshStandardMaterial;
  // Solarpunk materials: eco green glass + solar panel.
  private scnEcoMat!: THREE.MeshStandardMaterial;
  private scnSolarMat!: THREE.MeshStandardMaterial;
  // Unknown Future materials: dark monolith + neon accent.
  // Unknown Future ruins: dead Neo-Cyberpunk blocks broken in two (ruins.ts), 4 variants built once at start, cloned per spawn.
  // A spawn shows the lower piece, the upper piece or both (a rigid tandem: the pieces keep their offsets and never cross).
  private ruinLooks: { pieces: THREE.Group[]; home: THREE.Vector3[]; dir: THREE.Vector3[]; pr: number[]; radius: number }[] = [];
  private ruins: { g: THREE.Group; axis: THREE.Vector3; w: number; active: boolean }[] = [];
  // Wide side ground (per era) the scenery stands on — otherwise buildings look like they float.
  private terrainMat!: THREE.MeshStandardMaterial;
  private terrains: THREE.Mesh[] = [];
  private floorMat!: THREE.MeshStandardMaterial; // Neo-Cyberpunk plaza floor beside the road
  private cityEnv!: THREE.Texture; // PMREM neon-city reflections (hulls, road, facades)
  private floors: THREE.Mesh[] = [];

  // Eras & portal transition
  private era = 0; // current era (0 = Neo-Cyberpunk, "home")
  private trans: { from: number; to: number; t: number } | null = null; // palette morph
  private homeRollScore = ROLL_INTERVAL; // next die-roll threshold (while at home)
  private excursionT = 0; // time left in a special era
  private pendingEra = -1; // era the portal is open towards (-1 = none)
  private testEras = [true, true, true, true, true]; // TEST: allowed eras (see settings.testEras)
  private sfBudget = 0; // how many sci-fi intrusions (decorated trains) may still appear in the current excursion
  private portal!: { mesh: THREE.Object3D; fx: Portal; active: boolean; crossed: boolean };
  // scratch colors (avoids per-frame allocations)
  private cA = new THREE.Color();
  private cB = new THREE.Color();
  private cRift = new THREE.Color(RIFT_COLOR);
  onEra?: (name: string) => void;

  private state: 'idle' | 'playing' | 'over' = 'idle';
  private rng: () => number = mulberry32(1);
  private speed = DIFFICULTY.stops[0].speed;
  private burstT = 0;
  private nextBurstScore = DIFFICULTY.bursts[0]?.fromScore ?? Infinity;
  private elapsed = 0;
  private score = 0;
  private shownScore = -1;
  private lastTs = 0;
  private raf = 0;

  private targetLane = 1;
  private px = 0;
  private py = 0;
  private vy = 0;
  private slideT = 0;
  private spawnAccum = 0;
  private nextGap = 10;
  private camX = 0;
  private camLift = 0; // current camera lift (smooth)
  private camTargetLift = 0; // target level: keeps the roof height while airborne, lowers only on the ground

  private touch: { x: number; y: number } | null = null;
  private lastLaneSwipe = 0;

  private coreCombo = 0; // cores collected in a row
  private comboTimer = 0; // time since the last core (resets the combo)

  // Adjustable settings (live camera + difficulty multipliers)
  private camBaseY = 3.5;
  private camBaseZ = 8.5;
  private camLookY = 1.4;
  private speedMult = 1;
  private densityMult = 1;

  onScore?: (s: number) => void;
  onGameOver?: (s: number) => void;
  onCore?: (value: number, mult: number, sx: number, sy: number, speedK: number) => void; // bonus + multiplier on pickup, token screen position (px), speed factor (1 = base speed)
  onLives?: (lives: number, progress: number) => void; // lives count + progress (0..1) towards the next one
  onLifeGained?: (lives: number) => void;
  onLifeLost?: (lives: number) => void;
  onPerf?: (text: string) => void; // TEST: frame-time overlay (build 110)
  // --- TEST instrumentation: per-frame marks (what heavy work ran) + spike log ---
  private tmpV = new THREE.Vector3();
  private perf = { marks: [] as string[], lastProg: 0, spikes: [] as string[], frames: 0, sumDt: 0, maxDt: 0, over33: 0, flushAt: 0, cpuMax: 0, log: [] as string[], sumAt: 0, sFrames: 0, sSum: 0, sMax: 0, sOver: 0 };
  /** TEST: the whole perf log of this session (spikes + 5 s summaries). */
  getPerfLog(): string { return `build ${BUILD_TAG} dpr ${window.devicePixelRatio} ratio ${this.renderer.getPixelRatio()} ${window.innerWidth}x${window.innerHeight} ua ${navigator.userAgent}\n` + this.perf.log.join('\n'); }
  private mark(s: string) { this.perf.marks.push(s); }
  private timed<T>(name: string, fn: () => T): T { const t0 = performance.now(); const r = fn(); const ms = performance.now() - t0; if (ms >= 0.5) this.mark(`${name} ${ms.toFixed(1)}ms`); return r; }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 1.5: dense phone screens stay crisp with 44% fewer pixels than 2.0

    this.scene.background = new THREE.Color(0x05010f);
    this.fog = new THREE.Fog(0x0a0420, 30, 250);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(64, 1, 0.1, 360);
    this.camera.position.set(0, this.camBaseY, this.camBaseZ);
    this.camera.lookAt(0, this.camLookY, CAM_LOOK_Z);

    // Post: bloom makes the emissive neon (HDR colours > 1) glow; the rest of the scene stays under the threshold.
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 }));
    this.cityEnv = makeCityEnvMap(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.3, 0.9);
    const bloomSetSize = bloom.setSize.bind(bloom);
    bloom.setSize = (w: number, h: number) => bloomSetSize(w / 2, h / 2); // bloom mips at half resolution (the glow is soft anyway)
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    this.hemi = new THREE.HemisphereLight(0x6688ff, 0x140022, 1.0);
    this.scene.add(this.hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8); // key light
    dir.position.set(3, 8, 4);
    this.scene.add(dir);
    const rim = new THREE.DirectionalLight(0x00eaff, 0.5); // rim light from behind the obstacles (outlines the hulls)
    rim.position.set(-6, 5, -8);
    this.scene.add(rim);
    this.buildSky();
    this.buildAmbient();
    this.buildBackdrops();
    this.buildCyberBackdrop();

    // Player
    this.pMat = new THREE.MeshStandardMaterial({ color: 0x031018, emissive: 0x00eaff, emissiveIntensity: 0.7, roughness: 0.5 });
    this.player = new THREE.Mesh(new THREE.BoxGeometry(PLAYER_W, PLAYER_H, PLAYER_D), this.pMat);
    this.scene.add(this.player);

    // Animated character: the Neon Outlaw (generated model, neon lines built on the bones).
    // The box stays as a fallback until the model loads. Three jump clips: plain jump, mounting a
    // train (tuck), clearing an obstacle (run-and-jump); the one to play is chosen at take-off.
    this.character = new CharacterController(
      '/models/neon-outlaw.glb',
      { run: 'RunFast', idle: 'Idle', jump: 'Regular_Jump', jumpTrain: 'Tuck_Jump', jumpObstacle: 'Run_and_Jump', slide: 'slide_light', dead: 'dying_backwards' },
      CLIP_WINDOWS,
      PLAYER_H,
      () => {
        this.player.visible = false;
      },
    );
    this.scene.add(this.character.group);

    // Obstacle geometries/materials (shared)
    this.geo = {
      block: new RoundedBoxGeometry(SPEC.block.w, SPEC.block.h, SPEC.block.d, 2, 0.1),
      overhead: new RoundedBoxGeometry(SPEC.overhead.w, SPEC.overhead.h, SPEC.overhead.d, 2, 0.1),
      wall: new RoundedBoxGeometry(SPEC.wall.w, SPEC.wall.h, SPEC.wall.d, 2, 0.1),
      core: new THREE.IcosahedronGeometry(0.55, 0),
    };
    this.mat = {
      block: this.emissiveMat(SPEC.block.color, 0.55, true),
      overhead: this.emissiveMat(SPEC.overhead.color, 0.6, true),
      wall: this.emissiveMat(SPEC.wall.color, 0.5, true),
      core: this.emissiveMat(SPEC.core.color, 1.1, true),
    };
    // Neo-Cyberpunk looks: dark bodies with lit accents in the type's colour (the accents follow the era palette)
    this.hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
    this.lookAccent = {
      block: this.emissiveMat(SPEC.block.color, 1.6, true),
      overhead: this.emissiveMat(SPEC.overhead.color, 1.6, true),
      wall: this.emissiveMat(SPEC.wall.color, 1.5, true),
      ride: this.emissiveMat(TRAIN_RIDE_COLOR, 1.5, true),
      blockT: this.emissiveMat(TRAIN_BLOCK_COLOR, 1.4, true),
    };
    this.extraCurveMats.push(...Object.values(this.lookAccent));
    // Maglev train materials: smooth-shaded hull with city reflections; neon rails in the type's colour; HDR lights for the bloom.
    const env = this.cityEnv;
    const trainBase = {
      body: new THREE.MeshStandardMaterial({ color: 0x1b1f33, roughness: 0.42, metalness: 0.25, envMap: env, envMapIntensity: 1.0 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0a0b14, roughness: 0.6, metalness: 0.3 }),
      pad: new THREE.MeshStandardMaterial({ color: 0x15172a, roughness: 0.55, metalness: 0.4 }),
      accent: new THREE.MeshStandardMaterial({ color: 0xd9dde9, roughness: 0.5, metalness: 0.1, envMap: env, envMapIntensity: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x0b1a2c, roughness: 0.08, metalness: 0.9, envMap: env, envMapIntensity: 1.6, emissive: 0x062033, emissiveIntensity: 0.5 }),
      shield: new THREE.MeshStandardMaterial({ color: 0x1a3550, roughness: 0.06, metalness: 0.85, envMap: env, envMapIntensity: 1.8, emissive: 0x0c2a44, emissiveIntensity: 0.7 }),
      red: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 0, 0), toneMapped: false }),
      white: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.7), toneMapped: false }),
    };
    const neonOf = (c: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.5), toneMapped: false });
    this.lookBase = trainBase;
    this.trainLook = { ride: { ...trainBase, neon: neonOf(TRAIN_RIDE_COLOR) }, block: { ...trainBase, neon: neonOf(TRAIN_BLOCK_COLOR) } };
    this.extraCurveMats.push(...Object.values(trainBase), this.trainLook.ride.neon, this.trainLook.block.neon);
    this.tokenMats = {
      dark: new THREE.MeshStandardMaterial({ color: 0x0f1220, roughness: 0.45, metalness: 0.5, envMap: env, envMapIntensity: 0.8 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fdcff, roughness: 0.1, metalness: 0.3, envMap: env, envMapIntensity: 1.4, transparent: true, opacity: 0.45, depthWrite: false }),
      neon: new THREE.MeshBasicMaterial({ color: new THREE.Color(SPEC.core.color).multiplyScalar(1.6), toneMapped: false }),
    };
    this.extraCurveMats.push(this.tokenMats.dark, this.tokenMats.glass, this.tokenMats.neon);
    // street relief materials (shared by all buildings and the road)
    const interiors = {} as CityMats['interiors'];
    for (const k of INTERIOR_KINDS) interiors[k] = [0, 1].map(() => new THREE.MeshBasicMaterial({ map: makeInteriorTexture(k, Math.random), toneMapped: false }));
    this.cityMats = {
      concrete: new THREE.MeshStandardMaterial({ color: 0x3a3f5c, roughness: 0.7, metalness: 0.1, envMap: env, envMapIntensity: 0.25 }),
      dark: trainBase.dark, white: trainBase.white, red: trainBase.red, glassDark: trainBase.glass,
      warm: this.emissiveMat(0xffd9a0, 0.8),
      glassSheen: new THREE.MeshStandardMaterial({ color: 0x9fdcff, roughness: 0.05, metalness: 0.6, envMap: env, envMapIntensity: 1.2, transparent: true, opacity: 0.22, depthWrite: false }),
      hazardY: new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.6 }),
      hazardK: new THREE.MeshStandardMaterial({ color: 0x15161e, roughness: 0.6 }),
      interiors,
    };
    this.extraCurveMats.push(this.cityMats.concrete, this.cityMats.warm, this.cityMats.glassSheen, this.cityMats.hazardY, this.cityMats.hazardK, ...Object.values(interiors).flat());
    // Unknown Future road: emitters holding the floating tubes
    this.voidMats = { railL: null as unknown as THREE.Material, railR: null as unknown as THREE.Material, emitter: new THREE.MeshStandardMaterial({ color: 0x23234a, roughness: 0.5, metalness: 0.5, emissive: 0x8ad8ff, emissiveIntensity: 0.4 }) };
    this.extraCurveMats.push(this.voidMats.emitter);
    // brightness tuned by the owner (2026-10-23): jump boulders 9.0 (visible from afar); convoys: boulder face 4.0 (rock + veins), the sun chunk at the tail dimmed to 0.6/1.52
    this.voidObMats = makeVoidObstacleMats(makeRockMaterial(Math.random, true, 9), Math.random);
    this.extraCurveMats.push(this.voidObMats.rock, this.voidObMats.crack);
    const faceK = 4 / ROCK_BRIGHT, sunK = 0.6 / ROCK_BRIGHT; // the convoy's own materials
    this.convoyMats = { rock: makeRockMaterial(Math.random, true, 4), veins: makeVeinMaterial(), sun: makeCrackMaterial({ ...SUN_CHUNK_LOOK, bright: SUN_CHUNK_LOOK.bright * sunK }) };
    (this.convoyMats.veins as THREE.ShaderMaterial).uniforms.uCrack.value *= faceK;
    for (const m of [this.convoyMats.veins, this.convoyMats.sun] as THREE.ShaderMaterial[]) m.uniforms.uCurve = this.curveUniform;
    this.extraCurveMats.push(this.convoyMats.rock);
    this.wreckMats = makeWreckMats();
    for (const m of [this.wreckMats.rust, this.wreckMats.rustDark, this.wreckMats.brokenGlass]) m.uniforms.uCurve = this.curveUniform;
    this.extraCurveMats.push(this.wreckMats.white); // the only standard material of the wreck (the headlight sockets)
    this.voidObMats.sun.uniforms.uCurve = this.curveUniform; // the crust shaders carry the curvature themselves
    this.voidObMats.green.uniforms.uCurve = this.curveUniform;
    this.trainBlockMat = this.emissiveMat(TRAIN_BLOCK_COLOR, 0.4, true);
    this.trainRideMat = this.emissiveMat(TRAIN_RIDE_COLOR, 0.5, true);
    // Lush vegetation (Prehistoric) and damaged metal debris (Ancient) on the train.
    this.trainVegMat = new THREE.MeshStandardMaterial({ color: 0x2f7a2c, emissive: 0x0e3a0c, emissiveIntensity: 0.5, roughness: 0.8, metalness: 0.05, flatShading: true });
    this.trainSfMat = new THREE.MeshStandardMaterial({ color: 0x141820, emissive: 0x3a6a7a, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.4, flatShading: true });

    // Era-change portal — a ring spanning all lanes, telegraphed from the front.
    const fx = new Portal(4.2, 220, Math.random);
    this.scene.add(fx.group);
    this.extraCurveMats.push(...fx.materials);
    this.portal = { mesh: fx.group, fx, active: false, crossed: false };

    this.buildTrack();
    for (let L = 6; L <= 23; L++) this.trainLookFor(L, true); // all train lengths built now, never during play
    this.buildBuildings();
    this.buildScenery();
    this.enableCurve();
    this.warmUp();
    this.resetPlayer();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    this.onResize();
    this.render();
  }

  /** Compiles every shader the game can need before play (rain, portal, tokens of all eras, obstacles, train,
   * a building with its frontage), so no "first time" compile lands on a frame during the game (50-200 ms on phones). */
  private warmUp() {
    const warm = new THREE.Group();
    const lmFor = (type: 'block' | 'overhead' | 'wall'): ObstacleMats => { const b = this.lookBase; return { body: b.body, dark: b.dark, accent: b.accent, glass: b.glass, neon: this.lookAccent[type], white: b.white }; };
    warm.add(buildBlock(lmFor('block')), buildOverhead(lmFor('overhead')), buildWall(lmFor('wall')));
    warm.add(buildVoidBlock(this.voidObMats), buildVoidOverhead(this.voidObMats), buildVoidWall(this.voidObMats));
    for (const kind of TOKEN_BY_ERA) warm.add(buildToken(kind, this.tokenMats));
    const trains = [this.trainLookFor(6, true), this.trainLookFor(6, false)]; // clones share the cached geometry: not disposed below
    warm.add(...trains);
    const voidTrains = [buildRockTrain(this.convoyMats, 8, TRAIN_W, TRAIN_H, RAMP_LEN), buildWreckTrain(this.wreckMats, 8, TRAIN_W, TRAIN_H, RAMP_LEN)]; // fresh (not cached): disposed with the warm group
    warm.add(...voidTrains);
    const ruinClones = this.ruinLooks[0] ? this.ruinLooks[0].pieces.map((p) => p.clone()) : [];
    warm.add(...ruinClones);
    const b0 = this.buildings[0];
    if (b0) {
      const f = makeFacade(10, 20, Math.random, { normal: true });
      b0.bm.map = f.map; b0.bm.emissiveMap = f.emissive; b0.bm.normalMap = f.normal ?? null; b0.bm.needsUpdate = true;
      b0.tm.map = f.map; b0.tm.emissiveMap = f.emissive; b0.tm.normalMap = f.normal ?? null; b0.tm.needsUpdate = true;
      const spec: BuildingSpec = { w: 10, topH: 30, d: 10, side: -1, h1: 20, tw: 7, td: 8, towerX: 0 };
      warm.add(buildSocle(spec, this.cityMats, b0.neonMat, Math.random), buildUpper(spec, this.cityMats, b0.neonMat, b0.bm, b0.tm, Math.random).group);
      b0.panel.visible = true;
    }
    this.scene.add(warm);
    const rainVis = this.rain.group.visible, portalVis = this.portal.fx.group.visible;
    this.rain.group.visible = true;
    this.portal.fx.group.visible = true;
    this.space.group.visible = true;
    this.space.setAllVisible(true);
    this.dust.points.visible = true;
    for (const v of this.voidRoads) v.visible = true;
    this.renderer.compile(this.scene, this.camera); // every material in the scene, frustum or not
    this.rain.group.visible = rainVis;
    this.portal.fx.group.visible = portalVis;
    this.space.setAllVisible(false);
    this.space.group.visible = false;
    this.dust.points.visible = false;
    for (const v of this.voidRoads) v.visible = false;
    if (b0) b0.panel.visible = false;
    for (const t of trains) warm.remove(t);
    for (const c of ruinClones) warm.remove(c);
    warm.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    warm.removeFromParent();
  }

  /** A train look for `len`: cached per integer length (ride materials), cloned per spawn (block variant = neon swap), stretched to the exact length. */
  private trainLookFor(len: number, trampoline: boolean): THREE.Group {
    const L = Math.max(6, Math.min(23, Math.round(len)));
    let base = this.trainCache.get(L);
    if (!base) { base = this.timed(`train${L}`, () => buildTrain(this.trainLook.ride, L, TRAIN_W, TRAIN_H, RAMP_LEN)); this.trainCache.set(L, base); }
    const look = base.clone();
    if (!trampoline) look.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh && mm.name === 'neon') mm.material = this.trainLook.block.neon; });
    look.scale.z = len / L;
    return look;
  }

  /** Unknown Future train look for `len`: a boulder convoy, or (1 in 10) a maglev wreck; cached per integer length, cloned per spawn, stretched to the exact length. */
  private voidTrainLookFor(len: number): THREE.Group {
    const L = Math.max(6, Math.min(23, Math.round(len)));
    const wreck = Math.random() < Game.WRECK_SHARE;
    const cache = wreck ? this.wreckCache : this.convoyCache;
    let base = cache.get(L);
    if (!base) { base = this.timed(wreck ? `wreck${L}` : `convoy${L}`, () => (wreck ? buildWreckTrain(this.wreckMats, L, TRAIN_W, TRAIN_H, RAMP_LEN) : buildRockTrain(this.convoyMats, L, TRAIN_W, TRAIN_H, RAMP_LEN))); cache.set(L, base); }
    const look = base.clone();
    look.scale.z = len / L;
    return look;
  }

  private emissiveMat(color: number, intensity: number, flat = false): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: color, emissiveIntensity: intensity, roughness: 0.6, metalness: 0.2, flatShading: flat });
  }

  /** Injects the world curvature into a material's vertex shader (offset × distance² in view space). */
  private applyCurveShader(mat: THREE.Material) {
    const extra = (mat as THREE.Material & { userData: { shaderHook?: (sh: THREE.WebGLProgramParametersWithUniforms) => void } }).userData.shaderHook;
    mat.onBeforeCompile = (shader) => {
      extra?.(shader);
      shader.uniforms.uCurve = this.curveUniform; // shared reference → updated once
      shader.vertexShader =
        'uniform vec2 uCurve;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          [
            'vec4 mvPosition = vec4( transformed, 1.0 );',
            'mvPosition = modelViewMatrix * mvPosition;',
            'float cDist = - mvPosition.z;',
            'mvPosition.x += uCurve.x * cDist * cDist;',
            'mvPosition.y += uCurve.y * cDist * cDist;',
            'gl_Position = projectionMatrix * mvPosition;',
          ].join('\n'),
        );
    };
    mat.needsUpdate = true;
  }

  /** Enables curvature on all world materials (the player, close to the camera, stays ~straight). */
  private enableCurve() {
    const mats: THREE.Material[] = [
      this.pMat, this.groundMat, this.railLMat, this.railRMat, this.lineMat,
      this.mat.block, this.mat.overhead, this.mat.wall, this.mat.core,
      this.trainBlockMat, this.trainRideMat, this.trainVegMat, this.trainSfMat,
      ...this.adMats, ...this.buildMats, ...this.buildLineMats, ...this.sceneryMats, this.terrainMat, this.floorMat, ...this.extraCurveMats,
      this.roofPropMat, this.roofLightMat,
    ];
    for (const m of mats) this.applyCurveShader(m);
  }

  // Interpolates the whole palette between two eras; `flash` (0..1) blends towards the rift colour.
  private applyEra(from: EraPalette, to: EraPalette, mix: number, flash: number) {
    const set = (target: THREE.Color, a: number, b: number, rift: number) => {
      this.cA.set(a);
      this.cB.set(b);
      target.lerpColors(this.cA, this.cB, mix);
      if (rift > 0) target.lerp(this.cRift, rift);
    };
    set(this.scene.background as THREE.Color, from.bg, to.bg, flash * 0.85);
    set(this.fog.color, from.fog, to.fog, flash * 0.85);
    set(this.hemi.color, from.hemiSky, to.hemiSky, flash * 0.5);
    set(this.hemi.groundColor, from.hemiGround, to.hemiGround, 0);
    set(this.groundMat.color, from.ground, to.ground, flash * 0.3);
    set(this.groundMat.emissive, from.groundEmissive, to.groundEmissive, flash * 0.5);
    set(this.railLMat.emissive, from.railL, to.railL, flash * 0.7);
    set(this.railRMat.emissive, from.railR, to.railR, flash * 0.7);
    this.railGlowL.color.copy(this.railLMat.emissive);
    this.railGlowR.color.copy(this.railRMat.emissive);
    set(this.lineMat.emissive, from.line, to.line, flash * 0.4);
    set(this.pMat.emissive, from.player, to.player, flash * 0.3);
    this.character?.setTint(this.pMat.emissive);
    set(this.mat.block.emissive, from.block, to.block, flash * 0.3);
    set(this.mat.overhead.emissive, from.overhead, to.overhead, flash * 0.3);
    set(this.mat.wall.emissive, from.wall, to.wall, flash * 0.3);
    set(this.lookAccent.block.emissive, from.block, to.block, flash * 0.3);
    set(this.lookAccent.overhead.emissive, from.overhead, to.overhead, flash * 0.3);
    set(this.lookAccent.wall.emissive, from.wall, to.wall, flash * 0.3);
    set(this.mat.core.emissive, from.core, to.core, flash * 0.3);
    (this.tokenMats.neon as THREE.MeshBasicMaterial).color.copy(this.mat.core.emissive).multiplyScalar(1.6);
    // Sky + stars
    set(this.skyUniforms.uTop.value, from.skyTop, to.skyTop, flash * 0.2);
    set(this.skyUniforms.uHorizon.value, from.skyHorizon, to.skyHorizon, flash * 0.4);
    this.starMat.uniforms.uOpacity.value = lerp(from.starOpacity, to.starOpacity, mix);
    // Semi-transparent road (void below) + planet fragments — Unknown Future only
    this.groundMat.opacity = lerp(from.groundOpacity, to.groundOpacity, mix);
    this.groundMat.transparent = this.groundMat.opacity < 0.99;
    const pv = lerp(from.planetOpacity, to.planetOpacity, mix);
    this.space.group.visible = pv > 0.5;
    this.skyUniforms.uNebula.value = pv;
  }

  /** The era die (1..30): Prehistoric/Ancient/Solarpunk ~6.7% each, Unknown Future ~3.3% (rarer). */
  private rollEra(): number {
    const r = randInt(this.rng, 30) + 1;
    if (r === 5 || r === 6) return 1; // Prehistoric
    if (r === 15 || r === 16) return 2; // Ancient-Mythological
    if (r === 25 || r === 26) return 3; // Solarpunk
    if (r === 30) return 4; // Unknown Future (the rarest)
    return 0; // Neo-Cyberpunk (home)
  }

  /** TEST active = the era set has been narrowed (at least one unchecked, but not all). */
  private testActive(): boolean {
    let on = 0;
    for (const e of this.testEras) if (e) on++;
    return on >= 1 && on < this.testEras.length;
  }

  /** TEST: picks an allowed era different from `current`. If there is only one, returns `current` (stay). */
  private pickAllowedEra(current: number): number {
    const pool: number[] = [];
    for (let i = 0; i < this.testEras.length; i++) if (this.testEras[i] && i !== current) pool.push(i);
    if (pool.length === 0) return current;
    return pool[randInt(this.rng, pool.length)];
  }

  /** Opens a portal ahead towards era `target`; the switch happens when passing through it. */
  private openPortal(target: number) {
    this.mark('portal');
    if (target === 4) this.space.compose(Math.random); // a fresh sky for every visit
    // If leaving Cyberpunk → clear the city BEYOND the portal (the new era starts there).
    if (this.era === 0 && target !== 0) {
      for (const q of this.pendingBuildings) { q.b.active = false; q.b.g.visible = false; if (q.group) disposeLook(q.group); } // not built yet → just released
      this.pendingBuildings.length = 0;
      for (const b of this.buildings) {
        if (b.active && b.g.position.z < SPAWN_Z) {
          b.active = false;
          b.g.visible = false;
        }
      }
    }
    // Clear the side scenery beyond the portal (the current era ends there).
    for (const s of this.scenery) {
      if (s.active && s.g.position.z < SPAWN_Z) {
        s.active = false;
        s.g.visible = false;
      }
    }
    for (const r of this.ruins) if (r.active && r.g.position.z < SPAWN_Z) { r.active = false; this.scene.remove(r.g); }
    this.pendingEra = target;
    this.portal.active = true;
    this.portal.crossed = false;
    this.portal.mesh.position.set(0, PORTAL_Y, SPAWN_Z);
    this.portal.fx.open(ERAS[target]); // tinted with the destination era
  }

  /** Sky dome with a gradient (zenith→horizon) + star field (opacity per era). */
  private buildSky() {
    this.skyGroup = new THREE.Group();
    this.scene.add(this.skyGroup);
    this.skyUniforms = {
      uTop: { value: new THREE.Color(ERAS[0].skyTop) },
      uHorizon: { value: new THREE.Color(ERAS[0].skyHorizon) },
      uNebula: { value: 0 }, // Unknown Future: nebula strength (follows planetOpacity)
      uNebTex: { value: makeNebulaTexture(Math.random) },
    };
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyUniforms,
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform float uNebula; uniform sampler2D uNebTex; varying vec3 vPos;
        void main(){ vec3 d = normalize(vPos); float h = d.y; float t = clamp(h * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(uHorizon, uTop, smoothstep(0.5, 0.72, t));
        if (uNebula > 0.001) { vec2 uv = vec2(0.5 + atan(d.z, d.x) / 6.2832, 0.5 - asin(h) / 3.1416); c += texture2D(uNebTex, uv).rgb * uNebula; }
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat);
    sky.renderOrder = -2;
    this.skyGroup.add(sky);

    // Stars
    const N = 900;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1); // full sphere: below the horizon they show through the void (Unknown Future); the city floor hides them in Neo-Cyberpunk
      const r = 270;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // sizes vary; brightness follows the size: small stars stay under the bloom threshold (0.88), the biggest reach 1.0 (a round bloom halo)
    const size = new Float32Array(N), bright = new Float32Array(N);
    for (let i = 0; i < N; i++) { const t = Math.random() * Math.random(); size[i] = 6 + 12 * t; bright[i] = 0.88 + 0.12 * t; }
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    this.starMat = makeStarMaterial(ERAS[0].starOpacity, this.renderer.getPixelRatio());
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.renderOrder = -1;
    this.skyGroup.add(stars);

    // Unknown Future sky: the six bodies, built once here (start screen), composed at every entry into the era
    this.space = new SpaceSky();
    this.space.build(Math.random);
    this.space.group.visible = false;
    this.skyGroup.add(this.space.group);
  }

  /** Ambient elements: pterodactyl (silhouette) + temporary rain. */
  private buildAmbient() {
    // Pterodactyl — two wings (M) + small body, dark silhouette
    this.pteroGroup = new THREE.Group();
    this.pteroGroup.visible = false;
    this.scene.add(this.pteroGroup);
    const sil = new THREE.MeshBasicMaterial({ color: 0x06070c, transparent: true, opacity: 0.92, side: THREE.DoubleSide, fog: false });
    const wing = (dir: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.5, 0, 0, -0.5, dir * 3.4, 0, -0.5]), 3));
      g.computeVertexNormals();
      return g;
    };
    this.pteroLWing = new THREE.Mesh(wing(-1), sil);
    this.pteroRWing = new THREE.Mesh(wing(1), sil);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 1.3), sil);
    this.pteroGroup.add(this.pteroLWing, this.pteroRWing, body);

    // Rain — streaks around the player + splashes on the road (see rain.ts)
    this.rain = new Rain(900, Math.random);
    this.dust = new CosmicDust();
    this.scene.add(this.dust.points);
    this.extraCurveMats.push(this.dust.points.material as THREE.Material);
    this.scene.add(this.rain.group);
  }


  /** Per-era backdrop silhouettes (in skyGroup, so they turn with the road). */
  private buildBackdrops() {
    // Prehistoric — lush vegetation + 1-2 dinosaur heads bending down to eat
    this.megaGroup = new THREE.Group();
    this.megaGroup.visible = false;
    this.skyGroup.add(this.megaGroup);
    const fmats = [0x1c4a1e, 0x256a22, 0x163a16].map((c) => new THREE.MeshBasicMaterial({ color: c, fog: false }));
    for (let i = 0; i < 18; i++) {
      const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + Math.random() * 6, 0), fmats[i % 3]);
      clump.position.set(-62 + Math.random() * 124, 1 + Math.random() * 5, -98 - Math.random() * 42);
      this.megaGroup.add(clump);
    }
    const dmat = new THREE.MeshBasicMaterial({ color: 0x223018, fog: false });
    const dino = (x: number, z: number) => {
      const g = new THREE.Group();
      const neck = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 15, 4, 8), dmat);
      neck.position.y = 9;
      g.add(neck);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 5), dmat);
      head.position.set(0, 17.5, 1.6);
      g.add(head);
      g.position.set(x, 5, z);
      this.megaGroup.add(g);
      this.dinoNecks.push(g);
    };
    dino(-18, -112);
    dino(26, -120);

    // Ancient — acropolis: a temple on a mountain (mesa) at the horizon (realistic, not floating)
    this.olympusGroup = new THREE.Group();
    this.olympusGroup.visible = false;
    this.skyGroup.add(this.olympusGroup);
    const rock = new THREE.MeshBasicMaterial({ color: 0x171511, transparent: true, opacity: 0.96, fog: false });
    const mesa = new THREE.Mesh(new THREE.CylinderGeometry(15, 46, 52, 7), rock); // mountain with a plateau
    mesa.position.y = 26;
    this.olympusGroup.add(mesa);
    const gold = new THREE.MeshBasicMaterial({ color: 0xf2d79a, transparent: true, opacity: 0.92, fog: false });
    const temple = new THREE.Group();
    temple.add(new THREE.Mesh(new THREE.BoxGeometry(20, 1.5, 12), gold)); // floor
    for (let i = 0; i < 5; i++) {
      for (const sgn of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 7, 8), gold);
        col.position.set(-8 + i * 4, 4.2, sgn * 5);
        temple.add(col);
      }
    }
    const arch = new THREE.Mesh(new THREE.BoxGeometry(20, 1.6, 12), gold);
    arch.position.y = 8.3;
    temple.add(arch);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 7.5, 3, 4), gold); // approx. pediment
    ped.position.y = 10.6;
    ped.rotation.y = Math.PI / 4;
    ped.scale.z = 0.55;
    temple.add(ped);
    temple.position.y = 52; // on the mountain plateau
    this.olympusGroup.add(temple);
    this.olympusGroup.position.set(-6, -20, -172); // base below the horizon; the peak + temple stick out more
    this.olympusGroup.scale.setScalar(0.9);

    // Airships (Solarpunk) — ellipsoid body + gondola, light-coloured
    this.airshipGroup = new THREE.Group();
    this.airshipGroup.visible = false;
    this.skyGroup.add(this.airshipGroup);
    const ship = new THREE.MeshBasicMaterial({ color: 0xe6f0cf, transparent: true, opacity: 0.92, fog: false });
    for (const d of [{ x: -40, y: 30, z: -120, s: 1.4 }, { x: 50, y: 40, z: -135, s: 1.9 }]) {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.SphereGeometry(4, 14, 10), ship);
      hull.scale.set(3.2, 1, 1);
      g.add(hull);
      const gon = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 1.4), ship);
      gon.position.y = -3.4;
      g.add(gon);
      g.position.set(d.x, d.y, d.z);
      g.scale.setScalar(d.s);
      this.airshipGroup.add(g);
      this.airships.push(g);
    }

  }

  /** Neon skyline at the horizon (Cyberpunk) — a ring of buildings in skyGroup, always covers the horizon. */
  private buildCyberBackdrop() {
    this.cyberBackdrop = new THREE.Group();
    this.cyberBackdrop.visible = false;
    this.skyGroup.add(this.cyberBackdrop);
    const edgeMats = [0x6ae6ff, 0xff7ae0, 0x7af0ff].map((c) => new THREE.LineBasicMaterial({ color: c }));
    const edges = new THREE.EdgesGeometry(this.buildGeo);
    const N = 76;
    const R = 230;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const w = 16 + Math.random() * 12;
      const h = 50 + Math.random() * 70;
      // unique, coarse, low-resolution facade: the skyline is ~230 units away
      const f = makeFacade(w, h, Math.random, { cellScale: 2.4, px: 0.6, composite: true });
      f.emissive.dispose();
      const box = new THREE.Mesh(this.buildGeo, new THREE.MeshBasicMaterial({ map: f.map, color: 0xb8bfe0, fog: false }));
      box.scale.set(w, h, 6);
      box.position.set(Math.sin(ang) * R, h / 2 - 35, -Math.cos(ang) * R); // base below the horizon
      box.rotation.y = -ang; // width tangent to the ring → continuous skyline
      box.add(new THREE.LineSegments(edges, edgeMats[i % edgeMats.length]));
      this.cyberBackdrop.add(box);
    }
    // Flying traffic over the skyline + a giant holographic ad hanging in the sky (the "holo moon").
    this.skyTraffic = new SkyTraffic(40, Math.random);
    this.cyberBackdrop.add(this.skyTraffic.points);
    this.skyVehicles = new SkyVehicles(14, Math.random);
    this.cyberBackdrop.add(this.skyVehicles.group);
    if (!this.adSets.length) this.adSets = makeBillboardTextures(Math.random);
    const moonMat = new THREE.MeshBasicMaterial({ map: this.adSets[this.moonBrand].square, transparent: true, opacity: 0.55, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
    this.holoMoon = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), moonMat);
    this.holoMoon.position.set(78, 82, -235);
    this.holoMoon.lookAt(0, 20, 0);
    this.cyberBackdrop.add(this.holoMoon);
  }

  /** Buildings (boxes) with neon edges + billboards on facades, the Cyberpunk city. */
  private buildBuildings() {
    if (!this.adSets.length) this.adSets = makeBillboardTextures(Math.random);
    if (!this.facades.length) this.facades = makeFacadeTextures(6, Math.random);
    const defs = [
      { c: 0x0e1428, e: 0x1e58b0, line: 0x33e6ff },
      { c: 0x1c1230, e: 0x6a1ea0, line: 0xff5ad8 },
      { c: 0x0e1c34, e: 0x1a6a96, line: 0x5af0ff },
    ];
    this.buildMats = defs.map((m) => new THREE.MeshStandardMaterial({ color: m.c, emissive: m.e, emissiveIntensity: 1.5, roughness: 0.75, metalness: 0.2, flatShading: true }));
    this.buildLineMats = defs.map((m) => new THREE.LineBasicMaterial({ color: m.line }));
    const panelGeo = new THREE.PlaneGeometry(1, 1);
    const antennaGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 5);
    const acGeo = new THREE.BoxGeometry(1, 1, 1);
    const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    const lightGeo = new THREE.SphereGeometry(0.22, 6, 4);
    for (let i = 0; i < 40; i++) {
      const g = new THREE.Group();
      // per-building facade materials (body + tower); the textures are generated at placement
      const facadeMat = () => { const mm = new THREE.MeshStandardMaterial({ color: 0xd8dcff, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.2, envMap: this.cityEnv, envMapIntensity: 0.35, normalScale: new THREE.Vector2(0.9, 0.9) }); this.extraCurveMats.push(mm); return mm; };
      const bm = facadeMat(), tm = facadeMat();
      const neonMat = new THREE.MeshBasicMaterial({ color: 0x00eaff, toneMapped: false });
      this.extraCurveMats.push(neonMat);
      const panelMat = new THREE.MeshBasicMaterial({ map: this.adSets[i % this.adSets.length].square, toneMapped: false });
      this.extraCurveMats.push(panelMat);
      const panel = new THREE.Mesh(panelGeo, panelMat);
      panel.userData.flicker = Math.random() * 100;
      panel.visible = false;
      g.add(panel);
      // rooftop props: antenna with a red light, an AC unit, a water tank (random subset per placement)
      const roof = new THREE.Group();
      const antenna = new THREE.Mesh(antennaGeo, this.roofPropMat);
      antenna.add(new THREE.Mesh(lightGeo, this.roofLightMat));
      antenna.children[0].position.y = 0.5;
      const ac = new THREE.Mesh(acGeo, this.roofPropMat);
      const tank = new THREE.Mesh(tankGeo, this.roofPropMat);
      roof.add(antenna, ac, tank);
      g.add(roof);
      g.visible = false;
      this.scene.add(g);
      this.buildings.push({ g, bm, tm, neonMat, panel, roof, active: false });
    }
  }

  private nextBuilding() {
    return this.buildings.find((x) => !x.active) ?? null;
  }

  /** Queues a placement: the building is reserved now and built over three frames (textures, socle + frontage, upper part). */
  private queueBuilding(b: CityBuilding, x: number, z: number, w: number, topH: number, d: number, ad: boolean) {
    b.active = true;
    b.g.visible = false;
    this.pendingBuildings.push({ b, x, z, w, topH, d, ad, dist: this.worldDist, stage: 0 });
  }
  /** Runs ONE stage of the first queued building per frame (~2-6 ms each instead of 9-27 ms at once). */
  private processBuildingQueue() {
    const q = this.pendingBuildings[0];
    if (!q) return;
    const b = q.b;
    const sh = SOCLE_H;
    if (q.stage === 0) {
      // stage 1: dimensions + unique facades (textures) for the body and the tower; old textures freed
      const side = q.x < 0 ? -1 : 1;
      const h1 = sh + (q.topH - sh) * (0.55 + Math.random() * 0.25);
      const tw = q.w * (0.6 + Math.random() * 0.2), td = q.d * 0.8;
      const towerX = (Math.random() - 0.5) * (q.w - tw);
      q.spec = { w: q.w, topH: q.topH, d: q.d, side, h1, tw, td, towerX };
      for (const mm of [b.bm, b.tm]) { mm.map?.dispose(); mm.emissiveMap?.dispose(); mm.normalMap?.dispose(); }
      const f = this.timed('facade', () => makeFacade(q.w, h1 - sh, Math.random, { normal: true }));
      b.bm.map = f.map; b.bm.emissiveMap = f.emissive; b.bm.normalMap = f.normal ?? null; b.bm.needsUpdate = true;
      const f2 = this.timed('facade2', () => makeFacade(tw, q.topH - h1, Math.random, { normal: true }));
      b.tm.map = f2.map; b.tm.emissiveMap = f2.emissive; b.tm.normalMap = f2.normal ?? null; b.tm.needsUpdate = true;
      b.neonMat.color.set(f.neon).multiplyScalar(1.6); // HDR → bloom
      if (b.look) { disposeLook(b.look.group); b.look = undefined; }
      q.group = new THREE.Group();
      q.stage = 1;
      return;
    }
    if (q.stage === 1) {
      // stage 2: socle with the random frontage (the heaviest part)
      q.group!.add(this.timed('socle', () => buildSocle(q.spec!, this.cityMats, b.neonMat, Math.random)));
      q.stage = 2;
      return;
    }
    // stage 3: body + tower + parapets + tubes, roof props, billboard; then reveal at the advanced position
    const spec = q.spec!;
    const up = this.timed('upper', () => buildUpper(spec, this.cityMats, b.neonMat, b.bm, b.tm, Math.random));
    q.group!.add(up.group);
    b.look = { group: q.group!, body: up.body, tower: up.tower, tubes: up.tubes };
    b.g.add(b.look.group);
    const { topH, tw, td, towerX, h1, w, d } = spec;
    const [antenna, ac, tank] = b.roof.children as THREE.Mesh[];
    antenna.visible = Math.random() < 0.6;
    const ah = 3 + Math.random() * 5;
    antenna.scale.set(1, ah, 1);
    antenna.position.set(towerX + (Math.random() - 0.5) * tw * 0.6, topH + ah / 2, (Math.random() - 0.5) * td * 0.5);
    ac.visible = Math.random() < 0.7;
    ac.scale.set(1.2 + Math.random() * 1.6, 0.9 + Math.random() * 0.8, 1.2 + Math.random() * 1.6);
    ac.position.set(towerX + (Math.random() - 0.5) * tw * 0.6, topH + ac.scale.y / 2, (Math.random() - 0.5) * td * 0.5);
    tank.visible = Math.random() < 0.35;
    const tr = 0.8 + Math.random() * 0.8;
    tank.scale.set(tr, 1.6 + Math.random(), tr);
    tank.position.set(towerX + (Math.random() - 0.5) * tw * 0.5, topH + tank.scale.y / 2, (Math.random() - 0.5) * td * 0.5);
    if (q.ad) {
      b.panel.visible = true;
      const availW = w * 0.92, availH = (h1 - sh) * 0.92;
      const avail = availW / availH;
      let fmt: AdFormat = 'square';
      let best = Infinity;
      for (const f of Object.keys(AD_ASPECT) as AdFormat[]) {
        const dlt = Math.abs(Math.log(avail / AD_ASPECT[f]));
        if (dlt < best) { best = dlt; fmt = f; }
      }
      const aspect = AD_ASPECT[fmt];
      const pw = avail > aspect ? availH * aspect : availW;
      const ph = pw / aspect;
      const pm = b.panel.material as THREE.MeshBasicMaterial;
      pm.map = this.adSets[(Math.random() * this.adSets.length) | 0][fmt];
      pm.color.setScalar(1);
      b.panel.scale.set(pw, ph, 1);
      b.panel.position.set(0, sh + (h1 - sh) * 0.5, d / 2 + 0.2); // centred on the body's facade
    } else {
      b.panel.visible = false;
    }
    b.g.position.set(q.x, 0, q.z + (this.worldDist - q.dist)); // z advanced by the distance travelled during the stages
    b.g.visible = true;
    this.pendingBuildings.shift();
  }

  /** A dense filler building (varied heights, from right next to the road to deep in the back).
   * THE RULE: while the billboard block is in the scene, no filler enters the reserved
   * corridor (billboard↔guards) — fillers are pushed beyond the guards' edge. */
  private spawnFiller(side: number) {
    const b = this.nextBuilding();
    if (!b) return;
    const s = side > 0 ? 1 : 0;
    const w = 8 + Math.random() * 9;
    const topH = 24 + Math.random() * 34;
    const d = 7 + Math.random() * 9;
    let xInner = 8 + Math.random() * 18;
    if (this.worldDist < this.reserveUntil[s]) xInner = Math.max(xInner, this.reserveOuterX[s]);
    this.queueBuilding(b, side * (xInner + w / 2), BUILD_SPAWN_Z - Math.random() * 12, w, topH, d, false);
  }

  /** Billboard block: the billboard building sits right next to the road; the guards fill the lateral gap between
   * it and the fillers (contiguous row outwards), and the billboard↔guards corridor is RESERVED —
   * no filler between the guards and the road while the billboard is still in the scene. */
  private spawnAdBlock(side: number) {
    const s = side > 0 ? 1 : 0;
    const zAd = BUILD_SPAWN_Z - Math.random() * 8; // the billboard, further away (towards the horizon)
    const adW = 13 + Math.random() * 5;
    const adB = this.nextBuilding();
    if (adB) this.queueBuilding(adB, side * (adW / 2 + 8), zAd, adW, 26 + Math.random() * 12, 8 + Math.random() * 6, true);
    // Guards: a contiguous row that fills the lateral gap from the billboard's edge outwards (GUARD_SPAN).
    const xInner = 8 + adW; // the billboard's outer edge = the guards' inner edge
    const xOuter = xInner + GUARD_SPAN;
    let x = xInner;
    let j = 0;
    while (x < xOuter) {
      const gb = this.nextBuilding();
      if (!gb) break;
      const gw = Math.min(11 + Math.random() * 6, xOuter - x);
      // Slightly closer to the player than the billboard (zAd+) and further back laterally → doesn't cover it.
      this.queueBuilding(gb, side * (x + gw / 2), zAd + 6 + j * 4, gw, 30 + Math.random() * 28, 8 + Math.random() * 6, false);
      x += gw;
      j++;
    }
    // Reserve the corridor until the billboard passes the player (worldDist grows by -zAd to reach z=0).
    this.reserveOuterX[s] = xOuter;
    this.reserveUntil[s] = this.worldDist + -zAd + 25;
  }

  /** Dense city; ~10% billboard blocks, the rest fillers. */
  private spawnBuilding() {
    const side = this.buildSide;
    this.buildSide *= -1;
    const s = side > 0 ? 1 : 0;
    if (--this.adCountdown[s] <= 0) {
      this.adCountdown[s] = 7 + ((Math.random() * 5) | 0);
      this.spawnAdBlock(side);
    } else {
      this.spawnFiller(side);
    }
  }

  /** Materials for the side scenery (Prehistoric for now; the other eras are added later). */
  private buildScenery() {
    const mat = (color: number, emissive: number, ei: number, rough = 0.8, metal = 0.05) =>
      new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: rough, metalness: metal, flatShading: true });
    this.scnTrunkMat = mat(0x4a3420, 0x180e04, 0.3);
    this.scnLeafA = mat(0x2f7a2c, 0x0e3a0c, 0.45);
    this.scnLeafB = mat(0x1f5a24, 0x0a2c0a, 0.4);
    this.scnRockMat = mat(0x5a5648, 0x161410, 0.3);
    this.scnMarbleMat = mat(0xe8e0cf, 0x4a4636, 0.3, 0.6, 0.1);
    this.scnGoldMat = mat(0xd9b65a, 0x6a4e16, 0.6, 0.4, 0.5);
    this.scnEcoMat = mat(0x4aa86a, 0x123f24, 0.45, 0.5, 0.2);
    this.scnSolarMat = mat(0x1a2a5a, 0x102a6a, 0.7, 0.4, 0.6);
    this.sceneryMats.push(this.scnTrunkMat, this.scnLeafA, this.scnLeafB, this.scnRockMat, this.scnMarbleMat, this.scnGoldMat, this.scnEcoMat, this.scnSolarMat);
    this.buildRuins();
  }

  /** The four ruin variants (Unknown Future): the city's block with every light out, broken in two. Materials go through the curvature shader. */
  private buildRuins() {
    const std = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1, ...o }); this.sceneryMats.push(m); return m; };
    const interiors = {} as CityMats['interiors'];
    for (const k of INTERIOR_KINDS) interiors[k] = [std({ color: 0x05060a })];
    const city: CityMats = {
      concrete: std({ color: 0x3a3f5c, roughness: 0.7 }), dark: std({ color: 0x0a0b14, roughness: 0.6, metalness: 0.3 }), white: std({ color: 0x7a7d88 }), red: std({ color: 0x4a161c }),
      warm: std({ color: 0x14110c }), glassDark: std({ color: 0x0b1a2c, roughness: 0.1, metalness: 0.8 }),
      glassSheen: std({ color: 0x9fdcff, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.1, depthWrite: false }),
      hazardY: std({ color: 0x8a7a2a }), hazardK: std({ color: 0x15161e }), interiors,
    };
    const inner = std({ color: 0x343746, emissive: 0x14151c, emissiveIntensity: 0.6, roughness: 1, flatShading: true });
    const rebar = std({ color: 0x4a3426, roughness: 0.7, metalness: 0.4 });
    const tube = std({ color: 0x0c1018, roughness: 0.35, metalness: 0.2 });
    const facade = (w: number, h: number) => { const f = makeFacadeTex(w, h, Math.random, { normal: true, dead: true }); return std({ map: f.map, normalMap: f.normal ?? null, normalScale: new THREE.Vector2(0.9, 0.9), color: 0xb4bace, roughness: 0.7, metalness: 0.1 }); };
    for (let i = 0; i < 4; i++) {
      const w = 7 + Math.random() * 3, topH = 20 + Math.random() * 12;
      const spec: BuildingSpec = { w, topH, d: 8 + Math.random() * 2, side: i % 2 ? 1 : -1, h1: 0, tw: w * 0.65, td: 7, towerX: Math.random() * 2 - 1 };
      spec.h1 = SOCLE_H + (topH - SOCLE_H) * (0.55 + Math.random() * 0.25);
      const m: RuinMats = { body: facade(w, spec.h1 - SOCLE_H), tower: facade(spec.tw, topH - spec.h1), inner, rebar, tube, city };
      const ruin = this.timed('ruin', () => buildRuin(spec, m, Math.random, { jag: 1.6, rebar: 0.92 }));
      const bc = new THREE.Vector3(0, topH / 2, 0); const home: THREE.Vector3[] = [], dir: THREE.Vector3[] = [], pr: number[] = []; let radius = 0;
      for (const piece of ruin.pieces) {
        const c = (piece.userData.center as THREE.Vector3).clone().sub(bc); home.push(c);
        const d = c.clone().normalize(); d.x += Math.random() - 0.5; d.z += Math.random() - 0.5; dir.push(d.normalize());
        const box = new THREE.Box3().setFromObject(piece); const r = box.getSize(new THREE.Vector3()).length() / 2; pr.push(r); radius = Math.max(radius, c.length() + r);
      }
      this.ruinLooks.push({ pieces: ruin.pieces, home, dir, pr, radius });
    }
  }

  /** One ruin beside the road: a variant cloned (shared geometry), the lower piece / the upper piece / both pushed apart (1/3 each), scaled, tilted and set tumbling slowly. */
  private spawnRuin(side: number) {
    const look = this.ruinLooks[(Math.random() * this.ruinLooks.length) | 0];
    const g = new THREE.Group();
    const gap = 3 + Math.random() * 5;
    const mode = (Math.random() * 3) | 0; // 0 = both, 1 = lower, 2 = upper
    let R = 0; // bounding radius of the tumbling body: keeps it off the road whatever its rotation
    if (mode === 0) { look.pieces.forEach((p, i) => { const c = p.clone(); c.position.copy(look.home[i]).addScaledVector(look.dir[i], gap); g.add(c); }); R = look.radius + gap; }
    else { const i = mode - 1; g.add(look.pieces[i].clone()); R = look.pr[i]; }
    const sc = 0.5 + Math.random() * 0.4;
    g.scale.setScalar(sc);
    R *= sc;
    g.position.set(side * (TRACK_HALF_W + 0.6 + R + Math.random() * 8), Math.random() * 10 - 2, SCENERY_SPAWN_Z - Math.random() * 14);
    g.rotation.set((Math.random() - 0.5) * 1.0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 1.0);
    let r = this.ruins.find((x) => !x.active);
    if (r) this.scene.remove(r.g); else { r = { g, axis: new THREE.Vector3(), w: 0, active: false }; this.ruins.push(r); }
    r.g = g; r.active = true; r.w = 0.03 + Math.random() * 0.04;
    r.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.scene.add(g);
  }

  /** How often side scenery appears in the current era (0 = era with no scenery configured yet). */
  private sceneryGap(): number {
    if (this.era === 1) return 3; // Prehistoric — dense jungle
    if (this.era === 2) return 6; // Ancient — columns/statues/buildings (sacred way)
    if (this.era === 3) return 5.5; // Solarpunk — eco-towers/panels/hedges
    if (this.era === 4) return 26; // Unknown Future — drifting ruins (desolate)
    return 0;
  }

  private nextScenery() {
    let s = this.scenery.find((x) => !x.active);
    if (!s) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(this.scnBoxGeo, this.scnRockMat);
      const post = new THREE.Mesh(this.scnPostGeo, this.scnTrunkMat);
      const blobA = new THREE.Mesh(this.scnBlobGeo, this.scnLeafA);
      const blobB = new THREE.Mesh(this.scnBlobGeo, this.scnLeafB);
      const panel = new THREE.Mesh(this.scnPanelGeo, this.scnLeafA);
      g.add(box, post, blobA, blobB, panel);
      g.visible = false;
      this.scene.add(g);
      s = { g, box, post, blobA, blobB, panel, active: false };
      this.scenery.push(s);
    }
    return s;
  }

  /** One side-scenery element, alternating sides. */
  private spawnScenery() {
    const side = this.scenerySide;
    this.scenerySide *= -1;
    if (this.era === 4) { this.spawnRuin(side); return; }
    const s = this.nextScenery();
    s.active = true;
    s.g.visible = true;
    // all pieces hidden by default; the archetype turns on what it needs
    s.box.visible = s.post.visible = s.blobA.visible = s.blobB.visible = s.panel.visible = false;
    const innerX = 4.8 + Math.random() * 7; // inner edge, varied (not on the road)
    s.g.position.set(side * innerX, 0, SCENERY_SPAWN_Z - Math.random() * 14);
    s.g.rotation.y = Math.random() * Math.PI * 2;
    if (this.era === 1) this.composePrehistoric(s);
    else if (this.era === 2) this.composeAntic(s, side);
    else if (this.era === 3) this.composeSolarpunk(s, side);
    this.keepOffRoad(s.g, side);
  }

  /** Solidity: nothing low may stand over the road. The piece is pushed outwards until every part under 3 m clears ROAD_CLEAR (crowns and signs may hang over). */
  private keepOffRoad(g: THREE.Object3D, side: number) {
    g.updateMatrixWorld(true);
    let inner = Infinity; const box = new THREE.Box3();
    g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.visible) return; box.setFromObject(m); if (box.min.y > 3) return; inner = Math.min(inner, side > 0 ? box.min.x : -box.max.x); });
    if (inner < ROAD_CLEAR) g.position.x += side * (ROAD_CLEAR - inner);
  }

  /** Prehistoric: tree (trunk + full foliage) or a group of boulders; + undergrowth bush. */
  private composePrehistoric(s: { box: THREE.Mesh; post: THREE.Mesh; blobA: THREE.Mesh; blobB: THREE.Mesh }) {
    if (Math.random() < 0.74) {
      // Tree: vertical trunk + 2 foliage crowns (full jungle canopy).
      const h = 4.5 + Math.random() * 5;
      s.post.visible = true;
      s.post.material = this.scnTrunkMat;
      s.post.scale.set(0.5 + Math.random() * 0.3, h, 0.5 + Math.random() * 0.3);
      s.post.position.set(0, h / 2, 0);
      s.blobA.visible = true;
      s.blobA.material = this.scnLeafA;
      const r = 2.8 + Math.random() * 2;
      s.blobA.scale.setScalar(r);
      s.blobA.position.set(0, h + r * 0.4, 0);
      s.blobA.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      s.blobB.visible = true; // always the second crown → denser
      s.blobB.material = this.scnLeafB;
      const r2 = 1.8 + Math.random() * 1.8;
      s.blobB.scale.setScalar(r2);
      s.blobB.position.set((Math.random() - 0.5) * 3, h + r * 0.2 + r2 * 0.3, (Math.random() - 0.5) * 3);
      s.blobB.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    } else {
      // Boulders: 1-2 rocks.
      s.blobA.visible = true;
      s.blobA.material = this.scnRockMat;
      const r = 1.6 + Math.random() * 2.4;
      s.blobA.scale.set(r, r * (0.6 + Math.random() * 0.4), r);
      s.blobA.position.set(0, r * 0.4, 0);
      s.blobA.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      if (Math.random() < 0.5) {
        s.blobB.visible = true;
        s.blobB.material = this.scnRockMat;
        const r2 = 1 + Math.random() * 1.6;
        s.blobB.scale.set(r2, r2 * 0.7, r2);
        s.blobB.position.set((Math.random() - 0.5) * 3, r2 * 0.35, (Math.random() - 0.5) * 3);
        s.blobB.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      }
    }
    // Undergrowth: low green bush at the base (fills the ground → jungle feel).
    if (Math.random() < 0.7) {
      const bw = 1.6 + Math.random() * 2.2;
      const bh = 0.8 + Math.random() * 1.2;
      s.box.visible = true;
      s.box.material = this.scnLeafB;
      s.box.scale.set(bw, bh, bw);
      s.box.position.set((Math.random() - 0.5) * 3, bh / 2, (Math.random() - 0.5) * 3);
      s.box.rotation.y = Math.random() * Math.PI;
    }
  }

  /** Ancient: marble column, gilded statue on a pedestal, or marble building (future: billboards). */
  private composeAntic(s: { g: THREE.Group; box: THREE.Mesh; post: THREE.Mesh; blobA: THREE.Mesh; blobB: THREE.Mesh }, side: number) {
    const r = Math.random();
    if (r < 0.45) {
      // Marble column: shaft + capital (some shorter = broken).
      const h = 5 + Math.random() * 6;
      s.post.visible = true;
      s.post.material = this.scnMarbleMat;
      const t = 0.6 + Math.random() * 0.3;
      s.post.scale.set(t, h, t);
      s.post.position.set(0, h / 2, 0);
      s.box.visible = true;
      s.box.material = this.scnMarbleMat; // capital
      s.box.scale.set(t * 2.6, 0.6, t * 2.6);
      s.box.position.set(0, h + 0.3, 0);
      s.box.rotation.y = 0;
    } else if (r < 0.74) {
      // Gilded statue on a marble pedestal.
      s.box.visible = true;
      s.box.material = this.scnMarbleMat; // pedestal
      const pw = 1.8 + Math.random();
      const ph = 1.4 + Math.random() * 0.9;
      s.box.scale.set(pw, ph, pw);
      s.box.position.set(0, ph / 2, 0);
      s.box.rotation.y = 0;
      s.post.visible = true;
      s.post.material = this.scnGoldMat; // body
      const bh = 3 + Math.random() * 1.8;
      s.post.scale.set(0.9, bh, 0.7);
      s.post.position.set(0, ph + bh / 2, 0);
      s.blobA.visible = true;
      s.blobA.material = this.scnGoldMat; // head
      s.blobA.scale.setScalar(0.7 + Math.random() * 0.3);
      s.blobA.position.set(0, ph + bh + 0.5, 0);
    } else {
      // Marble building (support for satirical billboards — next step).
      // No random rotation + pushed outwards: inner edge at the side base (not on the road).
      s.g.rotation.y = 0;
      const w = 6 + Math.random() * 5;
      const h = 8 + Math.random() * 9;
      const d = 6 + Math.random() * 4;
      s.box.visible = true;
      s.box.material = this.scnMarbleMat;
      s.box.scale.set(w, h, d);
      s.box.position.set(side * (w / 2), h / 2, 0);
    }
  }

  /** Solarpunk: green eco-tower with plant terraces, tilted solar panel, or hedge. */
  private composeSolarpunk(s: { g: THREE.Group; box: THREE.Mesh; post: THREE.Mesh; blobA: THREE.Mesh; blobB: THREE.Mesh; panel: THREE.Mesh }, side: number) {
    const r = Math.random();
    if (r < 0.42) {
      // Eco-tower: green-glass body + 1-2 greenery terraces (support for holo billboards — next step).
      s.g.rotation.y = 0;
      const w = 4.5 + Math.random() * 4;
      const h = 9 + Math.random() * 9;
      const d = 4.5 + Math.random() * 3;
      const cx = side * (w / 2);
      s.box.visible = true;
      s.box.material = this.scnEcoMat;
      s.box.scale.set(w, h, d);
      s.box.position.set(cx, h / 2, 0);
      s.blobA.visible = true;
      s.blobA.material = this.scnLeafA;
      s.blobA.scale.set(w * 0.7, 1.1, d * 0.7);
      s.blobA.position.set(cx, h * 0.66, 0);
      s.blobA.rotation.set(0, Math.random() * 3, 0);
      if (Math.random() < 0.7) {
        s.blobB.visible = true;
        s.blobB.material = this.scnLeafB;
        s.blobB.scale.set(w * 0.6, 1, d * 0.6);
        s.blobB.position.set(cx, h * 0.34, 0);
        s.blobB.rotation.set(0, Math.random() * 3, 0);
      }
    } else if (r < 0.72) {
      // Tilted solar panel on a pole.
      const ph = 2.5 + Math.random() * 2;
      s.post.visible = true;
      s.post.material = this.scnEcoMat;
      s.post.scale.set(0.4, ph, 0.4);
      s.post.position.set(0, ph / 2, 0);
      s.panel.visible = true;
      s.panel.material = this.scnSolarMat;
      const pw = 3 + Math.random() * 2;
      s.panel.scale.set(pw, pw * 0.7, 1);
      s.panel.position.set(0, ph + 0.6, 0);
      s.panel.rotation.set(-0.95, side > 0 ? 0.3 : -0.3, 0); // tilted towards the sun
    } else {
      // Hedge / living wall along the road.
      s.box.visible = true;
      s.box.material = this.scnLeafA;
      const w = 3 + Math.random() * 4;
      const h = 1.5 + Math.random() * 1.6;
      s.box.scale.set(w, h, 2 + Math.random() * 1.5);
      s.box.position.set(0, h / 2, 0);
      s.box.rotation.y = 0;
    }
  }

  /** Animates the pterodactyl (Prehistoric/Solarpunk) and the temporary rain (Cyberpunk). */
  private updateAmbient(dt: number) {
    if (this.cyberBackdrop.visible) {
      this.skyTraffic?.update(dt);
      this.skyVehicles?.update(dt, this.elapsed);
      if (this.holoMoon) {
        const mm = this.holoMoon.material as THREE.MeshBasicMaterial;
        // every 10-15 s pick another of the 10 ads at random, with a short fade out / fade in
        this.moonTimer -= dt;
        if (this.moonTimer <= 0 && this.moonFade === 0) this.moonFade = 1;
        let fade = 1;
        if (this.moonFade > 0) {
          this.moonFade -= dt * 2;
          fade = Math.max(0, this.moonFade);
          if (this.moonFade <= 0) {
            let next = this.moonBrand;
            while (next === this.moonBrand) next = (Math.random() * this.adSets.length) | 0;
            this.moonBrand = next;
            mm.map = this.adSets[next].square;
            this.moonFade = -1;
            this.moonTimer = 10 + Math.random() * 5;
          }
        } else if (this.moonFade < 0) {
          this.moonFade = Math.min(0, this.moonFade + dt * 2);
          fade = 1 + this.moonFade;
        }
        mm.opacity = (0.45 + 0.1 * Math.sin(this.elapsed * 1.3)) * fade;
      }
    }
    // Pterodactyl
    if (this.pteroActive) {
      this.pteroProg += dt / 7; // ~7s crossing
      this.pteroGroup.position.x = lerp(this.pteroStartX, -this.pteroStartX, this.pteroProg);
      const flap = Math.sin(this.elapsed * 7) * 0.5;
      this.pteroLWing.rotation.z = -flap;
      this.pteroRWing.rotation.z = flap;
      if (this.pteroProg >= 1) {
        this.pteroActive = false;
        this.pteroGroup.visible = false;
        this.pteroDelay = this.era === 1 ? 4 + Math.random() * 5 : 18 + Math.random() * 16;
      }
    } else {
      this.pteroDelay -= dt;
      if (this.pteroDelay <= 0) {
        if (this.era === 1 || this.era === 3) {
          this.pteroActive = true;
          this.pteroProg = 0;
          this.pteroGroup.visible = true;
          const d = Math.random() < 0.5 ? 1 : -1;
          this.pteroStartX = d * 55;
          this.pteroGroup.position.set(d * 55, 22 + Math.random() * 16, -50 - Math.random() * 25);
          this.pteroGroup.scale.setScalar(1 + Math.random() * 0.7);
        } else {
          this.pteroDelay = 2;
        }
      }
    }

    // Temporary rain — only in Cyberpunk (era 0), comes and goes
    const inCyber = this.era === 0;
    this.rainTimer -= dt;
    if (this.rainTimer <= 0) {
      this.rainOn = inCyber ? !this.rainOn : false;
      this.rainTimer = this.rainOn ? 8 + Math.random() * 8 : 12 + Math.random() * 20;
    }
    // Per-era backdrop (visible only in its own era). The skyline disappears as soon as a portal to another era opens.
    this.cyberBackdrop.visible = this.era === 0 && this.pendingEra < 1;
    this.megaGroup.visible = this.era === 1;
    this.olympusGroup.visible = this.era === 2;
    this.airshipGroup.visible = this.era === 3;
    // Side ground: only in eras with ground scenery (1/2/3). Cyberpunk has buildings below the horizon; Unknown = void.
    const showTerrain = this.era === 1 || this.era === 2 || this.era === 3;
    if (showTerrain) this.terrainMat.color.setHex(this.era === 1 ? 0x18301a : this.era === 2 ? 0x3a3122 : 0x163a1e);
    for (const t of this.terrains) t.visible = showTerrain;
    for (const f of this.floors) f.visible = this.era === 0 && !showTerrain;
    const voidEra = this.era === 4;
    for (const r of this.roadReliefs) r.visible = !voidEra;
    for (const v of this.voidRoads) v.visible = voidEra;
    this.dust.points.visible = voidEra;
    if (this.megaGroup.visible) {
      // the dinosaurs bend down now and then to eat
      for (let i = 0; i < this.dinoNecks.length; i++) {
        const s = Math.max(0, Math.sin(this.elapsed * 0.35 + i * 2.1));
        this.dinoNecks[i].rotation.x = Math.pow(s, 6) * 1.2;
      }
    }
    if (this.airshipGroup.visible) {
      for (let i = 0; i < this.airships.length; i++) {
        const a = this.airships[i];
        a.position.x += dt * (i % 2 ? 1.2 : -1.0);
        if (a.position.x > 75) a.position.x = -75;
        else if (a.position.x < -75) a.position.x = 75;
      }
    }

    const target = inCyber && this.rainOn ? 1 : 0;
    const prevRain = this.rainLevel;
    this.rainLevel = damp(this.rainLevel, target, 1.2, dt);
    if (prevRain < 0.01 && this.rainLevel >= 0.01) this.mark('rain on');
    if (prevRain >= 0.01 && this.rainLevel < 0.01) this.mark('rain off');
    this.rain.update(dt, this.camX, this.rainLevel, Math.random);
    if (this.dust.points.visible) this.dust.update(this.speed * dt);

  }

  private buildTrack() {
    const groundGeo = new THREE.BoxGeometry(TRACK_HALF_W * 2, 0.5, SEGMENT_LEN);
    const asphalt = makeAsphaltTexture();
    asphalt.repeat.set(2, SEGMENT_LEN / 3.6); // 3.6 m tiles across the track width
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x0b0820, map: asphalt, roughness: 0.8, metalness: 0.12, envMap: this.cityEnv, envMapIntensity: 0.3, emissive: 0x0a0526, emissiveIntensity: 0.4, transparent: true });
    // rails: a thin bright core + a wide soft additive halo lying on the road (diffuse edges instead of a hard band)
    this.railLMat = this.emissiveMat(0x00eaff, 0.95);
    this.railRMat = this.emissiveMat(0xff36c8, 1.5);
    const glowTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 1; const g = c.getContext('2d')!; const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 1); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const glowMat = (c: number) => new THREE.MeshBasicMaterial({ map: glowTex, color: c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.railGlowL = glowMat(0x00eaff);
    this.railGlowR = glowMat(0xff36c8);
    this.extraCurveMats.push(this.railGlowL, this.railGlowR);
    this.voidMats.railL = this.railLMat;
    this.voidMats.railR = this.railRMat;
    const glowGeo = new THREE.PlaneGeometry(0.6, SEGMENT_LEN);
    glowGeo.rotateX(-Math.PI / 2);
    this.lineMat = this.emissiveMat(0x3344aa, 0.8);
    // Wide side ground (the scenery stands on it); hidden by default, enabled per era in update.
    const terrainGeo = new THREE.BoxGeometry(140, 0.5, SEGMENT_LEN);
    this.terrainMat = new THREE.MeshStandardMaterial({ color: 0x18301a, roughness: 1, metalness: 0, flatShading: true });
    // Neo-Cyberpunk: a dark plaza floor (panel grid + faint seams) the buildings stand on; the road stays on top
    const floorTex = makeAsphaltTexture();
    floorTex.repeat.set(140 / 5.5, SEGMENT_LEN / 5.5); // 5.5 m slabs → 4 per segment, seams line up between segments
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x2c3050, map: floorTex, roughness: 0.75, metalness: 0.15, envMap: this.cityEnv, envMapIntensity: 0.35 });
    const floorGeo = new THREE.PlaneGeometry(140, SEGMENT_LEN);
    floorGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const g = new THREE.Group();
      const terrain = new THREE.Mesh(terrainGeo, this.terrainMat);
      terrain.position.y = -0.4; // slightly below the road, so the road stays on top
      terrain.visible = false;
      g.add(terrain);
      this.terrains.push(terrain);
      const floor = new THREE.Mesh(floorGeo, this.floorMat);
      floor.position.y = -0.04;
      g.add(floor);
      this.floors.push(floor);
      const ground = new THREE.Mesh(groundGeo, this.groundMat);
      ground.position.y = -0.25;
      g.add(ground);
      // road relief: curbs with the neon tubes, posts with lights, drains, dashed lane marks, a seam
      const relief = buildRoadRelief(SEGMENT_LEN, TRACK_HALF_W, { concrete: this.cityMats.concrete, dark: this.cityMats.dark, white: this.cityMats.white, railL: this.railLMat, railR: this.railRMat, line: this.lineMat });
      g.add(relief);
      this.roadReliefs.push(relief);
      const vr = buildVoidRoad(SEGMENT_LEN, TRACK_HALF_W, this.voidMats);
      vr.visible = false;
      g.add(vr);
      this.voidRoads.push(vr);
      const gl = new THREE.Mesh(glowGeo, this.railGlowL);
      gl.position.set(-(TRACK_HALF_W - 0.2), 0.012, 0);
      g.add(gl);
      const gr = new THREE.Mesh(glowGeo, this.railGlowR);
      gr.position.set(TRACK_HALF_W - 0.2, 0.012, 0);
      g.add(gr);
      g.position.z = DESPAWN_Z - SEGMENT_LEN / 2 - i * SEGMENT_LEN;
      this.grounds.push(g);
      this.scene.add(g);
    }
  }

  private spawn(type: SimpleType, lane: number, yOverride?: number, zOverride?: number) {
    let ob = this.pools[type].find((o) => !o.active);
    if (!ob) {
      const mesh = new THREE.Mesh(this.geo[type], this.mat[type]);
      ob = { mesh, type, lane, active: false, len: 0, trampoline: false, roofY: 0 };
      if (type !== 'core') {
        const b = this.lookBase;
        const lm: ObstacleMats = { body: b.body, dark: b.dark, accent: b.accent, glass: b.glass, neon: this.lookAccent[type], white: b.white };
        ob.look = this.timed('obstacle', () => (type === 'block' ? buildBlock(lm) : type === 'overhead' ? buildOverhead(lm) : buildWall(lm)));
        mesh.add(ob.look); // follows the collision box (unscaled)
      }
      this.pools[type].push(ob);
      this.scene.add(mesh);
    }
    ob.lane = lane;
    ob.active = true;
    ob.mesh.visible = true;
    ob.mesh.position.set(LANE_X[lane], yOverride ?? SPEC[type].y, zOverride ?? SPAWN_Z);
    ob.mesh.rotation.set(0, 0, 0);
    if (type === 'core') {
      const era = this.spawnEra();
      if (!ob.looks) ob.looks = new Map();
      let look = ob.looks.get(era);
      if (!look) { const l = this.timed('token', () => buildToken(TOKEN_BY_ERA[era] ?? 'coin', this.tokenMats)); look = l; ob.looks.set(era, l); ob.mesh.add(l); }
      for (const l of ob.looks.values()) l.visible = l === look;
      ob.look = look;
      ob.mesh.material = this.hiddenMat;
    } else if (ob.look) {
      const era = this.spawnEra();
      if (era === 4 && !ob.lookVoid) {
        ob.lookVoid = this.timed('obstacleVoid', () => (type === 'block' ? buildVoidBlock(this.voidObMats) : type === 'overhead' ? buildVoidOverhead(this.voidObMats) : buildVoidWall(this.voidObMats)));
        ob.mesh.add(ob.lookVoid);
      }
      ob.look.visible = era === 0;
      if (ob.lookVoid) ob.lookVoid.visible = era === 4;
      ob.mesh.material = era === 0 || era === 4 ? this.hiddenMat : this.mat[type];
    }
  }

  // --- Trains & generator (Increment B) ---
  // trampoline=true → teal (mountable from the ground by jumping); false → red (from above only).
  private spawnTrain(trampoline: boolean, lane: number, frontZ: number, len: number) {
    let ob = this.trains.find((o) => !o.active);
    if (!ob) {
      ob = { mesh: new THREE.Mesh(this.trainGeo, this.trainRideMat), type: 'trainRide', lane, active: false, len, trampoline, roofY: TRAIN_H };
      this.trains.push(ob);
      this.scene.add(ob.mesh);
    }
    ob.type = trampoline ? 'trainRide' : 'trainBlock';
    ob.lane = lane;
    ob.len = len;
    ob.trampoline = trampoline;
    ob.roofY = TRAIN_H; // both have the roof at the same height
    ob.active = true;
    ob.mesh.visible = true;
    ob.mesh.material = trampoline ? this.trainRideMat : this.trainBlockMat;
    ob.mesh.scale.set(TRAIN_W, TRAIN_H, len);
    ob.mesh.position.set(LANE_X[lane], TRAIN_H / 2, frontZ - len / 2);
    // Ramp nose ONLY for the climbable one (shape = marker): rises from the ground in front up to the roof.
    // The blocking one keeps a vertical face (wall) → orientation distinguishes them, not just colour.
    if (trampoline) {
      if (!ob.ramp) {
        ob.ramp = new THREE.Mesh(this.rampGeo, this.trainRideMat);
        this.scene.add(ob.ramp);
      }
      ob.ramp.visible = true;
      ob.ramp.scale.set(TRAIN_W, TRAIN_H, RAMP_LEN);
      ob.ramp.position.set(LANE_X[lane], 0, frontZ); // the ramp's z=0 flush with the front face
    } else if (ob.ramp) {
      ob.ramp.visible = false;
    }
    // Neo-Cyberpunk: the maglev locomotive (nose = ramp towards the player on the climbable one, tail on the blocking one)
    if (ob.look) {
      ob.look.removeFromParent(); // geometry is shared with the cache: not disposed
      ob.look = undefined;
    }
    const spawnEra = this.spawnEra();
    if (spawnEra === 0 || spawnEra === 4) {
      ob.look = spawnEra === 0 ? this.trainLookFor(len, trampoline) : this.voidTrainLookFor(len);
      ob.look.rotation.y = trampoline ? 0 : Math.PI;
      ob.look.position.set(LANE_X[lane], 0, frontZ - len / 2);
      this.scene.add(ob.look);
      ob.mesh.material = this.hiddenMat;
      if (ob.ramp) ob.ramp.visible = false; // the hull has its own wedge nose
    }
    this.decorateTrain(ob, lane, frontZ, len);
  }

  /** Decor pool for one train: vegetation clumps (Prehistoric) + sci-fi debris (Ancient). */
  private buildTrainDecor(): THREE.Group {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 + (i % 3) * 0.25, 0), this.trainVegMat);
      c.userData = { kind: 'veg', i };
      g.add(c);
    }
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), this.trainSfMat);
      b.userData = { kind: 'sf', i };
      g.add(b);
    }
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  /** Sci-fi intrusion as a variant of the "long" obstacle (plan §3.6): in Prehistoric the train = a maglev
   * overgrown with vegetation; in Ancient = damaged sci-fi debris. Purely visual decor (the train stays
   * functionally climbable/blocking); appears only on some trains in the historical eras. */
  private decorateTrain(ob: Ob, lane: number, frontZ: number, len: number) {
    // ACCIDENTAL appearance (surprise): only while there is budget left per excursion + low probability.
    let kind: 'veg' | 'sf' | null = null;
    if (this.sfBudget > 0 && this.rng() < 0.16) {
      if (this.era === 1) kind = 'veg'; // Prehistoric — maglev overgrown with vegetation
      else if (this.era === 2) kind = 'sf'; // Ancient — damaged sci-fi debris
    }
    if (!kind) {
      if (ob.decor) ob.decor.visible = false;
      return;
    }
    this.sfBudget--;
    if (!ob.decor) ob.decor = this.buildTrainDecor();
    ob.decor.visible = true;
    ob.decor.position.set(LANE_X[lane], 0, frontZ - len / 2); // same as the train's centre
    const nVeg = 6, nSf = 5;
    for (const c of ob.decor.children) {
      const k = c.userData.kind as 'veg' | 'sf';
      if (k !== kind) {
        c.visible = false;
        continue;
      }
      c.visible = true;
      const n = k === 'veg' ? nVeg : nSf;
      const t = (c.userData.i + 0.5) / n; // 0..1 along the length
      const lz = (0.5 - t) * (len - 1); // local z: from front (+) to back (-)
      const side = this.rng() < 0.5 ? -1 : 1;
      const top = this.rng() < 0.6; // on the roof vs on the side
      const x = top ? (this.rng() - 0.5) * TRAIN_W : side * (TRAIN_W / 2);
      const y = top ? TRAIN_H + (k === 'veg' ? 0.1 : -0.1) : TRAIN_H * (0.4 + this.rng() * 0.4);
      c.position.set(x, y, lz);
      c.rotation.set(this.rng() * 3, this.rng() * 3, this.rng() * 3);
      c.scale.setScalar(k === 'veg' ? 0.8 + this.rng() * 0.7 : 0.6 + this.rng() * 0.6);
    }
  }

  /** "Premium" cores on a train's roof. */
  /** Tokens along the ideal jump parabola from the edge of a roof (takeoff at edgeZ, landing jumpLen further). */
  private seedJumpArc(lane: number, edgeZ: number, jumpLen: number) {
    for (const k of [0.2, 0.4, 0.6, 0.8]) {
      const t = k * JUMP_AIRTIME;
      const h = JUMP_V * t + 0.5 * GRAVITY * t * t; // height above the roof at that point of the arc
      this.spawn('core', lane, TRAIN_H + 0.7 + h, edgeZ - k * jumpLen);
    }
  }

  private seedRoofCores(lane: number, frontZ: number, len: number) {
    const y = TRAIN_H + 0.7;
    for (let z = frontZ - 1.5; z > frontZ - len + 1; z -= 3.5) {
      this.spawn('core', lane, y, z);
    }
  }

  /** Decides the content of the next section: a normal row OR a chain of trains. */
  private generateContent() {
    const diff = sampleDifficulty(this.score);
    const jumpLen = this.speed * JUMP_AIRTIME;
    const trainP = this.score > TRAIN_UNLOCK ? clamp((this.score - TRAIN_UNLOCK) / 8000, 0.45, 0.65) : 0;

    if (this.rng() < trainP) {
      const consumed = this.spawnTrainChain(jumpLen);
      this.nextGap = consumed + jumpLen * 2.2; // ≥ 2 jumps after a chain
    } else {
      this.spawnRow(diff);
      const wave = Math.sin((this.score / diff.wavePeriod) * Math.PI * 2) * diff.waveAmp;
      const dens = clamp(diff.density * this.densityMult + wave, 0.05, 0.98);
      this.nextGap = lerp(jumpLen * 3.6, jumpLen * 1.15, dens);
    }
  }

  /** One train in one lane (the other 2 stay free → guaranteed passability). */
  private spawnTrainChain(jumpLen: number): number {
    const lane = randInt(this.rng, 3);
    const free = [0, 1, 2].filter((l) => l !== lane);
    this.lastFreeLane = free[randInt(this.rng, free.length)];

    // ~35%: a single long red wall → the lane must be changed.
    if (this.rng() < 0.35) {
      const len = 11 + this.rng() * 12; // 11..23
      this.spawnTrain(false, lane, SPAWN_Z, len);
      return len;
    }
    // Climbable chain: the first car is teal (mountable from the ground), the rest mixed
    // (teal/red) — you can jump from teal onto red too. Gap ≤ 1 jump (hoppable).
    const cars = 1 + randInt(this.rng, 3);
    const lens: number[] = [];
    for (let i = 0; i < cars; i++) lens.push(6 + this.rng() * 9); // 6..15 (short cars stay: they are the challenge)
    let front = SPAWN_Z;
    let consumed = 0;
    for (let i = 0; i < cars; i++) {
      const trampoline = i === 0 ? true : this.rng() < 0.5;
      const len = lens[i];
      this.spawnTrain(trampoline, lane, front, len);
      this.seedRoofCores(lane, front, len);
      let gap = 0;
      if (i < cars - 1) {
        // Inverse rule: the gap depends on the NEXT car's length, so a jump from the very edge of this car lands
        // at least 2 m onto the next one (landing window = [edge - (len2 - 2), edge]); still 0.45..0.9 jumps.
        const len2 = lens[i + 1];
        const gapMin = Math.max(0.45 * jumpLen, jumpLen + 2 - len2);
        const gapMax = Math.max(gapMin, Math.min(0.9 * jumpLen, jumpLen - 2));
        gap = gapMin + this.rng() * (gapMax - gapMin);
        if (len2 <= 9) this.seedJumpArc(lane, front - len, jumpLen); // short next car: tokens on the ideal jump arc invite the jump
      }
      consumed += len + gap;
      front -= len + gap;
    }
    return consumed;
  }

  /** Normal row: blocks ≤ maxBlockedLanes lanes, always leaves ≥1 free lane (±1 continuity). */
  private spawnRow(diff: ReturnType<typeof sampleDifficulty>) {
    const free = clamp(this.lastFreeLane + (randInt(this.rng, 3) - 1), 0, 2);
    this.lastFreeLane = free;
    const others = [0, 1, 2].filter((l) => l !== free);
    if (this.rng() < 0.5) others.reverse();

    const blockWeights = diff.weights.filter((w) => w.v !== 'core') as { v: SimpleType; w: number }[];
    let nBlock = 1;
    if (diff.maxBlockedLanes >= 2 && this.rng() < 0.45) nBlock = 2;
    for (let i = 0; i < nBlock; i++) {
      const type: SimpleType = blockWeights.length ? weighted<SimpleType>(this.rng, blockWeights) : 'wall';
      this.spawn(type, others[i]);
    }
    if (this.rng() < 0.5) this.spawn('core', free);
  }

  /** Generates the next road segment: alternates straight ↔ arc; D chosen to bring the heading back towards 0. */
  private newSeg(start: number, prevType: 'straight' | 'arc' | null) {
    const type = prevType === 'straight' ? 'arc' : 'straight';
    if (type === 'straight') {
      const len = STR_LEN_MIN + Math.random() * (STR_LEN_MAX - STR_LEN_MIN);
      this.seg = { type, end: start + len, R: 0, D: 0 };
    } else {
      const R = R_MIN + Math.random() * (R_MAX - R_MIN);
      const D = this.heading > 0.01 ? -1 : this.heading < -0.01 ? 1 : Math.random() < 0.5 ? -1 : 1;
      const len = ARC_LEN_MIN + Math.random() * (ARC_LEN_MAX - ARC_LEN_MIN);
      this.seg = { type, end: start + len, R, D };
    }
  }

  /** Height of the support under the player (ground=0 or a train roof). */
  private onTrainRoof = false; // the camera lifts only on trains, not on a block top
  private computeSupportY(): number {
    let s = 0;
    this.onTrainRoof = false;
    // block tops: a player arriving from above (within BLOCK_TOP_TOL) stands on the block (the box is solid), never sinks in
    const pz0 = PLAYER_Z - PLAYER_D / 2, pz1 = PLAYER_Z + PLAYER_D / 2;
    for (const o of this.pools.block) {
      if (!o.active) continue;
      const oz = o.mesh.position.z, sp = SPEC.block;
      if (!rangesOverlap(pz0, pz1, oz - sp.d / 2 - HIT_PAD_Z, oz + sp.d / 2 + HIT_PAD_Z)) continue;
      if (Math.abs(this.px - LANE_X[o.lane]) > PLAYER_W / 2 + sp.w / 2 + HIT_PAD_X) continue;
      if (this.py >= BLOCK_H - BLOCK_TOP_TOL) s = Math.max(s, BLOCK_H);
    }
    for (const o of this.trains) {
      if (!o.active) continue;
      if (Math.abs(this.px - LANE_X[o.lane]) > PLAYER_W / 2 + TRAIN_W / 2) continue;
      const cz = o.mesh.position.z;
      const half = o.len / 2;
      if (PLAYER_Z < cz - half || PLAYER_Z > cz + half) continue;
      // only if on/above the roof (a jump from the ground — 2.41 — doesn't reach 2.8-0.35)
      if (this.py >= o.roofY - ROOF_TOL) { s = Math.max(s, o.roofY); this.onTrainRoof = true; }
    }
    return s;
  }

  private resetPlayer() {
    this.targetLane = 1;
    this.px = LANE_X[1];
    this.py = 0;
    this.vy = 0;
    this.slideT = 0;
    this.coyoteT = 0;
    this.player.position.set(this.px, PLAYER_H / 2, PLAYER_Z);
    this.player.scale.set(1, 1, 1);
  }

  start() {
    // random seed (in the ghost phase we'll store it for deterministic replay)
    this.rng = mulberry32((Math.random() * 0x7fffffff) >>> 0);
    for (const type of Object.keys(this.pools) as SimpleType[]) {
      for (const o of this.pools[type]) {
        o.active = false;
        o.mesh.visible = false;
      }
    }
    for (const o of this.trains) {
      o.active = false;
      o.mesh.visible = false;
      if (o.ramp) o.ramp.visible = false;
      if (o.decor) o.decor.visible = false;
      if (o.look) o.look.visible = false;
    }
    this.supportY = 0;
    this.lastFreeLane = 1;
    this.grounds.forEach((g, i) => {
      g.position.z = DESPAWN_Z - SEGMENT_LEN / 2 - i * SEGMENT_LEN;
    });
    this.resetPlayer();
    this.speed = DIFFICULTY.stops[0].speed;
    this.burstT = 0;
    this.nextBurstScore = DIFFICULTY.bursts[0]?.fromScore ?? Infinity;
    this.elapsed = 0;
    this.score = 0;
    this.shownScore = -1;
    this.lives = 1;
    this.lifeBase = 0;
    this.lastLifeProgress = -1;
    this.respawnT = 0;
    this.frozen = false;
    this.invuln = false;
    this.shakeT = 0;
    this.character?.setOpacity(1);
    this.emitLives(true);
    this.spawnAccum = 0;
    this.nextGap = 10;
    this.camX = 0;
    this.camLift = 0;
    this.camTargetLift = 0;
    this.worldDist = 0;
    this.curK = 0;
    this.heading = 0;
    this.newSeg(0, null);
    this.pteroActive = false;
    this.pteroGroup.visible = false;
    this.pteroDelay = 3;
    this.rainOn = false;
    this.rainLevel = 0;
    this.rainTimer = 5;
    this.rain.group.visible = false;
    this.buildAccum = 0;
    this.buildSide = -1;
    this.adCountdown = [7, 9];
    this.reserveOuterX = [0, 0];
    this.reserveUntil = [0, 0];
    this.sceneryAccum = 0;
    this.scenerySide = -1;
    for (const s of this.scenery) {
      s.active = false;
      s.g.visible = false;
    }
    for (const r of this.ruins) if (r.active) { r.active = false; this.scene.remove(r.g); }
    for (const b of this.buildings) {
      b.active = false;
      b.g.visible = false;
    }
    for (const q of this.pendingBuildings) if (q.group) disposeLook(q.group);
    this.pendingBuildings.length = 0;
    // In TEST mode, if "home" (Neo-Cyberpunk) is unchecked, start directly in an allowed era.
    let startEra = 0;
    if (this.testActive() && !this.testEras[0]) startEra = this.pickAllowedEra(-1);
    this.era = startEra;
    if (startEra === 4) this.space.compose(Math.random);
    this.trans = null;
    this.deathT = 0;
    this.coreCombo = 0;
    this.comboTimer = 0;
    this.homeRollScore = ROLL_INTERVAL;
    this.excursionT = startEra !== 0 ? EXCURSION_MIN + this.rng() * (EXCURSION_MAX - EXCURSION_MIN) : 0;
    this.sfBudget = startEra === 1 || startEra === 2 ? 2 + randInt(this.rng, 3) : 0;
    this.pendingEra = -1;
    this.portal.active = false;
    this.portal.fx.close();
    this.applyEra(ERAS[startEra], ERAS[startEra], 0, 0);
    this.onEra?.(ERAS[startEra].name);
    this.character?.setState('run');
    this.state = 'playing';
    this.lastTs = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Applies the settings (live camera + difficulty multipliers). */
  applySettings(s: Settings) {
    this.camBaseY = s.camHeight;
    this.camBaseZ = s.camDistance;
    this.camLookY = s.camTilt;
    this.speedMult = s.speedMult;
    this.densityMult = s.densityMult;
    if (Array.isArray(s.testEras) && s.testEras.length === 5) this.testEras = s.testEras.slice();
    this.camera.fov = s.camFov;
    this.camera.updateProjectionMatrix();
    // reflect immediately (live preview on the start screen); in-game update() recomputes anyway
    this.camera.position.set(this.camX, this.camBaseY, this.camBaseZ);
    this.camera.lookAt(0, this.camLookY, CAM_LOOK_Z);
  }

  private loop = (ts: number) => {
    const wallDt = ts - this.lastTs; // ms, unclamped (TEST)
    const t0 = performance.now();
    const dt = clamp((ts - this.lastTs) / 1000, 0, 0.05);
    this.lastTs = ts;
    if (this.state === 'playing') this.update(dt);
    else if (this.state === 'over' && this.deathT > 0) {
      this.deathT -= dt;
      this.deathFall(dt);
      if (this.deathT <= 0) {
        this.deathT = 0;
        this.onGameOver?.(Math.floor(this.score)); // overlay after the death animation
      }
    }
    this.character?.update(dt); // keeps animating after game over too (death)
    this.render();
    // TEST: perf accounting
    const P = this.perf;
    const cpu = performance.now() - t0;
    const np = (this.renderer.info.programs?.length ?? 0);
    if (np > P.lastProg) { this.mark(`+${np - P.lastProg} shaders`); P.lastProg = np; }
    if (this.state === 'playing') { P.frames++; P.sumDt += wallDt; P.maxDt = Math.max(P.maxDt, wallDt); P.cpuMax = Math.max(P.cpuMax, cpu); if (wallDt > 33) P.over33++; }
    if (this.state === 'playing' && (wallDt > 40 || cpu > 20)) { const line = `${this.elapsed.toFixed(1)}s dt ${wallDt.toFixed(0)} cpu ${cpu.toFixed(0)} | ${P.marks.join(', ') || 'no marks (gc/gpu?)'}`; P.spikes.unshift(line); if (P.spikes.length > 7) P.spikes.pop(); if (P.log.length < 600) P.log.push(line); }
    if (this.state === 'playing') { P.sFrames++; P.sSum += wallDt; P.sMax = Math.max(P.sMax, wallDt); if (wallDt > 33) P.sOver++; if (ts > P.sumAt) { if (P.sumAt) { const a = P.sSum / Math.max(1, P.sFrames); P.log.push(`== ${this.elapsed.toFixed(0)}s avg ${(1000 / a).toFixed(0)} fps, max ${P.sMax.toFixed(0)} ms, >33ms ${P.sOver}/${P.sFrames}, shaders ${np}`); } P.sumAt = ts + 5000; P.sFrames = 0; P.sSum = 0; P.sMax = 0; P.sOver = 0; } }
    P.marks.length = 0;
    if (ts > P.flushAt) { P.flushAt = ts + 500; const avg = P.frames ? P.sumDt / P.frames : 0; this.onPerf?.(`fps ${avg ? (1000 / avg).toFixed(0) : '-'}  max ${P.maxDt.toFixed(0)}ms  cpu max ${P.cpuMax.toFixed(0)}ms  >33ms: ${P.over33}  shaders ${np}\n` + P.spikes.join('\n')); P.frames = 0; P.sumDt = 0; P.maxDt = 0; P.cpuMax = 0; }
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.elapsed += dt;
    animateVoidObstacles(this.voidObMats, this.elapsed);
    (this.convoyMats.sun as THREE.ShaderMaterial).uniforms.uTime.value = this.elapsed;

    // Core combo — decays if you don't collect for a while.
    this.comboTimer += dt;
    if (this.comboTimer > COMBO_WINDOW) this.coreCombo = 0;

    // Data-driven difficulty + temporary speed bursts (speed is otherwise quasi-flat).
    const diff = sampleDifficulty(this.score);
    const burst = DIFFICULTY.bursts[0];
    if (burst && this.score >= this.nextBurstScore) {
      this.burstT = burst.duration;
      this.nextBurstScore += burst.everyScore;
    }
    if (this.burstT > 0) this.burstT = Math.max(0, this.burstT - dt);
    this.speed = diff.speed * this.speedMult * (this.burstT > 0 && burst ? burst.mult : 1);
    // Respawn: the character stops and blinks; the world resumes as soon as the player acts, or after RESPAWN_TIME.
    if (this.respawnT > 0) {
      this.respawnT = Math.max(0, this.respawnT - dt);
      if (this.respawnT === 0 && this.frozen) {
        // No input within the time: the character stays put, another life is lost and a new interval starts.
        if (this.lives > 1) {
          this.lives--;
          this.lifeBase = this.score;
          this.respawnT = RESPAWN_TIME;
          this.onLifeLost?.(this.lives);
          this.emitLives(true);
        } else {
          this.frozen = false;
          this.invuln = false;
          this.character?.setOpacity(1);
          this.gameOver();
          return;
        }
      }
    }
    if (this.invuln) {
      const tri = Math.abs(((this.elapsed * 2) % 1) * 2 - 1); // 0..1..0 twice per second
      this.character?.setOpacity(0.1 + 0.9 * tri);
      if (this.frozen) this.resumeGrace = 0.4;
      else this.resumeGrace = Math.max(0, this.resumeGrace - dt);
    }
    // Portal shock: the world shakes for a moment after the crossing.
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
    const move = this.frozen ? 0 : this.speed * dt;
    this.overlapNow = false;

    this.worldDist += move;
    const wd = this.worldDist;
    // Road as a sequence of arcs/straights. Advance the segment; target curvature = 0 (straight) or D/R (arc).
    while (wd >= this.seg.end) this.newSeg(this.seg.end, this.seg.type);
    const targetK = this.seg.type === 'arc' ? this.seg.D / this.seg.R : 0;
    this.curK = damp(this.curK, targetK, ROAD_EASE, move); // smooth transition (clothoid)
    this.heading += this.curK * move; // accumulated heading = ∫κ → tangent angle at the character
    // Vertical curvature as an arc (uCurve.y = κ_v/2), always a crest → the horizon never rises.
    const uy = CURVE_V_BASE + CURVE_V_AMP * Math.sin(wd * CURVE_V_FREQ);
    this.curveUniform.value.set(this.curK / 2, uy); // horizontal render offset = κ/2 · dist²
    // The sky rotates with the accumulated heading — still on straights, rotates exactly by the angle on arcs.
    this.skyGroup.rotation.y = -this.heading * SKY_YAW_GAIN;
    if (this.space.group.visible) this.space.update(dt, this.elapsed, this.camera.position);

    // Invulnerability ends as soon as the world runs again and the player is clear of the obstacle.
    if (this.invuln && !this.frozen && this.resumeGrace <= 0 && !this.overlapNow) {
      this.invuln = false;
      this.respawnT = 0;
      this.character?.setOpacity(1);
    }
    this.updateAmbient(dt); // pterodactyl + rain

    // Buildings (Cyberpunk) — stop when the portal opens (the city ends at the portal)
    if (this.era === 0 && this.pendingEra < 0) {
      this.buildAccum += move;
      if (this.buildAccum >= BUILDING_GAP) {
        this.buildAccum = 0;
        this.spawnBuilding();
      }
    }
    this.processBuildingQueue();
    for (const b of this.buildings) {
      if (!b.active) continue;
      if (!b.g.visible) continue; // reserved, not placed yet
      b.g.position.z += move;
      if (b.look?.tubes) b.look.tubes.visible = b.g.position.z > -90;
      if (b.panel.visible) {
        // neon flicker: mostly steady, with short random dips
        const t = this.elapsed * 9 + (b.panel.userData.flicker as number);
        const dip = Math.sin(t) * Math.sin(t * 1.7) * Math.sin(t * 0.23) > 0.75 ? 0.45 : 1;
        (b.panel.material as THREE.MeshBasicMaterial).color.setScalar(dip * (0.92 + 0.08 * Math.sin(t * 0.5)));
      }
      if (b.g.position.z > DESPAWN_Z + 8) {
        b.active = false;
        b.g.visible = false;
      }
    }

    // Per-era side scenery (non-Cyberpunk) — stops when the portal opens.
    const scnGap = this.sceneryGap();
    if (scnGap > 0 && this.pendingEra < 0) {
      this.sceneryAccum += move;
      if (this.sceneryAccum >= scnGap) {
        this.sceneryAccum = 0;
        this.spawnScenery();
      }
    }
    for (const s of this.scenery) {
      if (!s.active) continue;
      s.g.position.z += move;
      if (s.g.position.z > DESPAWN_Z + 8) {
        s.active = false;
        s.g.visible = false;
      }
    }
    for (const r of this.ruins) {
      if (!r.active) continue;
      r.g.position.z += move;
      if (!this.frozen) r.g.rotateOnAxis(r.axis, r.w * dt);
      if (r.g.position.z > DESPAWN_Z + 40) { r.active = false; this.scene.remove(r.g); }
    }

    // Score (distance)
    this.score += move * 0.6;
    if (this.lives < MAX_LIVES && this.score >= this.lifeBase + this.lives * LIFE_STEP) {
      this.lives++;
      this.lifeBase = this.score;
      this.onLifeGained?.(this.lives);
      this.emitLives(true);
    } else this.emitLives(false);
    const s = Math.floor(this.score);
    if (s !== this.shownScore) {
      this.shownScore = s;
      this.onScore?.(s);
    }

    // Road
    const total = SEGMENT_COUNT * SEGMENT_LEN;
    for (const g of this.grounds) {
      g.position.z += move;
      if (g.position.z > DESPAWN_Z + SEGMENT_LEN / 2) g.position.z -= total;
    }

    // Spawn — gap in "jump units"; rows with guaranteed passability or a chain of trains.
    this.spawnAccum += move;
    if (this.spawnAccum >= this.nextGap) {
      this.spawnAccum = 0;
      this.generateContent();
    }

    // Player — lane; support (ground or train roof) + gravity
    this.px = damp(this.px, LANE_X[this.targetLane], LANE_LERP, dt);
    this.supportY = this.computeSupportY();
    if (this.py > this.supportY + 1e-4 || this.vy !== 0) {
      this.vy += GRAVITY * dt;
      this.py += this.vy * dt;
      if (this.py <= this.supportY) {
        this.py = this.supportY;
        this.vy = 0;
      }
    }
    // Coyote time: while on a support the grace recharges; after leaving it, there's still a short time to jump.
    if (this.py <= this.supportY + 0.06) this.coyoteT = COYOTE_TIME;
    else this.coyoteT = Math.max(0, this.coyoteT - dt);

    if (this.slideT > 0) this.slideT = Math.max(0, this.slideT - dt);
    const h = this.slideT > 0 ? PLAYER_H_SLIDE : PLAYER_H;
    this.player.position.set(this.px, this.py + h / 2, PLAYER_Z);
    this.player.scale.y = h / PLAYER_H;

    // Animated character — position + state (run/jump/slide)
    if (this.character) {
      this.character.group.position.set(this.px, this.py, PLAYER_Z);
      let st: CharState = this.frozen ? 'idle' : 'run';
      if (this.slideT > 0) st = 'slide';
      else if (this.py > this.supportY + 0.05) st = this.airborneKind ?? (this.airborneKind = this.pickJumpKind());
      else this.airborneKind = undefined;
      this.character.setState(st, JUMP_AIRTIME);
    }

    // Simple obstacles — movement, collisions, recycling
    const pz0 = PLAYER_Z - PLAYER_D / 2;
    const pz1 = PLAYER_Z + PLAYER_D / 2;
    for (const type of Object.keys(this.pools) as SimpleType[]) {
      for (const o of this.pools[type]) {
        if (!o.active) continue;
        o.mesh.position.z += move;
        if (type === 'core') {
          if (o.look) { o.mesh.rotation.y += dt * 2.2; animateToken(o.look, dt); }
          else { o.mesh.rotation.y += dt * 3; o.mesh.rotation.x += dt * 1.6; }
        } else if (o.lookVoid?.visible) animateVoidObstacle(o.lookVoid, dt);
        if (o.mesh.position.z > DESPAWN_Z) {
          o.active = false;
          o.mesh.visible = false;
          continue;
        }
        const sp = SPEC[type];
        const oz = o.mesh.position.z;
        // solidity: swept over the distance moved this frame (no first contact skipped at low fps), slightly padded
        if (!rangesOverlap(pz0, pz1, oz - sp.d / 2 - move - HIT_PAD_Z, oz + sp.d / 2 + HIT_PAD_Z)) continue;
        const xOverlap = Math.abs(this.px - LANE_X[o.lane]) < PLAYER_W / 2 + sp.w / 2 + HIT_PAD_X;
        if (!xOverlap) continue;
        if (type === 'core') { const cy = o.mesh.position.y; if (this.py + PLAYER_H < cy - 0.45 || this.py > cy + 0.45) continue; } // tokens have a height now (roof / jump arc)
        this.hit(o);
      }
    }

    // Trains — movement, collisions (trampoline/roof-running), recycling
    for (const o of this.trains) {
      if (!o.active) continue;
      o.mesh.position.z += move;
      if (o.ramp) o.ramp.position.z += move; // the ramp nose moves with the train
      if (o.decor) o.decor.position.z += move; // the sci-fi decor moves with the train
      if (o.look) o.look.position.z += move;
      const cz = o.mesh.position.z;
      const half = o.len / 2;
      if (cz - half > DESPAWN_Z) {
        o.active = false;
        o.mesh.visible = false;
        if (o.ramp) o.ramp.visible = false;
        if (o.decor) o.decor.visible = false;
        if (o.look) o.look.visible = false;
        continue;
      }
      if (Math.abs(this.px - LANE_X[o.lane]) > PLAYER_W / 2 + TRAIN_W / 2) continue;
      if (PLAYER_Z < cz - half || PLAYER_Z > cz + half) continue;
      // The player is within the train's footprint in its lane.
      if (this.py >= o.roofY - ROOF_TOL) continue; // on/above the roof → passes over (any type)
      if (o.trampoline && this.py > AIR_MARGIN) {
        this.py = o.roofY; // teal + jumping → the trampoline launches the player onto the roof
        this.vy = 0;
      } else {
        this.crash(o); // red from the ground, or teal hit without jumping → crash
      }
    }

    // Eras — scheduling the switch (only if a portal isn't already in flight)
    if (this.pendingEra < 0) {
      if (this.testActive()) {
        // TEST MODE: bounce ONLY between the checked eras (the portal mechanism stays unchanged).
        // A single checked era → pickAllowedEra returns the current era → no portal (stay).
        // Cadence: at home on the score die, excursions on a timer (as in the normal game).
        if (this.era === 0) {
          if (this.score >= this.homeRollScore) {
            this.homeRollScore += ROLL_INTERVAL;
            const next = this.pickAllowedEra(0);
            if (next !== 0) this.openPortal(next);
          }
        } else {
          this.excursionT -= dt;
          if (this.excursionT <= 0) {
            const next = this.pickAllowedEra(this.era);
            if (next !== this.era) this.openPortal(next);
            else this.excursionT = EXCURSION_MIN + this.rng() * (EXCURSION_MAX - EXCURSION_MIN); // re-arm
          }
        }
      } else if (this.era === 0) {
        // home (Neo-Cyberpunk): a die roll every ROLL_INTERVAL points
        if (this.score >= this.homeRollScore) {
          this.homeRollScore += ROLL_INTERVAL;
          const target = this.rollEra();
          if (target !== 0) this.openPortal(target);
        }
      } else {
        // on an excursion: count down, then a portal back home
        this.excursionT -= dt;
        if (this.excursionT <= 0) this.openPortal(0);
      }
    }

    // Portal — movement + triggering the morph when it passes the player
    if (this.portal.active) {
      this.portal.mesh.position.z += move;
      this.portal.fx.update(dt, Math.random);
      if (!this.portal.crossed && this.portal.mesh.position.z >= PLAYER_Z) {
        this.portal.crossed = true;
        this.shakeT = SHAKE_DUR;
        this.trans = { from: this.era, to: this.pendingEra, t: 0 };
        this.onEra?.(ERAS[this.pendingEra].name);
      }
      if (this.portal.mesh.position.z > DESPAWN_Z + 3) {
        this.portal.active = false;
        this.portal.fx.close();
      }
    }

    // Short palette morph, no shaking (the portal is the show)
    if (this.trans) {
      this.trans.t += dt;
      const mix = clamp(this.trans.t / MORPH_DUR, 0, 1);
      const flash = Math.sin(mix * Math.PI) * 0.35;
      this.applyEra(ERAS[this.trans.from], ERAS[this.trans.to], mix, flash);
      if (mix >= 1) {
        this.era = this.trans.to;
        this.trans = null;
        this.pendingEra = -1;
        if (this.era !== 0) this.excursionT = EXCURSION_MIN + this.rng() * (EXCURSION_MAX - EXCURSION_MIN);
        else this.homeRollScore = this.score + ROLL_INTERVAL; // avoids an immediate re-roll on return
        // Sci-fi intrusions: small budget per historical excursion (accidental appearance, ~3, not the norm).
        this.sfBudget = this.era === 1 || this.era === 2 ? 2 + randInt(this.rng, 3) : 0;
      }
    }

    // The camera follows smoothly sideways; the base comes from settings (adjustable live).
    // Rises with the support (the train roof), not with every jump → the framing stays fixed.
    this.camX = damp(this.camX, this.px * 0.35, 6, dt);
    // Target level: on a roof it rises; in the air (hop between trains) it STAYS; lowers only on the ground.
    if (this.supportY > 0 && this.onTrainRoof) this.camTargetLift = this.supportY;
    else if (this.py <= 0.1) this.camTargetLift = 0;
    this.camLift = damp(this.camLift, this.camTargetLift, 8, dt);
    this.camera.position.set(this.camX, this.camBaseY + this.camLift, this.camBaseZ);
    this.camera.lookAt(0, this.camLookY + this.camLift, CAM_LOOK_Z);
    if (this.shakeT > 0) {
      // world shake on the portal crossing: random jolts that die out over SHAKE_DUR
      const k = (this.shakeT / SHAKE_DUR) * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.camera.rotation.z += (Math.random() - 0.5) * k * 0.25;
    }
  }

  private hit(o: Ob) {
    if (o.type === 'core') {
      o.active = false;
      o.mesh.visible = false;
      this.coreCombo++;
      this.comboTimer = 0;
      const mult = Math.min(MAX_MULT, 1 + Math.floor(this.coreCombo / 5));
      const value = CORE_SCORE * mult;
      this.score += value;
      const v = this.tmpV.copy(o.mesh.position).project(this.camera); // where the token was on screen → the popup rises from there
      this.onCore?.(value, mult, (v.x + 1) / 2 * window.innerWidth, (1 - v.y) / 2 * window.innerHeight, this.speed / BASE_SPEED);
      return;
    }
    let cleared = false;
    if (o.type === 'block') cleared = this.py >= BLOCK_H + FEET_MARGIN || (this.supportY >= BLOCK_H && this.py >= BLOCK_H - 1e-3); // jumped over with air under the feet, or standing on it
    else if (o.type === 'overhead') cleared = this.slideT > 0; // slid underneath
    else if (o.type === 'wall') cleared = false; // change lane
    if (!cleared) this.crash(o);
  }

  /** A lethal collision: ignored while invulnerable, costs a life while there are spare ones, otherwise game over. */
  private crash(o: Ob) {
    if (this.state !== 'playing') return;
    if (this.invuln) {
      this.overlapNow = true; // still touching the obstacle that cost the life → not punished again
      return;
    }
    if (this.lives > 1) {
      this.lives--;
      this.lifeBase = this.score;
      this.respawnT = RESPAWN_TIME;
      this.frozen = true;
      this.invuln = true;
      this.slideT = 0;
      // Step the world back so the character stands just in front of what it hit (visible, not inside it).
      const front = o.type === 'trainRide' || o.type === 'trainBlock' ? o.mesh.position.z + o.len / 2 : o.mesh.position.z + SPEC[o.type as SimpleType].d / 2;
      const want = PLAYER_Z - PLAYER_D / 2 - 0.5; // the obstacle's front face ends up half a unit ahead of the player
      if (front > want) this.shiftWorld(want - front);
      this.onLifeLost?.(this.lives);
      this.emitLives(true);
      return;
    }
    this.gameOver();
  }

  /** Moves every scrolling world object by dz (negative = away from the player). Used once per crash. */
  private shiftWorld(dz: number) {
    for (const type of Object.keys(this.pools) as SimpleType[]) for (const o of this.pools[type]) if (o.active) o.mesh.position.z += dz;
    for (const o of this.trains) {
      if (!o.active) continue;
      o.mesh.position.z += dz;
      if (o.ramp) o.ramp.position.z += dz;
      if (o.decor) o.decor.position.z += dz;
      if (o.look) o.look.position.z += dz;
    }
    for (const b of this.buildings) if (b.active) b.g.position.z += dz;
    for (const sc of this.scenery) if (sc.active) sc.g.position.z += dz;
    for (const g of this.grounds) g.position.z += dz;
    if (this.portal.active) this.portal.mesh.position.z += dz;
  }

  private emitLives(force: boolean) {
    const need = this.lives * LIFE_STEP;
    const progress = this.lives >= MAX_LIVES ? 1 : clamp((this.score - this.lifeBase) / need, 0, 1);
    if (force || Math.abs(progress - this.lastLifeProgress) >= 0.01) {
      this.lastLifeProgress = progress;
      this.onLives?.(this.lives, progress);
    }
  }

  private gameOver() {
    if (this.state !== 'playing') return;
    this.state = 'over';
    // A body that dies in the air keeps falling: onto the roof it was standing on, otherwise to the ground.
    this.deathFloor = this.supportY > 0 && this.py <= this.supportY + 0.1 ? this.supportY : 0;
    this.deathBack = 0;
    this.character?.setState('dead');
    this.deathT = DEATH_DELAY; // the overlay appears after the collapse is visible
  }

  /** Death physics: gravity until the body rests on its floor, and an ease-back so the collapse clears the obstacle. */
  private deathFall(dt: number) {
    if (this.py > this.deathFloor) {
      this.vy += GRAVITY * dt;
      this.py = Math.max(this.deathFloor, this.py + this.vy * dt);
    } else {
      this.vy = 0;
    }
    this.deathBack = damp(this.deathBack, DEATH_BACK, 8, dt);
    this.player.position.set(this.px, this.py + PLAYER_H / 2, PLAYER_Z);
    this.character?.group.position.set(this.px, this.py, PLAYER_Z + this.deathBack);
  }

  // --- Input ---
  /** The era a newly spawned object belongs to: while a portal is open ahead (not yet crossed) or the palette
   * is still morphing, everything spawned at the horizon is already on the other side → destination era. */
  private spawnEra(): number {
    if (this.trans) return this.trans.to;
    if (this.portal.active && !this.portal.crossed && this.pendingEra >= 0) return this.pendingEra;
    return this.era;
  }

  /** What the jump is for: a climbable train nose ahead → tuck; a low block ahead → run-and-jump; else plain. */
  private pickJumpKind(): CharState {
    const reach = this.speed * JUMP_AIRTIME * 1.15 + 2; // distance the world travels during one jump
    const lane = this.targetLane;
    for (const o of this.trains) {
      if (!o.active || !o.trampoline || o.lane !== lane) continue;
      const frontZ = o.mesh.position.z + o.len / 2;
      if (frontZ < PLAYER_Z + 1 && frontZ > PLAYER_Z - reach) return 'jumpTrain';
    }
    for (const o of this.pools.block) {
      if (!o.active || o.lane !== lane) continue;
      const z = o.mesh.position.z;
      if (z < PLAYER_Z + 1 && z > PLAYER_Z - reach) return 'jumpObstacle';
    }
    return 'jump';
  }

  private moveLane(d: number) {
    this.mark('lane');
    this.targetLane = clamp(this.targetLane + d, 0, 2);
    this.frozen = false;
  }
  private jump() {
    // jumps from the ground/roof OR within the grace window (coyote) after leaving the edge
    if (this.py <= this.supportY + 0.06 || this.coyoteT > 0) {
      this.mark('jump');
      this.vy = JUMP_V;
      this.coyoteT = 0;
    }
    this.frozen = false;
  }
  private slide() {
    this.slideT = SLIDE_TIME;
    this.frozen = false;
    if (this.py > this.supportY + 0.01) this.vy = -JUMP_V; // drops fast if airborne
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.state !== 'playing') return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.moveLane(-1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.moveLane(1);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') this.jump();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') this.slide();
    else return;
    e.preventDefault();
  };

  private onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    this.touch = { x: t.clientX, y: t.clientY };
  };
  private onTouchMove = (e: TouchEvent) => {
    if (!this.touch || this.state !== 'playing') return;
    const t = e.touches[0];
    const dx = t.clientX - this.touch.x;
    const dy = t.clientY - this.touch.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const TH_X = 60; // horizontal: longer swipe (the object doesn't "run away" from the finger)
    const TH_Y = 30; // vertical: jump/slide stay snappy

    if (adx > ady) {
      // Horizontal: one lane at a time; a second only if the swipe continues after the cooldown.
      if (adx < TH_X) return;
      e.preventDefault();
      const now = performance.now();
      if (now - this.lastLaneSwipe < 250) return; // still in cooldown — do NOT re-arm (we keep the accumulation)
      this.moveLane(dx > 0 ? 1 : -1);
      this.lastLaneSwipe = now;
      this.touch = { x: t.clientX, y: t.clientY };
    } else {
      // Vertical: instant.
      if (ady < TH_Y) return;
      e.preventDefault();
      if (dy < 0) this.jump();
      else this.slide();
      this.touch = { x: t.clientX, y: t.clientY };
    }
  };
  private onTouchEnd = () => {
    this.touch = null;
  };

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private render() {
    this.composer.render();
  }
}
