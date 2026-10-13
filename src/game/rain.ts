import * as THREE from 'three';

/** Rain for the Neo-Cyberpunk era: long falling streaks around the player (the road stays matte). */

/**
 * Rain: long falling streaks (line segments) around the player.
 * update() moves everything; level 0..1 drives the opacity (fade in/out with the weather).
 */
export class Rain {
  readonly group = new THREE.Group();
  private pos: Float32Array;
  private lines: THREE.LineSegments;
  private lineMat: THREE.LineBasicMaterial;
  private n: number;

  constructor(n: number, rng: () => number) {
    this.n = n;
    this.pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) this.reset(i, rng, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(geo, this.lineMat);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.group.visible = false;
  }

  private reset(i: number, rng: () => number, anyHeight: boolean) {
    const x = -12 + rng() * 24;
    const z = -30 + rng() * 40;
    const y = anyHeight ? rng() * 22 : 18 + rng() * 6;
    const len = 0.5 + rng() * 0.6;
    const o = i * 6;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.pos[o + 3] = x;
    this.pos[o + 4] = y + len;
    this.pos[o + 5] = z - len * 0.25;
  }

  update(dt: number, camX: number, level: number, rng: () => number) {
    if (level < 0.01) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.x = camX;
    this.lineMat.opacity = level * 0.55;
    const fall = dt * 38;
    for (let i = 0; i < this.n; i++) {
      const o = i * 6;
      this.pos[o + 1] -= fall;
      this.pos[o + 4] -= fall;
      this.pos[o + 2] += fall * 0.25;
      this.pos[o + 5] += fall * 0.25;
      if (this.pos[o + 1] < 0) this.reset(i, rng, false);
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
