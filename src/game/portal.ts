import * as THREE from 'three';
import type { EraPalette } from './eras';

/**
 * The era-change portal: a time distortion, not a device — a spinning vortex disc and a swirl of particles
 * spiralling into the centre over a soft flare, all tinted with the destination era's palette.
 * The group is positioned/moved by Game (it scrolls like any world object); update() animates it.
 */
export class Portal {
  readonly group = new THREE.Group();
  readonly materials: THREE.Material[] = []; // for the world curvature pass
  private disc: THREE.Mesh;
  private discMat: THREE.MeshBasicMaterial;
  private flare: THREE.Mesh;
  private flareMat: THREE.MeshBasicMaterial;
  private dots: THREE.Points;
  private dotsMat: THREE.PointsMaterial;
  private dotPos: Float32Array;
  private dotAng: Float32Array;
  private dotRad: Float32Array;
  private dotSpd: Float32Array;
  private n: number;
  private t = 0;

  constructor(radius: number, particles: number, rng: () => number) {
    this.n = particles;
    // vortex disc
    this.discMat = new THREE.MeshBasicMaterial({ map: Portal.makeSpiral(), color: 0x7af0ff, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.96, 48), this.discMat);
    // soft flare behind the centre
    this.flareMat = new THREE.MeshBasicMaterial({ map: Portal.makeGlow(), color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.flare = new THREE.Mesh(new THREE.PlaneGeometry(radius * 3.2, radius * 3.2), this.flareMat);
    this.flare.position.z = -0.3;
    // particles spiralling in
    this.dotPos = new Float32Array(particles * 3);
    this.dotAng = new Float32Array(particles);
    this.dotRad = new Float32Array(particles);
    this.dotSpd = new Float32Array(particles);
    for (let i = 0; i < particles; i++) this.resetDot(i, rng, true, radius);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dotPos, 3));
    this.dotsMat = new THREE.PointsMaterial({ map: Portal.makeGlow(), size: 0.45, color: 0xeaffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false });
    this.dots = new THREE.Points(geo, this.dotsMat);
    this.dots.frustumCulled = false;
    this.group.add(this.flare, this.disc, this.dots);
    this.group.visible = false;
    this.materials.push(this.discMat, this.flareMat, this.dotsMat);
    this.group.userData.radius = radius;
  }

  private resetDot(i: number, rng: () => number, any: boolean, radius: number) {
    this.dotAng[i] = rng() * Math.PI * 2;
    this.dotRad[i] = any ? 0.6 + rng() * (radius - 0.4) : radius + 0.2 + rng() * 0.6;
    this.dotSpd[i] = 1.6 + rng() * 1.8;
  }

  /** Tints everything with the destination era: disc/particles = core, flare = horizon. */
  open(dest: EraPalette) {
    this.discMat.color.set(dest.core);
    this.dotsMat.color.set(dest.core);
    this.flareMat.color.set(dest.skyHorizon);
    this.group.visible = true;
  }

  close() {
    this.group.visible = false;
  }

  update(dt: number, rng: () => number) {
    if (!this.group.visible) return;
    this.t += dt;
    const radius = this.group.userData.radius as number;
    this.disc.rotation.z -= dt * 2.4;
    this.discMat.opacity = 0.6 + 0.15 * Math.sin(this.t * 3.1);
    this.flareMat.opacity = 0.28 + 0.1 * Math.sin(this.t * 2.3);
    for (let i = 0; i < this.n; i++) {
      this.dotAng[i] += dt * this.dotSpd[i] * (1 + 1.2 / Math.max(0.5, this.dotRad[i]));
      this.dotRad[i] -= dt * (0.9 + 0.5 * this.dotSpd[i]);
      if (this.dotRad[i] < 0.35) this.resetDot(i, rng, false, radius);
      const r = this.dotRad[i];
      this.dotPos[i * 3] = Math.cos(this.dotAng[i]) * r;
      this.dotPos[i * 3 + 1] = Math.sin(this.dotAng[i]) * r;
      this.dotPos[i * 3 + 2] = Math.sin(this.dotAng[i] * 3 + this.t * 4) * 0.12;
    }
    (this.dots.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private static makeSpiral(): THREE.CanvasTexture {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const img = g.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
        const r = Math.sqrt(dx * dx + dy * dy);
        const a = Math.atan2(dy, dx);
        // three spiral arms, brighter towards the centre, soft edge at the rim
        const arms = 0.5 + 0.5 * Math.cos(3 * a + r * 11);
        const core = Math.exp(-r * r * 6);
        const edge = Math.max(0, 1 - Math.pow(r, 6));
        const v = Math.min(1, (Math.pow(arms, 3) * (1 - r * 0.6) * 0.9 + core) * edge);
        const i = (y * S + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.round(v * 255);
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private static makeGlow(): THREE.CanvasTexture {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(c);
  }
}
