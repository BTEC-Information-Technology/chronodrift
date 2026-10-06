import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CharState = 'run' | 'jump' | 'slide' | 'dead';
// Names of the GLB clips for each state (reconfigurable per model).
export type CharClips = Record<CharState, string>;

/**
 * Loads a rigged character from a GLB and plays animations according to the game state.
 * The model is purely visual — collisions stay on the logical box in Game.
 */
export class CharacterController {
  readonly group = new THREE.Group();
  ready = false;
  private mixer?: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current?: THREE.AnimationAction;
  private state: CharState = 'run';

  constructor(
    url: string,
    private clips: CharClips,
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
      model.traverse((o) => {
        o.castShadow = false;
        o.receiveShadow = false;
      });
      this.group.add(model);

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
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once; // stays on the last frame (collapsed)
    next.fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = next;
  }

  setState(state: CharState) {
    if (!this.ready || state === this.state) return;
    this.state = state;
    this.play(this.clips[state], state === 'dead' ? 0.1 : 0.18, state === 'dead');
  }

  update(dt: number) {
    this.mixer?.update(dt);
  }
}
