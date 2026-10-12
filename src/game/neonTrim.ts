import * as THREE from 'three';

/**
 * Neon trim as geometry: thin emissive tubes placed on the suit surface and attached to the bones,
 * so they follow the animations and can be tinted per era (the texture stays a plain matte suit).
 * Built once from the bind pose of the Meshy humanoid rig (Hips, Spine02/01, Spine, neck, Head,
 * head_end, headfront, L/R Shoulder/Arm/ForeArm/Hand, L/R UpLeg/Leg/Foot).
 */
export interface NeonTrim {
  material: THREE.MeshStandardMaterial;
  meshes: THREE.Mesh[];
  setColor(c: THREE.ColorRepresentation): void;
  dispose(): void;
}

export function buildNeonTrim(skinned: THREE.SkinnedMesh, opts: { tubeRadius?: number; lift?: number } = {}): NeonTrim {
  const tubeR = opts.tubeRadius ?? 0.0095;
  const lift = opts.lift ?? 0.005;
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x00eaff, emissiveIntensity: 2.4, roughness: 0.35, metalness: 0, toneMapped: false });

  const skeleton = skinned.skeleton;
  skinned.updateMatrixWorld(true);
  for (const b of skeleton.bones) b.updateMatrixWorld(true);
  skeleton.update(); // bone matrices are only computed at render time; we sample vertices before the first frame
  let sceneRoot: THREE.Object3D = skinned;
  while (sceneRoot.parent) sceneRoot = sceneRoot.parent; // world-space container (identity transform)

  // Bind-pose world positions of every vertex + its dominant bone.
  const geom = skinned.geometry;
  const n = geom.attributes.position.count;
  const si = geom.attributes.skinIndex as THREE.BufferAttribute;
  const sw = geom.attributes.skinWeight as THREE.BufferAttribute;
  const verts: THREE.Vector3[] = new Array(n);
  const boneOf = new Int16Array(n);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    skinned.getVertexPosition(i, tmp).applyMatrix4(skinned.matrixWorld);
    verts[i] = tmp.clone();
    let best = 0;
    let bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, k);
      }
    }
    boneOf[i] = best;
  }
  const bone = (name: string): THREE.Bone => {
    const b = skeleton.bones.find((x) => x.name === name);
    if (!b) throw new Error(`neonTrim: bone ${name} not found`);
    return b;
  };
  const wpos = (name: string) => bone(name).getWorldPosition(new THREE.Vector3());
  const vertsOf = (...names: string[]) => {
    const idx = new Set(names.map((nm) => skeleton.bones.indexOf(bone(nm))));
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) if (idx.has(boneOf[i])) out.push(verts[i]);
    return out;
  };

  /** Surface point along the segment A->B at parameter t, pushed out in direction d (projected perpendicular to the axis). */
  const surfaceAlong = (A: THREE.Vector3, B: THREE.Vector3, t: number, d: THREE.Vector3, vs: THREE.Vector3[], cone = 0.45, band = 0.09) => {
    const axis = B.clone().sub(A);
    const L = axis.length();
    const u = axis.clone().normalize();
    const dd = d.clone().sub(u.clone().multiplyScalar(d.dot(u))).normalize();
    const center = A.clone().add(u.clone().multiplyScalar(t * L));
    let r = 0;
    const p = new THREE.Vector3();
    const cosCone = Math.cos(cone);
    for (const q of vs) {
      p.copy(q).sub(A);
      const a = p.dot(u) / L;
      if (Math.abs(a - t) > band) continue;
      p.sub(u.clone().multiplyScalar(a * L));
      const len = p.length();
      if (len < 1e-5) continue;
      const c = p.dot(dd) / len;
      if (c < cosCone) continue;
      r = Math.max(r, len * c);
    }
    return center.add(dd.multiplyScalar(r + lift));
  };

  // Directions derived from the rig itself, so the model's orientation in the scene does not matter.
  const UP = new THREE.Vector3(0, 1, 0);
  const horiz = (v: THREE.Vector3) => v.sub(UP.clone().multiplyScalar(v.dot(UP))).normalize();
  const FRONT = horiz(wpos('headfront').sub(wpos('Head')));
  const BACK = FRONT.clone().negate();
  const LEFT = horiz(wpos('LeftUpLeg').sub(wpos('RightUpLeg')));
  const dir = (...parts: (THREE.Vector3 | number)[]) => {
    const v = new THREE.Vector3();
    for (let i = 0; i < parts.length; i += 2) v.addScaledVector(parts[i] as THREE.Vector3, parts[i + 1] as number);
    return v.normalize();
  };

  const meshes: THREE.Mesh[] = [];
  const tube = (points: THREE.Vector3[], attachTo: THREE.Object3D, closed = false, radius = tubeR) => {
    const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
    const g = new THREE.TubeGeometry(curve, Math.max(12, points.length * 6), radius, 7, closed);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.name = 'neon';
    sceneRoot.add(m); // world space first (the armature has a 0.01 scale, so never add there) ...
    attachTo.attach(m); // ... then re-parent to the bone, keeping the world transform
    meshes.push(m);
    return m;
  };
  const lerpDir = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t).normalize();
  const steps = (t0: number, t1: number, k: number) => Array.from({ length: k }, (_, i) => t0 + ((t1 - t0) * i) / (k - 1));

  // --- Legs: one line per thigh and per shin, on the outer-back side (visible from the chase camera).
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 1 : -1;
    const d = dir(LEFT, sx * 0.8, BACK, 0.45);
    const hip = wpos(`${side}UpLeg`);
    const knee = wpos(`${side}Leg`);
    const ankle = wpos(`${side}Foot`);
    const thighV = vertsOf(`${side}UpLeg`);
    const shinV = vertsOf(`${side}Leg`);
    tube(steps(0.1, 0.93, 7).map((t) => surfaceAlong(hip, knee, t, d, thighV)), bone(`${side}UpLeg`));
    tube(steps(0.07, 0.9, 7).map((t) => surfaceAlong(knee, ankle, t, d, shinV)), bone(`${side}Leg`));
  }
  // --- Arms: outer side of upper arm and forearm (the model is rigged in T-pose: outer = up/back).
  for (const side of ['Left', 'Right'] as const) {
    const d = dir(UP, 1, BACK, 0.35);
    const sh = wpos(`${side}Arm`);
    const el = wpos(`${side}ForeArm`);
    const wr = wpos(`${side}Hand`);
    const upV = vertsOf(`${side}Arm`);
    const foV = vertsOf(`${side}ForeArm`);
    tube(steps(0.12, 0.92, 6).map((t) => surfaceAlong(sh, el, t, d, upV)), bone(`${side}Arm`));
    tube(steps(0.08, 0.9, 6).map((t) => surfaceAlong(el, wr, t, d, foV)), bone(`${side}ForeArm`));
  }
  // --- Torso: chest V (front) and the two lines framing the core (back) + belt ring.
  const torsoV = vertsOf('Spine02', 'Spine01', 'Spine', 'LeftShoulder', 'RightShoulder');
  const hips = wpos('Hips');
  const neck = wpos('neck');
  for (const sx of [1, -1]) {
    const front = steps(0, 1, 5).map((k) => surfaceAlong(hips, neck, 0.92 - 0.42 * k, lerpDir(dir(LEFT, sx * 0.75, FRONT, 1), dir(LEFT, sx * 0.1, FRONT, 1), k), torsoV));
    tube(front, bone('Spine01'));
    const back = steps(0, 1, 4).map((k) => surfaceAlong(hips, neck, 0.95 - 0.3 * k, lerpDir(dir(LEFT, sx * 0.8, BACK, 1), dir(LEFT, sx * 0.22, BACK, 1), k), torsoV));
    tube(back, bone('Spine'));
  }
  const beltV = vertsOf('Hips', 'Spine02');
  const belt = steps(0, Math.PI * 2 * (23 / 24), 24).map((a) => surfaceAlong(hips, neck, 0.1, dir(FRONT, Math.cos(a), LEFT, Math.sin(a)), beltV, 0.3, 0.06));
  tube(belt, bone('Hips'), true, tubeR * 1.15);
  // --- Helmet: visor band around the front at eye height + a front crest line from the visor up to the tip.
  const headV = vertsOf('Head', 'head_end', 'headfront');
  const headTop = wpos('head_end');
  const headBase = wpos('Head');
  const visor = steps(-1.05, 1.05, 11).map((a) => surfaceAlong(headBase, headTop, 0.36, dir(FRONT, Math.cos(a), LEFT, Math.sin(a)), headV, 0.25, 0.05));
  tube(visor, bone('Head'), false, tubeR * 1.3);
  const crest = steps(0.5, 1.02, 7).map((t) => surfaceAlong(headBase, headTop, t, FRONT, headV, 0.3, 0.06));
  tube(crest, bone('Head'));

  return {
    material: mat,
    meshes,
    setColor(c) {
      mat.emissive.set(c);
    },
    dispose() {
      for (const m of meshes) {
        m.geometry.dispose();
        m.removeFromParent();
      }
      mat.dispose();
    },
  };
}
