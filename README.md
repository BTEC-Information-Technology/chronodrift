# Chrono Drift — The Neon Outlaws

A 3D endless runner for the web (Three.js + TypeScript, vanilla, no framework). Standalone repo,
intentionally free of any external UI shell so it can live on its own domain.

- **Live (incubator):** https://chronodrift.fun-zone.app and https://chronodrift.play-zone.app
- **On "graduation":** moves to `chronodrift.app`.
- **Full plan:** [docs/DEVELOPMENT-PLAN.md](docs/DEVELOPMENT-PLAN.md)

> This README is the **handoff/backup** so that any session (local or remote) can pick up the
> thread without the original prompt. Update it whenever the state changes.

## Commands

```
npm install
npm run dev          # Vite dev server (add -- --host for LAN/phone testing)
npm run build        # type-check + build into dist/
npm run test         # vitest (rng, math, difficulty)
```

## Deploy

Deploys run **automatically through Cloudflare Workers Builds** on every push to `main`
(root directory `/`, build command `npm run build`, deploy command `npx wrangler deploy`).

Manual deploy:

```
npm run build
npx wrangler deploy
```

This needs `CLOUDFLARE_API_TOKEN` in the environment, or a prior `npx wrangler login`.
Custom domains come from `wrangler.jsonc` (`chronodrift.fun-zone.app` and
`chronodrift.play-zone.app`) and are created automatically on the first deploy.

## Conventions

- **`BUILD` in `src/main.ts`** = the number shown on the start screen. Increment it on every
  change so you can confirm on the phone that the new code actually loaded. (Current: **build 71**.)
- Collisions and game logic live in **logical space** (lanes `LANE_X`, `px/py`); models and
  curvature are **visual only**, so assets can be swapped in without touching gameplay.
- Commit messages are written in **English**.

## Key files (`src/game/`)

- `Game.ts` — main loop, rendering, input, collisions, generation, eras/portal, curvature.
- `constants.ts` — lanes, speeds, sizes, `CORE_SCORE`.
- `difficulty.ts` — data-driven curve (score keyframes) + speed bursts.
- `eras.ts` — era palettes (index 0 = Neo-Cyberpunk, the "home" era).
- `character.ts` — `CharacterController` (GLB + AnimationMixer; states run / jump / jumpTrain /
  jumpObstacle / slide / dead; jump clips are started at their take-off frame and time-scaled to
  the physics airtime; era tint for the neon).
- `neonTrim.ts` — the neon lines as geometry: tubes sampled on the suit surface at bind pose and
  attached to the bones (legs, arms, chest V, back lines, belt, visor, helmet crest).
- `neon-outlaw.clips.json` — per-clip airborne window (take-off / landing), generated with the model.
- `rng.ts` / `math.ts` / `types.ts` — utilities (seeded mulberry32, lerp/damp, types).
- `public/models/neon-outlaw.glb` — the Neon Outlaw (799 KB): mesh + rig generated with Meshy from
  the owner's concept sheet (multi-image to 3D), matte suit texture (neon painted out), backpack
  core as emissive map, clips RunFast / Regular_Jump / Tuck_Jump / Run_and_Jump / slide_light /
  dying_backwards. Hips X/Z translation locked (the game owns the position); Y kept as delivered.

## Current state (DONE)

- **Core mechanics:** 3 lanes, object pooling, real-time swipe (with a cooldown on lane changes)
  + keyboard, **coyote time** on jumps.
- **Speed decoupled from difficulty** + **session score** (cumulative, target 1,000,000) + local
  best score.
- **Data-driven difficulty** (`difficulty.ts`): density follows a tension/relaxation wave with a
  rising average.
- **Row generator** with guaranteed passability (at least 1 free lane, ±1 continuity).
- **Trains:** blocking (red) + climbable (teal) — **same height**; trampoline (mount from a jump),
  **roof-running**, hopping between cars (including teal→red, landing from above), cores on the
  roof. Spacing in "jump units".
- **Eras via PORTAL:** Neo-Cyberpunk dominant (~80%); dice roll at 1000 pts (5/10/15 →
  Prehistoric / Ancient-Mythological / Solarpunk, otherwise home); excursion of 30–90 s, then
  return. The switch is telegraphed by a portal ring; **short palette morph on crossing, no shake**.
