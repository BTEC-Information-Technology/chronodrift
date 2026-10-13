import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildNeonTrim, type NeonTrim } from './neonTrim';

export type CharState = 'run' | 'idle' | 'jump' | 'jumpTrain' | 'jumpObstacle' | 'slide' | 'dead';
// Names of the GLB clips for each state (reconfigurable per model).
export type CharClips = Record<CharState, string>;
/** Airborne window of a jump clip (seconds): the clip is played from `takeoff`, scaled so that it reaches `landing` when the physics lands. */
export interface ClipWindow {
  duration: number;
  takeoff: number;
  landing: number;
}

const JUMP_STATES: ReadonlySet<CharState> = new Set(['jump', 'jumpTrain', 'jumpObstacle']);

/**
 * Loads the rigged character from a GLB and plays animations according to the game state.
 * The model is purely visual — collisions stay on the logical box in Game.
 * The neon lines are geometry built on the bones at load time and tinted per era.
 */
export class CharacterController {
  readonly group = new THREE.Group();
  ready = false;
  private mixer?: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current?: THREE.AnimationAction;
  private state: CharState = 'run';
  private trim?: NeonTrim;
  private bodyMat?: THREE.MeshStandardMaterial;
  private tint = new THREE.Color(0x00eaff);
  private pendingRun = false; // run requested while a run-and-jump clip still has its landing roll to play

  constructor(
    url: string,
    private clips: CharClips,
    private windows: Record<string, ClipWindow>,
    targetHeight: number,
    onReady?: () => void,
  ) {
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene;
      // scale to the target height
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y || 1;
      model.scale.setScalar(targetHeight / h);
      // put the feet at y=0 and face into the screen (-Z)
      model.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y = -box2.min.y;
      model.rotation.y = Math.PI;
      let skinned: THREE.SkinnedMesh | undefined;
      model.traverse((o) => {
        o.castShadow = false;
        o.receiveShadow = false;
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
      });
      this.group.add(model);
      this.group.updateMatrixWorld(true);
      if (skinned) {
        const m = skinned.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 1.6; // the backpack core (emissive map)
        this.bodyMat = m;
        this.trim = buildNeonTrim(skinned);
        this.trim.setColor(this.tint);
      }

      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
      this.ready = true;
      this.play(this.clips.run, 0);
      onReady?.();
    });
  }

  private play(name: string, fade: number, once = false) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset();
    next.timeScale = 1;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once; // stays on the last frame (collapsed / landed)
    next.fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = next;
  }

  /**
   * Switches the animation state. For jump states `airtime` is the physics airtime (s): the clip
   * starts at its take-off frame and is scaled so that its own landing coincides with the real one.
   */
  setState(state: CharState, airtime = 0) {
    if (!this.ready || state === this.state) return;
    // Landing from a run-and-jump: let the clip finish its roll before running again (unless something else happens).
    if (state === 'run' && this.state === 'jumpObstacle' && this.current) {
      this.state = state;
      this.pendingRun = true;
      return;
    }
    this.pendingRun = false;
    this.state = state;
    const name = this.clips[state];
    if (JUMP_STATES.has(state)) {
      this.play(name, 0.08, true);
      const w = this.windows[name];
      const a = this.current;
      if (w && a && airtime > 0) {
        a.time = w.takeoff;
        const span = Math.max(0.05, w.landing - w.takeoff);
        a.timeScale = span / airtime;
      }
      return;
    }
    this.play(name, state === 'dead' ? 0.1 : 0.18, state === 'dead');
  }

  /** Blink/opacity for the whole character (suit + neon), 1 = solid. */
  setOpacity(a: number) {
    const mats: THREE.Material[] = [];
    if (this.bodyMat) mats.push(this.bodyMat);
    if (this.trim) mats.push(this.trim.material);
    for (const m of mats) {
      m.transparent = a < 0.999;
      m.opacity = a;
      m.depthWrite = a >= 0.999;
    }
  }

  /** Era tint for all neon lines (the suit texture stays neutral). */
  setTint(color: THREE.Color) {
    this.tint.copy(color);
    this.trim?.setColor(color);
    if (this.bodyMat) this.bodyMat.emissive.copy(color);
  }

  update(dt: number) {
    this.mixer?.update(dt);
    if (this.pendingRun && this.current) {
      const dur = this.current.getClip().duration;
      if (this.current.time >= dur - 0.2 || !this.current.isRunning()) {
        this.pendingRun = false;
        this.play(this.clips.run, 0.2);
      }
    }
  }
}
