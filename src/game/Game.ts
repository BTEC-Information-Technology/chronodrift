import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  BLOCK_H,
  CORE_SCORE,
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
import { CharacterController } from './character';
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
const MORPH_DUR = 0.5; // short palette morph when passing through the portal (no shaking)
const PORTAL_Y = 2.2; // height of the portal ring's centre

// Trains (Increment B)
const TRAIN_W = 1.9; // width within a lane
const TRAIN_H = 2.8; // BOTH types — same height; the roof is traversable on both
const ROOF_TOL = 0.35; // "on the roof" tolerance (support + crash immunity)
const AIR_MARGIN = 0.4; // above this height the player counts as "jumping" → the trampoline catches them
const RAMP_LEN = 3.6; // length of the ramp nose in front of a climbable train (slope towards the player)
const COYOTE_TIME = 0.18; // grace: you can still jump briefly after leaving the support
const DEATH_DELAY = 1.3; // delay before the overlay, so the death animation is visible
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
  private grounds: THREE.Group[] = [];
  private pools: Record<SimpleType, Ob[]> = { block: [], overhead: [], wall: [], core: [] };
  private geo: Record<SimpleType, THREE.BufferGeometry>;
  private mat: Record<SimpleType, THREE.MeshStandardMaterial>;

  // Trains (separate pool — variable-length geometry)
  private trains: Ob[] = [];
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
  private lineMat!: THREE.MeshStandardMaterial;
  private fog!: THREE.Fog;
  private skyUniforms!: { uTop: { value: THREE.Color }; uHorizon: { value: THREE.Color } };
  private starMat!: THREE.PointsMaterial;
  private skyGroup!: THREE.Group; // sky + stars (turns with the curve)
  private planetGroup!: THREE.Group; // planet fragments (Unknown Future only)
  private planetMat!: THREE.MeshStandardMaterial;
  private planets: THREE.Mesh[] = [];

  // Ambient: pterodactyl (silhouette) + temporary rain
  private pteroGroup!: THREE.Group;
  private pteroLWing!: THREE.Mesh;
  private pteroRWing!: THREE.Mesh;
  private pteroActive = false;
  private pteroProg = 0;
  private pteroStartX = 0;
  private pteroDelay = 3;
  private rainPoints!: THREE.Points;
  private rainMat!: THREE.PointsMaterial;
  private rainPos!: Float32Array;
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
  private adMats: THREE.MeshBasicMaterial[] = []; // materials for the billboards on buildings
  private buildings: { g: THREE.Group; box: THREE.Mesh; panel: THREE.Mesh; active: boolean }[] = [];
  private buildAccum = 0;
  private buildSide = -1;
  private buildGeo = new THREE.BoxGeometry(1, 1, 1);
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
  private scnVoidMat!: THREE.MeshStandardMaterial;
  private scnVoidNeon!: THREE.MeshStandardMaterial;
  // Wide side ground (per era) the scenery stands on — otherwise buildings look like they float.
  private terrainMat!: THREE.MeshStandardMaterial;
  private terrains: THREE.Mesh[] = [];

  // Eras & portal transition
  private era = 0; // current era (0 = Neo-Cyberpunk, "home")
  private trans: { from: number; to: number; t: number } | null = null; // palette morph
  private homeRollScore = ROLL_INTERVAL; // next die-roll threshold (while at home)
  private excursionT = 0; // time left in a special era
  private pendingEra = -1; // era the portal is open towards (-1 = none)
  private testEras = [true, true, true, true, true]; // TEST: allowed eras (see settings.testEras)
  private sfBudget = 0; // how many sci-fi intrusions (decorated trains) may still appear in the current excursion
  private portal!: { mesh: THREE.Mesh; active: boolean; crossed: boolean };
  private portalMat!: THREE.MeshStandardMaterial;
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
  onCore?: (value: number, mult: number) => void; // bonus + multiplier on pickup

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = new THREE.Color(0x05010f);
    this.fog = new THREE.Fog(0x0a0420, 30, 250);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(64, 1, 0.1, 360);
    this.camera.position.set(0, this.camBaseY, this.camBaseZ);
    this.camera.lookAt(0, this.camLookY, CAM_LOOK_Z);

    this.hemi = new THREE.HemisphereLight(0x6688ff, 0x140022, 1.0);
    this.scene.add(this.hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(3, 8, 4);
    this.scene.add(dir);
    this.buildSky();
    this.buildAmbient();
    this.buildBackdrops();
    this.buildCyberBackdrop();

    // Player
    this.pMat = new THREE.MeshStandardMaterial({ color: 0x031018, emissive: 0x00eaff, emissiveIntensity: 0.7, roughness: 0.5 });
    this.player = new THREE.Mesh(new THREE.BoxGeometry(PLAYER_W, PLAYER_H, PLAYER_D), this.pMat);
    this.scene.add(this.player);

    // Animated character (CC0 placeholder). The box stays as a fallback until the model loads.
    this.character = new CharacterController(
      '/models/RobotExpressive.glb',
      { run: 'Running', jump: 'Jump', slide: 'Sitting', dead: 'Death' },
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
    this.trainBlockMat = this.emissiveMat(TRAIN_BLOCK_COLOR, 0.4, true);
    this.trainRideMat = this.emissiveMat(TRAIN_RIDE_COLOR, 0.5, true);
    // Lush vegetation (Prehistoric) and damaged metal debris (Ancient) on the train.
    this.trainVegMat = new THREE.MeshStandardMaterial({ color: 0x2f7a2c, emissive: 0x0e3a0c, emissiveIntensity: 0.5, roughness: 0.8, metalness: 0.05, flatShading: true });
    this.trainSfMat = new THREE.MeshStandardMaterial({ color: 0x141820, emissive: 0x3a6a7a, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.4, flatShading: true });

    // Era-change portal — a ring spanning all lanes, telegraphed from the front.
    this.portalMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x00eaff, emissiveIntensity: 1.5, roughness: 0.4, metalness: 0.3 });
    const portalMesh = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.28, 12, 36), this.portalMat);
    portalMesh.visible = false;
    this.scene.add(portalMesh);
    this.portal = { mesh: portalMesh, active: false, crossed: false };

    this.buildTrack();
    this.buildBuildings();
    this.buildScenery();
    this.enableCurve();
    this.resetPlayer();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    this.onResize();
    this.render();
  }

  private emissiveMat(color: number, intensity: number, flat = false): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: color, emissiveIntensity: intensity, roughness: 0.6, metalness: 0.2, flatShading: flat });
  }

  /** Injects the world curvature into a material's vertex shader (offset × distance² in view space). */
  private applyCurveShader(mat: THREE.Material) {
    mat.onBeforeCompile = (shader) => {
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
      this.trainBlockMat, this.trainRideMat, this.trainVegMat, this.trainSfMat, this.portalMat,
      ...this.adMats, ...this.buildMats, ...this.buildLineMats, ...this.sceneryMats, this.terrainMat,
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
    set(this.lineMat.emissive, from.line, to.line, flash * 0.4);
    set(this.pMat.emissive, from.player, to.player, flash * 0.3);
    set(this.mat.block.emissive, from.block, to.block, flash * 0.3);
    set(this.mat.overhead.emissive, from.overhead, to.overhead, flash * 0.3);
    set(this.mat.wall.emissive, from.wall, to.wall, flash * 0.3);
    set(this.mat.core.emissive, from.core, to.core, flash * 0.3);
    // Sky + stars
    set(this.skyUniforms.uTop.value, from.skyTop, to.skyTop, flash * 0.2);
    set(this.skyUniforms.uHorizon.value, from.skyHorizon, to.skyHorizon, flash * 0.4);
    this.starMat.opacity = lerp(from.starOpacity, to.starOpacity, mix);
    // Semi-transparent road (void below) + planet fragments — Unknown Future only
    this.groundMat.opacity = lerp(from.groundOpacity, to.groundOpacity, mix);
    this.groundMat.transparent = this.groundMat.opacity < 0.99;
    this.planetMat.opacity = lerp(from.planetOpacity, to.planetOpacity, mix);
    this.planetGroup.visible = this.planetMat.opacity > 0.01;
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
    // If leaving Cyberpunk → clear the city BEYOND the portal (the new era starts there).
    if (this.era === 0 && target !== 0) {
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
    this.pendingEra = target;
    this.portal.active = true;
    this.portal.crossed = false;
    this.portal.mesh.visible = true;
    this.portal.mesh.position.set(0, PORTAL_Y, SPAWN_Z);
    this.portalMat.emissive.set(ERAS[target].railL); // tint towards the destination colour
  }

  /** Sky dome with a gradient (zenith→horizon) + star field (opacity per era). */
  private buildSky() {
    this.skyGroup = new THREE.Group();
    this.scene.add(this.skyGroup);
    this.skyUniforms = {
      uTop: { value: new THREE.Color(ERAS[0].skyTop) },
      uHorizon: { value: new THREE.Color(ERAS[0].skyHorizon) },
    };
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyUniforms,
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vPos;
        void main(){ float h = normalize(vPos).y; float t = clamp(h * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(0.5, 0.72, t)), 1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat);
    sky.renderOrder = -2;
    this.skyGroup.add(sky);

    // Stars
    const N = 900;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 270;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: ERAS[0].starOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.renderOrder = -1;
    this.skyGroup.add(stars);

    // Drifting planet fragments (visible only in Unknown Future)
    this.planetGroup = new THREE.Group();
    this.planetGroup.visible = false;
    this.skyGroup.add(this.planetGroup);
    this.planetMat = new THREE.MeshStandardMaterial({
      color: 0x1a2340,
      emissive: 0x4a6aff,
      emissiveIntensity: 0.35,
      roughness: 0.85,
      flatShading: true,
      transparent: true,
      opacity: 0,
      fog: false,
    });
    const defs = [
      { r: 22, x: -30, y: 52, z: -120 }, // top-left, large
      { r: 13, x: 42, y: 60, z: -130 }, // top-right
      { r: 9, x: 6, y: 42, z: -98 }, // top-centre, small
      { r: 24, x: 20, y: -28, z: -125 }, // bottom (through the void), large
      { r: 11, x: -34, y: -20, z: -100 }, // bottom-left (through the void)
    ];
    for (const d of defs) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(d.r, 1), this.planetMat);
      m.position.set(d.x, d.y, d.z);
      m.userData.base = { x: d.x, y: d.y, z: d.z };
      this.planetGroup.add(m);
      this.planets.push(m);
    }
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

    // Rain — falling particles around the player
    const N = 400;
    this.rainPos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.rainPos[i * 3] = -11 + Math.random() * 22;
      this.rainPos[i * 3 + 1] = Math.random() * 20;
      this.rainPos[i * 3 + 2] = -26 + Math.random() * 34;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.PointsMaterial({ color: 0xaad4ff, size: 0.14, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.rainPoints = new THREE.Points(rg, this.rainMat);
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
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
    const boxMats = [0x244a9a, 0x4a2a8a, 0x1a6a9a, 0x3a2a7a].map((c) => new THREE.MeshBasicMaterial({ color: c, fog: false }));
    const edgeMats = [0x6ae6ff, 0xff7ae0, 0x7af0ff].map((c) => new THREE.LineBasicMaterial({ color: c }));
    const edges = new THREE.EdgesGeometry(this.buildGeo);
    const N = 76;
    const R = 230;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const w = 16 + Math.random() * 12;
      const h = 50 + Math.random() * 70;
      const box = new THREE.Mesh(this.buildGeo, boxMats[i % boxMats.length]);
      box.scale.set(w, h, 6);
      box.position.set(Math.sin(ang) * R, h / 2 - 35, -Math.cos(ang) * R); // base below the horizon
      box.rotation.y = -ang; // width tangent to the ring → continuous skyline
      box.add(new THREE.LineSegments(edges, edgeMats[i % edgeMats.length]));
      this.cyberBackdrop.add(box);
    }
  }

  /** Buildings (boxes) with neon edges + billboards on facades, the Cyberpunk city. */
  private buildBuildings() {
    this.adMats = [0x00eaff, 0xff36c8, 0xffd23a, 0x7eff9a].map((c) => new THREE.MeshBasicMaterial({ color: c }));
    const defs = [
      { c: 0x0e1428, e: 0x1e58b0, line: 0x33e6ff },
      { c: 0x1c1230, e: 0x6a1ea0, line: 0xff5ad8 },
      { c: 0x0e1c34, e: 0x1a6a96, line: 0x5af0ff },
    ];
    this.buildMats = defs.map((m) => new THREE.MeshStandardMaterial({ color: m.c, emissive: m.e, emissiveIntensity: 1.5, roughness: 0.75, metalness: 0.2, flatShading: true }));
    this.buildLineMats = defs.map((m) => new THREE.LineBasicMaterial({ color: m.line }));
    const edges = new THREE.EdgesGeometry(this.buildGeo);
    const panelGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 40; i++) {
      const k = i % defs.length;
      const g = new THREE.Group();
      const box = new THREE.Mesh(this.buildGeo, this.buildMats[k]);
      box.add(new THREE.LineSegments(edges, this.buildLineMats[k])); // neon edges (scale with the box)
      g.add(box);
      const panel = new THREE.Mesh(panelGeo, this.adMats[i % this.adMats.length]);
      panel.visible = false;
      g.add(panel);
      g.visible = false;
      this.scene.add(g);
      this.buildings.push({ g, box, panel, active: false });
    }
  }

  private nextBuilding() {
    return this.buildings.find((x) => !x.active) ?? null;
  }

  /** Positions and activates a building (with/without a full-facade billboard). */
  private placeBuilding(b: { g: THREE.Group; box: THREE.Mesh; panel: THREE.Mesh; active: boolean }, x: number, z: number, w: number, topH: number, d: number, ad: boolean) {
    b.active = true;
    b.g.visible = true;
    b.box.scale.set(w, topH + 25, d); // +25 below the horizon → no sky underneath
    b.box.position.set(0, (topH - 25) / 2, 0);
    b.g.position.set(x, 0, z);
    if (ad) {
      b.panel.visible = true;
      b.panel.material = this.adMats[(Math.random() * this.adMats.length) | 0];
      b.panel.scale.set(w * 0.92, topH * 0.92, 1);
      b.panel.position.set(0, topH * 0.5, d / 2 + 0.2);
    } else {
      b.panel.visible = false;
    }
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
    this.placeBuilding(b, side * (xInner + w / 2), BUILD_SPAWN_Z - Math.random() * 12, w, topH, d, false);
  }

  /** Billboard block: the billboard building sits right next to the road; the guards fill the lateral gap between
   * it and the fillers (contiguous row outwards), and the billboard↔guards corridor is RESERVED —
   * no filler between the guards and the road while the billboard is still in the scene. */
  private spawnAdBlock(side: number) {
    const s = side > 0 ? 1 : 0;
    const zAd = BUILD_SPAWN_Z - Math.random() * 8; // the billboard, further away (towards the horizon)
    const adW = 13 + Math.random() * 5;
    const adB = this.nextBuilding();
    if (adB) this.placeBuilding(adB, side * (adW / 2 + 8), zAd, adW, 26 + Math.random() * 12, 8 + Math.random() * 6, true);
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
      this.placeBuilding(gb, side * (x + gw / 2), zAd + 6 + j * 4, gw, 30 + Math.random() * 28, 8 + Math.random() * 6, false);
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
    this.scnVoidMat = mat(0x23234a, 0x14143a, 0.5, 0.5, 0.4);
    this.scnVoidNeon = mat(0x0a0a18, 0x8ad8ff, 1.4, 0.4, 0.3);
    this.sceneryMats.push(this.scnTrunkMat, this.scnLeafA, this.scnLeafB, this.scnRockMat, this.scnMarbleMat, this.scnGoldMat, this.scnEcoMat, this.scnSolarMat, this.scnVoidMat, this.scnVoidNeon);
  }

  /** How often side scenery appears in the current era (0 = era with no scenery configured yet). */
  private sceneryGap(): number {
    if (this.era === 1) return 3; // Prehistoric — dense jungle
    if (this.era === 2) return 6; // Ancient — columns/statues/buildings (sacred way)
    if (this.era === 3) return 5.5; // Solarpunk — eco-towers/panels/hedges
    if (this.era === 4) return 20; // Unknown Future — sparse monoliths/platforms (desolate)
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
    else if (this.era === 4) this.composeVoid(s);
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

  /** Unknown Future: fractured monolith or fragmented platform, floating in the void + neon accent. */
  private composeVoid(s: { box: THREE.Mesh; post: THREE.Mesh; blobA: THREE.Mesh; blobB: THREE.Mesh }) {
    const driftY = 2 + Math.random() * 9; // floating (there is no ground — it's space)
    s.box.visible = true;
    s.box.material = this.scnVoidMat;
    if (Math.random() < 0.5) {
      // Fractured monolith (tall, thin, tilted).
      const w = 1.4 + Math.random() * 1.8;
      const h = 6 + Math.random() * 9;
      const d = 1.4 + Math.random() * 1.8;
      s.box.scale.set(w, h, d);
      s.box.position.set(0, driftY, 0);
      s.box.rotation.set((Math.random() - 0.5) * 0.9, Math.random() * 3, (Math.random() - 0.5) * 0.9);
    } else {
      // Fragmented platform (wide, flat, tilted).
      const w = 4 + Math.random() * 5;
      const h = 0.6 + Math.random() * 0.8;
      const d = 3 + Math.random() * 4;
      s.box.scale.set(w, h, d);
      s.box.position.set(0, driftY, 0);
      s.box.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * 3, (Math.random() - 0.5) * 0.6);
    }
    // Floating neon accent (shard of light) next to the fragment.
    if (Math.random() < 0.75) {
      s.blobA.visible = true;
      s.blobA.material = this.scnVoidNeon;
      s.blobA.scale.setScalar(0.4 + Math.random() * 0.7);
      s.blobA.position.set((Math.random() - 0.5) * 4, driftY + (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 4);
      s.blobA.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    }
  }

  /** Animates the pterodactyl (Prehistoric/Solarpunk) and the temporary rain (Cyberpunk). */
  private updateAmbient(dt: number) {
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
    this.rainLevel = damp(this.rainLevel, target, 1.2, dt);
    this.rainMat.opacity = this.rainLevel * 0.5;
    if (this.rainLevel < 0.01) {
      this.rainPoints.visible = false;
    } else {
      this.rainPoints.visible = true;
      this.rainPoints.position.x = this.camX;
      for (let i = 1; i < this.rainPos.length; i += 3) {
        this.rainPos[i] -= dt * 42;
        if (this.rainPos[i] < 0) this.rainPos[i] += 20;
      }
      (this.rainPoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private buildTrack() {
    const groundGeo = new THREE.BoxGeometry(TRACK_HALF_W * 2, 0.5, SEGMENT_LEN);
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x0b0820, roughness: 0.9, emissive: 0x0a0526, emissiveIntensity: 0.4, transparent: true });
    const railGeo = new THREE.BoxGeometry(0.16, 0.5, SEGMENT_LEN);
    this.railLMat = this.emissiveMat(0x00eaff, 1.2);
    this.railRMat = this.emissiveMat(0xff36c8, 1.2);
    const lineGeo = new THREE.BoxGeometry(0.06, 0.02, SEGMENT_LEN);
    this.lineMat = this.emissiveMat(0x3344aa, 0.8);
    // Wide side ground (the scenery stands on it); hidden by default, enabled per era in update.
    const terrainGeo = new THREE.BoxGeometry(140, 0.5, SEGMENT_LEN);
    this.terrainMat = new THREE.MeshStandardMaterial({ color: 0x18301a, roughness: 1, metalness: 0, flatShading: true });

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const g = new THREE.Group();
      const terrain = new THREE.Mesh(terrainGeo, this.terrainMat);
      terrain.position.y = -0.4; // slightly below the road, so the road stays on top
      terrain.visible = false;
      g.add(terrain);
      this.terrains.push(terrain);
      const ground = new THREE.Mesh(groundGeo, this.groundMat);
      ground.position.y = -0.25;
      g.add(ground);
      const rl = new THREE.Mesh(railGeo, this.railLMat);
      rl.position.set(-TRACK_HALF_W, 0.25, 0);
      g.add(rl);
      const rr = new THREE.Mesh(railGeo, this.railRMat);
      rr.position.set(TRACK_HALF_W, 0.25, 0);
      g.add(rr);
      for (const x of [-1.1, 1.1]) {
        const line = new THREE.Mesh(lineGeo, this.lineMat);
        line.position.set(x, 0.02, 0);
        g.add(line);
      }
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
      this.pools[type].push(ob);
      this.scene.add(mesh);
    }
    ob.lane = lane;
    ob.active = true;
    ob.mesh.visible = true;
    ob.mesh.position.set(LANE_X[lane], yOverride ?? SPEC[type].y, zOverride ?? SPAWN_Z);
    ob.mesh.rotation.set(0, 0, 0);
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
    let front = SPAWN_Z;
    let consumed = 0;
    for (let i = 0; i < cars; i++) {
      const trampoline = i === 0 ? true : this.rng() < 0.5;
      const len = 6 + this.rng() * 9; // 6..15
      this.spawnTrain(trampoline, lane, front, len);
      this.seedRoofCores(lane, front, len);
      const gap = i < cars - 1 ? jumpLen * (0.45 + this.rng() * 0.45) : 0; // 0.45..0.9 jump
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
  private computeSupportY(): number {
    let s = 0;
    for (const o of this.trains) {
      if (!o.active) continue;
      if (Math.abs(this.px - LANE_X[o.lane]) > PLAYER_W / 2 + TRAIN_W / 2) continue;
      const cz = o.mesh.position.z;
      const half = o.len / 2;
      if (PLAYER_Z < cz - half || PLAYER_Z > cz + half) continue;
      // only if on/above the roof (a jump from the ground — 2.41 — doesn't reach 2.8-0.35)
      if (this.py >= o.roofY - ROOF_TOL) s = Math.max(s, o.roofY);
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
    this.rainPoints.visible = false;
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
    for (const b of this.buildings) {
      b.active = false;
      b.g.visible = false;
    }
    // In TEST mode, if "home" (Neo-Cyberpunk) is unchecked, start directly in an allowed era.
    let startEra = 0;
    if (this.testActive() && !this.testEras[0]) startEra = this.pickAllowedEra(-1);
    this.era = startEra;
    this.trans = null;
    this.deathT = 0;
    this.coreCombo = 0;
    this.comboTimer = 0;
    this.homeRollScore = ROLL_INTERVAL;
    this.excursionT = startEra !== 0 ? EXCURSION_MIN + this.rng() * (EXCURSION_MAX - EXCURSION_MIN) : 0;
    this.sfBudget = startEra === 1 || startEra === 2 ? 2 + randInt(this.rng, 3) : 0;
    this.pendingEra = -1;
    this.portal.active = false;
    this.portal.mesh.visible = false;
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
    const dt = clamp((ts - this.lastTs) / 1000, 0, 0.05);
    this.lastTs = ts;
    if (this.state === 'playing') this.update(dt);
    else if (this.state === 'over' && this.deathT > 0) {
      this.deathT -= dt;
      if (this.deathT <= 0) {
        this.deathT = 0;
        this.onGameOver?.(Math.floor(this.score)); // overlay after the death animation
      }
    }
    this.character?.update(dt); // keeps animating after game over too (death)
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.elapsed += dt;

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
    const move = this.speed * dt;

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
    // Slow drift of the planet fragments (Unknown Future): rotation + floating
    if (this.planetGroup.visible) {
      for (let i = 0; i < this.planets.length; i++) {
        const p = this.planets[i];
        p.rotation.y += dt * 0.05;
        p.rotation.x += dt * 0.02;
        const b = p.userData.base as { x: number; y: number; z: number };
        p.position.x = b.x + Math.sin(this.elapsed * 0.05 + i) * 5;
        p.position.y = b.y + Math.cos(this.elapsed * 0.04 + i * 1.3) * 3;
      }
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
    for (const b of this.buildings) {
      if (!b.active) continue;
      b.g.position.z += move;
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

    // Score (distance)
    this.score += move * 0.6;
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
      let st: 'run' | 'jump' | 'slide' = 'run';
      if (this.slideT > 0) st = 'slide';
      else if (this.py > this.supportY + 0.05) st = 'jump';
      this.character.setState(st);
    }

    // Simple obstacles — movement, collisions, recycling
    const pz0 = PLAYER_Z - PLAYER_D / 2;
    const pz1 = PLAYER_Z + PLAYER_D / 2;
    for (const type of Object.keys(this.pools) as SimpleType[]) {
      for (const o of this.pools[type]) {
        if (!o.active) continue;
        o.mesh.position.z += move;
        if (type === 'core') {
          o.mesh.rotation.y += dt * 3;
          o.mesh.rotation.x += dt * 1.6;
        }
        if (o.mesh.position.z > DESPAWN_Z) {
          o.active = false;
          o.mesh.visible = false;
          continue;
        }
        const sp = SPEC[type];
        const oz = o.mesh.position.z;
        if (!rangesOverlap(pz0, pz1, oz - sp.d / 2, oz + sp.d / 2)) continue;
        const xOverlap = Math.abs(this.px - LANE_X[o.lane]) < PLAYER_W / 2 + sp.w / 2;
        if (!xOverlap) continue;
        this.hit(o);
      }
    }

    // Trains — movement, collisions (trampoline/roof-running), recycling
    for (const o of this.trains) {
      if (!o.active) continue;
      o.mesh.position.z += move;
      if (o.ramp) o.ramp.position.z += move; // the ramp nose moves with the train
      if (o.decor) o.decor.position.z += move; // the sci-fi decor moves with the train
      const cz = o.mesh.position.z;
      const half = o.len / 2;
      if (cz - half > DESPAWN_Z) {
        o.active = false;
        o.mesh.visible = false;
        if (o.ramp) o.ramp.visible = false;
        if (o.decor) o.decor.visible = false;
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
        this.gameOver(); // red from the ground, or teal hit without jumping → crash
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
      this.portal.mesh.rotation.z += dt * 0.6;
      if (!this.portal.crossed && this.portal.mesh.position.z >= PLAYER_Z) {
        this.portal.crossed = true;
        this.trans = { from: this.era, to: this.pendingEra, t: 0 };
        this.onEra?.(ERAS[this.pendingEra].name);
      }
      if (this.portal.mesh.position.z > DESPAWN_Z + 3) {
        this.portal.active = false;
        this.portal.mesh.visible = false;
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
    if (this.supportY > 0) this.camTargetLift = this.supportY;
    else if (this.py <= 0.1) this.camTargetLift = 0;
    this.camLift = damp(this.camLift, this.camTargetLift, 8, dt);
    this.camera.position.set(this.camX, this.camBaseY + this.camLift, this.camBaseZ);
    this.camera.lookAt(0, this.camLookY + this.camLift, CAM_LOOK_Z);
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
      this.onCore?.(value, mult);
      return;
    }
    let cleared = false;
    if (o.type === 'block') cleared = this.py >= BLOCK_H; // jumped over
    else if (o.type === 'overhead') cleared = this.slideT > 0; // slid underneath
    else if (o.type === 'wall') cleared = false; // change lane
    if (!cleared) this.gameOver();
  }

  private gameOver() {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.character?.setState('dead');
    this.deathT = DEATH_DELAY; // the overlay appears after the collapse is visible
  }

  // --- Input ---
  private moveLane(d: number) {
    this.targetLane = clamp(this.targetLane + d, 0, 2);
  }
  private jump() {
    // jumps from the ground/roof OR within the grace window (coyote) after leaving the edge
    if (this.py <= this.supportY + 0.06 || this.coyoteT > 0) {
      this.vy = JUMP_V;
      this.coyoteT = 0;
    }
  }
  private slide() {
    this.slideT = SLIDE_TIME;
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private render() {
    this.renderer.render(this.scene, this.camera);
  }
}
