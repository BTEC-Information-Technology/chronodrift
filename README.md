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
  change so you can confirm on the phone that the new code actually loaded. (Current: **build 114**.)
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
- `tokens.ts` — pickup token looks per era (`buildToken`, `animateToken`).
- `city.ts` — street relief: road curbs/posts/drains (`buildRoadRelief`), building socle with a random
  frontage from a catalogue of 10 shopfronts + 10 gates (`buildSocle`), body + setback tower + parapets +
  neon tubes (`buildUpper`).
- `obstacles.ts` — procedural obstacle looks (block / overhead / wall) and `buildTrain`: the maglev
  locomotive + wagons (one rounded profile swept along the length, wedge nose, windows, neon rails,
  red end bars, headlight, pads). Every colour/light comes from a `TrainMats` set, so other eras can
  pass unlit, sun-lit materials over the same geometry.
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
- **Lives** (plan §3.7): with N lives the next one costs N × `LIFE_STEP` points, counter reset on
  every change of N; crash with spare lives = stop-and-blink respawn (world frozen until the player
  jumps, slides or changes lane; no action within 3 s = another life lost, new interval), game over only at 0. HUD: hearts + progress bar, toasts.
- **Neo-Cyberpunk city, first pass:** unique procedural facades per building (portrait windows, cold-to-warm
  interior light, dark floors, office floors), neon frame as geometry (edge bars + roofline ring) and neon
  strips in the building's colour, satirical billboards (10 generated designs), rooftop props, a skyline
  with the same facades, sky traffic and a giant holographic ad that cycles through the ads every
  10-15 s. Billboards come in square / portrait / landscape and keep their aspect; they flicker like
  neon. Rain is long streaks (reduces visibility, on purpose). The road stays matte (a wet-asphalt
  effect was reverted).
- **Maglev trains (build 94):** procedural locomotive and wagons after the approved concept, smooth-shaded,
  with city reflections on the hull, neon rails in the type's colour (teal climbable / red blocking),
  red bars on every flat end, a white headlight on the nose. Trains shorter than 13 units are a single
  locomotive; longer ones add wagons. AI-generated meshes were tried and rejected: image-to-3D gives
  dented hard surfaces, no emissive channel and (after simplification) zero-length normals that turn
  into NaN under bloom. Keep hard-surface props procedural.
- **Post-processing:** `EffectComposer` + `UnrealBloomPass` (threshold 0.9, so only HDR neon glows) +
  `OutputPass` on a 4x MSAA render target (the canvas antialiasing does not apply off-screen); key light +
  cyan rim light. Very bright reds come out orange through tone mapping, so the red lights stay at ~1.15
  and get no bloom. Tiny bright points (stars) bloom into squares, so stars stay under the threshold
  except the biggest ones.
- **Obstacles (build 95):** jump block, slide-under gantry and lane-change barrier rebuilt in the train's
  language (`obstacles.ts`): smooth bodies, light panels, continuous neon chevrons, white lights, pads.
- **Neo-Cyberpunk ground (build 96-104):** asphalt/plaza texture shared by the road and a city floor the
  buildings stand on; the road rails are a thin core plus a soft additive halo; the buildings' neon frames
  are painted into the facade texture (geometry bars flickered at distance).
- **Stars:** round shader points (`makeStarMaterial`), sizes vary, brightness follows size (0.88..1.0), no
  twinkle of their own; full sphere (visible below the horizon through the Unknown Future void).
- **Street relief (build 109):** curbs carrying the neon tubes, dashed lane marks, railing posts, drains;
  buildings with a wider socle (random gate + shopfronts facing the road, neon in the building's colour),
  main body + setback tower, parapets, inset windows via a normal map painted with the facade, neon tubes
  as geometry only within 90 m (the painted frame covers the distance).
- **Performance (builds 110-114, measured on a phone with `?perf=1`):** pixel ratio capped at 1.5, MSAA 2x,
  bloom mips at half resolution (GPU was the main limit: 40 → 60 fps); train looks built once per integer
  length at startup and cloned; building placement queued and split over three frames (textures, socle +
  frontage, upper part); plain boxes for thin parts, indexed merges; every shader compiled on the start
  screen (`warmUp`). `?perf=1` shows the frame-time overlay and a Copy perf log button on game over.
- **Tokens (build 107, `tokens.ts`):** one look per era — hourglass coin (Neo), glass hourglass (Prehistoric),
  crystal shard (Ancient), clock gear (Solarpunk), gyroscope orb (Unknown Future); neon in the era's core
  colour, coin-style spin plus orbiting rings.
- **Sky vehicles:** 14 merged low-poly flyers (headlights, taillight bar, underglow) crossing the skyline.
- **Portal as a time distortion** (`portal.ts`): spinning spiral vortex + particles spiralling in + flare, no
  rings, tinted with the destination palette; the crossing shakes the camera for 1 s (`SHAKE_DUR`).
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

- `LIFE_STEP = 10000` (production) in `constants.ts`.
- `TRAIN_UNLOCK = 120` + increased train probability (`Game.ts`, `generateContent`) → dense
  trains from the start. "Production" value: ~600 + natural probability.
- The era roll is already at its real value (1000 pts), but during testing the portal shows up
  rarely (~20% per roll) — it can be raised temporarily for quick verification.
- `LIFE_STEP = 500` (`constants.ts`) so lives are easy to reach while testing. "Production" value:
  10,000 (possibly per difficulty preset).

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