- **World curvature** through a bend shader (vertex, `offset × distance²` in view space).
- **Neon Outlaw character** (generated from the owner's concept): matte black suit, neon lines as
  bone-attached geometry tinted by the era, backpack core. Clips: run, three jumps (plain; tuck when
  mounting a climbable train; run-and-jump when clearing a block — chosen at take-off by looking
  ahead in the lane), slide, death; death delay.
- **Cores:** +50 × **combo** (×5 max, decays after 3 s), persistent **coin counter**, "+X" feedback.
- **Obstacles/core** in stylised low-poly (RoundedBox + flatShading, crystal core).
- **Settings panel** (gear icon on the start screen): live-adjustable camera (height / distance /
  tilt / FOV, preview while idle) + difficulty (presets + speed/density sliders = multipliers),
  persisted.
- **Camera rises with the support:** on a train roof the camera goes up; it stays fixed during
  hops between trains; it comes down only when landing on the ground.
- **Sky per era** (gradient dome + stars, morph on transition).
- **Curvature as real circular arcs:** the road is a sequence of straights + arcs (random radius)
  with smooth transitions; **the sky rotates with the cumulative heading** (tangent) — steady on
  straights, turning on arcs, no wobble.
- **Era 5 — Unknown Future** (showcase): space sky + stars, **semi-transparent road** over the
  void (opaque lane lines), **drifting planet fragments** (placeholder icosahedra). The rarest
  excursion.

## Active TEST values (restore to normal before release)

- `TRAIN_UNLOCK = 120` + increased train probability (`Game.ts`, `generateContent`) → dense
  trains from the start. "Production" value: ~600 + natural probability.
- The era roll is already at its real value (1000 pts), but during testing the portal shows up
  rarely (~20% per roll) — it can be raised temporarily for quick verification.

## Next steps

1. **Environments/skybox per era** (the biggest atmosphere jump) — full definitions in **§3.6**
   of the plan:
   - 5 eras ("home" city + 4 rare excursions); **"Unknown Future" era** — DONE.
   - **Climbable/deadly marking through ORIENTATION** — DONE (placeholder): the climbable train
     has a **ramp nose** (goes from the ground up to the roof); the blocking one keeps a
     **vertical wall**. Colour is reinforcement only. (At final art: a single model rotated 180°.)
   - **Diegetic ads** in Cyberpunk — DONE: buildings with panel facades + guards that reserve the
     ad↔filler corridor (no filler between the guards and the road).
   - **Sci-fi intrusions** (principle #2) — DONE as a **"long" obstacle (train) variant**, not a
     backdrop: in Prehistoric an overgrown maglev; in Ancient damaged sci-fi remains. Rare
     appearance (budget ~3 per excursion, as a surprise). Visual decoration uses the curvature
     shader; the train stays functional.
   - **Era filter (TEST)** in Settings: checkboxes; only the ticked eras appear in a run (bounces
     between them).
   - **Side decoration per era** — DONE (generic composable system, scroll/recycle + curvature
     shader): Cyberpunk = buildings; Prehistoric = jungle (trees/boulders/undergrowth); Ancient =
     columns/statues/marble buildings; Solarpunk = eco-towers/solar panels/hedges; Unknown = rare
     monoliths in the void. **Side ground** per era (1/2/3) so the decoration does not float;
     Cyberpunk below the horizon, Unknown = void.
   - REMAINING: **diegetic ads** on the Ancient buildings (satirical names) and on the Solarpunk
     eco-towers/panels (holo-eco).
2. **Audio** — SFX (jump/collect/crash/mount/portal) + music per era (CC0 first).
3. **Character polish** — DONE as a first version (see above). Open: a jump clip with knees tucked
   to the chest (no library/text-to-motion clip was convincing; Mixamo refused the rigged upload),
   smoothing of the leg lines at the knee, a flat visor band instead of a tube.
4. Normalise the test values; possibly badges at coin/score thresholds.
5. Later: leaderboard (Cloudflare Worker + D1) — **a single global ranking** (harder = more
   points); deterministic ghost; monetisation (billboards + interstitial + rewarded).

## Decisions (confirmed with the owner)

- Lean budget **$500**; **free CC0 first** (Quaternius/Kenney/Poly Pizza), premium (Synty) if it
  takes off.
- **Stylised low-poly** style; audio **CC0 first**.
- **No paid services at runtime** (the platform is ad-supported).
- Game first, **leaderboard later** (local scores for now).

## License

MIT.
