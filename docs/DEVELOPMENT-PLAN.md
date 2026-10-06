# Development plan — Chrono Drift: The Neon Outlaws

> A 3D endless runner for the web (HTML5/WebGL), no account, instant access. Planning document
> covering: story, tech stack, mechanics, multimedia + vendors + budget, leaderboard
> (Cloudflare Worker + KV/D1), monetisation, promotion, roadmap and risks.
>
> Decisions already taken: leaderboard on **Cloudflare Worker + KV/D1**; preference for the
> "best" vendors even if they are paid (a one-off **production** cost — not a per-user cost at
> runtime).

---

## 0. Executive summary

- **Type:** 3-lane 3D endless runner (Subway Surfers / Temple Run style), time-travel theme,
  4 eras that switch through "temporal rifts".
- **Project strategy:** developed as a **standalone, decoupled** app on its **own subdomain**
  (`chronodrift.fun-zone.app`), **without** depending on any portal shell or the portal's AdSense
  → ready to "break off" onto its own domain (`chronodrift.app`) if it becomes a success. We
  validate a **playable vertical slice** first.
- **Backend:** only for the leaderboard — **Cloudflare Worker + D1** (free tier). Everything else
  is static.
- **Estimated production budget:** **~$300–800** ("lean" variant with Synty packs + Suno),
  **~$1,500–4,000** ("premium" variant with a freelance artist + licensed audio).

---

## 1. Vision & story (summary from the GDD)

**Premise:** the year 2084, the Neo-Venice megalopolis; **Aero**, a rebel chrono-hacker, breaks
into the temporal vault of the Ministry of Synchronisation. A defensive script triggers the
**Chrono Drift** — time shatters into an **Infinite Corridor** where the epochs collide.

**The chase:** Aero flees the **Paradox Warden** (a cybernetic inspector) and the **Chrono-Wolf
Hounds** (drones that reappear through micro-portals behind the player).

**The eras (transition every ~60 s / score thresholds):**
1. **Neo-Cyberpunk** (base) — neon highways, Hyperloop, skyscrapers.
2. **Prehistoric** — trails, vines, mammoths/dinosaurs as moving obstacles.
3. **Ancient/Mythological** — aqueducts, Roman columns, war chariots.
4. **Solarpunk** — ecological platforms, bioluminescent vegetation, organic drones.

The 3 lanes stay mathematically constant; only the world's "skin" changes (assets from the pool).

---

## 2. Tech stack & architecture

| Component | Choice | Reason |
|---|---|---|
| 3D engine | **Three.js** + **TypeScript** | Full control, small bundle, no lock-in. (PlayCanvas is heavier/editor-centric.) |
| Build | **Vite** | Consistency, HMR, PWA. |
| Physics | **None** (kinematic lane logic) | Collision = lane check + interval (light AABB). Deterministic, easy. |
| Rendering | **Unlit/vertex-lit** materials + **baked lighting**, **instancing**, **texture atlas** | 60 FPS on weak phones; minimal draw calls. |
| Audio | **Web Audio API** (+ `AnalyserNode` for audio-reactive neon) | Bass band → emissive intensity. |
| Persistence | **localStorage** (best score, cores, skins); IndexedDB only if it grows | Simple, offline. |
| Leaderboard | **Cloudflare Worker + D1** | The only backend; free tier. Details in §5. |
| Deploy | Worker Static Assets, **own subdomain** | Reuses the existing pipeline (worker + 2 domains). |
| Decoupling | **no portal shell / portal AdSense** | Game = fullscreen canvas + separate monetisation; ready for spin-out. |

**Performance principles (mandatory):**
- **Instancing** for road segments and repeated obstacles.
- Aggressive **object pooling** (recycle when off-screen); target RAM < ~150 MB.
- **Pre-warming** the next era's assets before the portal (zero hitch at transition).
- **KTX2/Basis compressed textures** + atlas; few unique materials.
- **Frustum culling** (Three.js does it) — *occlusion culling is not needed* for a forward runner.
- Strict draw-call budget (target < ~80–120/frame on mobile).

**Key risk (from recent experience with WebGL on mobile):** **iOS Safari** has texture/canvas
memory limits and **loses the context** under pressure. Test **early on a real iPhone**;
disciplined texture budget; graceful fallback on context loss (reload + message).

---

## 3. Gameplay mechanics

- **3 lanes** (fixed X positions), camera follows from behind and above.
- **Input:** swipe (left/right/up = jump/down = slide) on mobile; A/D + arrows + Space on desktop.
- **Deterministic world** driven by a **seed** (seeded RNG) → required for *ghost replay* (§7).
- **Collision:** lane + collision interval (simple AABB) → Game Over.
- **Era transition:** the "temporal rift" — visual effect (portal shader) + asset-set swap in the pool.

> Difficulty details, scoring, obstacle types, generation and road curvature are in
> **§3.1–3.4** (principles agreed with the owner, June 2026).
- **Power-ups:**
  - **Chrono Magnet** — pulls cores towards the player (lerp interpolation).
  - **Time Freeze** — slows the world by 50%, keeps the player's animation speed.
  - **Phase Shift** — shield (double-tap), holographic/glitch shader.
- **Collectibles:** cores (currency) → unlock **skins** (cosmetic, no payment).
- **Audio-reactive neon:** the music's bass pulses the light intensity.

---

## 3.1. Speed, score & session (principle: speed ≠ difficulty)

**We decouple speed from difficulty.** Technical argument: jump length = `speed × air_time`, so
correct obstacle spacing (especially trains) depends on speed. Quasi-constant speed ⇒ spacing
stays correct and predictable.

- **Constant, comfortable base speed.** Increases only at very high thresholds.
- **Temporary bursts** ("temporal storm") above ~10,000 (per run): +15–25% for a few seconds,
  then back to normal. Data-driven event (`bursts`).
- All spacing is computed in **"jump units" at the current speed**, not in fixed units.

**Score & session** (decisions confirmed with the owner):
- **Run score** (shown large) + **session total** = sum of runs (shown discreetly; persists in
  memory while in the game, resets on reload).
- **The 1,000,000 target = a session goal** (cumulative), not a single-run goal.
  Thresholds/badges at 100k / 250k / 500k / 1M → retention.
- **Per-run difficulty ramp:** every run restarts comfortably and ramps up; the session only
  accumulates score. (It does not resume at the difficulty reached.)
- Multipliers (distance + core bonus + roof-run bonus) are calibrated empirically so that an
  average player reaches 1M in a reasonable session.

## 3.2. Data-driven difficulty ("levels / scenarios")

File `difficulty.ts` — a curve of score keyframes, linearly interpolated between stops:

```
DifficultyStop { score, speed, density, waveAmp, wavePeriod, weights{type→weight}, maxBlockedLanes }
bursts: SpeedBurst[]   // speed bursts above the threshold
```

- **Density oscillates** (sinusoidal wave `waveAmp`/`wavePeriod`) with a **rising average** →
  tension/relaxation rhythm (you breathe, then a burst). After a threshold the player is kept
  permanently in action.
- `weights` introduces new types **gradually** (trains only appear after a threshold).
- `maxBlockedLanes` ∈ {0,1,2} — **never 3**: there is always ≥1 passable lane.

## 3.3. Obstacle types, grades & trains

- **Grade 1** (exists): `block` (jump), `overhead` (slide) — same lane, no lane change.
- **Grade 2** (exists): `wall` — requires a lane change left/right.
- **Grade 3 — Blocking train** (new): a long wall of **variable length**, no usable roof → change
  lane in time.
- **Grade 4 — Climbable train** (new) — the "trampoline" mechanic:
  - Touch the **front face on the ground** → crash.
  - On contact you are **in the air** (even falling) → propelled onto the **roof**, you run on it.
  - From the roof you can jump onto **another train** (same lane or another).
  - **Falling off a train = no penalty** (you return to the ground; if while falling you touch the
    front of another train while airborne → you mount it).
  - **Rewards ("premium" cores) on the roofs.**

**Spacing rules** (all in "jump units" at the current speed):
- Between **any** 2 consecutive obstacles: distance **≥ 1 jump**.
- Trains in the **same lane**: gap **≤ 1 jump** (you can jump from one to the other) **OR
  ≥ 2 jumps** (clear time to dodge). **Never** in the trap zone between them.

## 3.4. Row generation (with passability guarantee) & road curvature

- **Row occupancy grid:** the world = rows spaced ≥ 1 jump apart. For each row the curve decides
  how many lanes to block and with what, always leaving ≥1 route **solvable relative to the
  previous row** (an accessibility validator rejects impossible combinations → no "guaranteed
  death").
- Trains occupy **several rows** and create a "roof road".
- **Road curvature = purely visual** (Subway Surfers model): the world leans smoothly left/right
  (random, smooth curves), but **the lane logic stays straight** — collisions/lanes unchanged.
  Visual offset ~ quadratic in Z distance; the curvature evolves through seeded noise. Real turns
  (swipe to turn) = a big future option, not now.

## 3.5. Era roster, atmosphere & diegetic monetisation (decisions June 2026)

**5 eras** (1 "home" + 4 rare excursions), chosen with a dice roll at 1000 pts (excursion of
30–90 s, then return):
- **Neo-Cyberpunk** — the "home" era, dominant (~80%). Dense futuristic city → support for
  **diegetic ads** (neon panels/banners along the road). It is both the best monetisation surface
  and the one that keeps the player "captive".
- **Prehistoric**, **Ancient-Mythological**, **Solarpunk** — rare excursions (contrast/breather).
- **Unknown Future** (new, inspired by **MDK** 1997) — an **even rarer** excursion ("wow"):
  - **Semi-transparent road** through which you see the **void/space** below.
  - **Drifting planet fragments** in the sky (skybox + slowly floating meshes).
  - Cold, ethereal palette (blue-violet). **Neon lane lines kept opaque** → readability.
  - No ads (it is rare and "pure"). The emptiness works **precisely because it is short** — it
    becomes atmosphere, not boredom (in MDK the action kept you going; here it is the rarity +
    contrast).

**Monetisation (direction):** diegetic neon billboards **only in the city eras** + **interstitial**
(between runs) + **rewarded** (revive / double cores). See also §6.

**Character (Neon Outlaw):** visual reference **MDK / Kurt Hectic** — thin coil-suit, helmet with
visor, lanky silhouette, neon accents. To be applied at the final-character step.

> Environment effects (per-era skies + the Unknown Future signature) are built at the
> **"environments/skybox per era"** step — see roadmap §8.

## 3.6. Detailed era definitions (art bible)

### Cross-cutting principles (all eras)
1. **Climbable/deadly marking = ORIENTATION (shape), not colour.** A **sloped/ramp** surface facing
   the player = **climbable** (jump onto it); a **vertical/wall** surface facing the player =
   **deadly** (change lane). A single model per long obstacle, **rotated 180°** (ramp nose vs
   wall tail). The roof stays reachable **from above** on both (roof-hop). Subtle, **non-arrow**
   reinforcement (e.g. a glowing edge on the ramp) ONLY if testing shows the shape does not read.
2. **Sci-fi intrusions through time:** the historical eras contain anachronistic sci-fi remains
   (an overgrown maglev, damaged technology) → reinforces the "time-drift" story.
3. **Diegetic ads** wherever there are buildings/obstacles: billboards, logos on vehicle noses,
   posters, named buildings. (Cyberpunk, Solarpunk, Ancient — YES; Prehistoric & Unknown Future
   — NO.)
4. A unified **neon-tech + low-poly filter**; every era = the same time-drift world through a neon
   lens.

### 1. Neo-Cyberpunk — "home" (dominant)
- **Setting:** nocturnal neon megacity; **temporary rain** (comes and goes, not permanent).
- **Sky:** night with neon haze, **ad panels on the skyscrapers**, flying traffic, moon/holo-ad.
- **Road:** glossy reflective asphalt, cyan/magenta neon guides.
- **Obstacles:** long = **maglev capsule** (ramp nose = climbable / wall tail = deadly), with
  **ads on the sides + logos on the nose**; jump = barriers/holo-crates; slide = holographic
  panels; lane = force walls/containers; core = cyan data crystal.
- **Palette:** cyan + magenta on black. **Ads:** YES. **Audio:** synthwave/darksynth.

### 2. Prehistoric (excursion)
- **Setting:** primordial jungle/canyon, volcanic light, megafauna on the horizon.
- **Sky:** dawn/dusk, volcanic haze, primitive sun; **a pterodactyl that appears/disappears
  sporadically**.
- **Road:** **3 trails of packed earth**, with **contrasting vegetation between the lanes**.
- **Obstacles:** long = **dinosaur** or **colossal trunk** (face/head towards the player = deadly /
  back = climbable) + **overgrown maglev** (sci-fi intrusion); jump = boulders/stumps; slide = low
  vines/arches; lane = rocks/trunks; core = amber.
- **Palette:** greens + amber/volcanic orange. **Ads:** NO. **Audio:** tribal drums.

### 3. Ancient-Mythological (excursion)
- **Setting:** mythical Greece — marble temples, gilded statues, Olympus, columns.
- **Sky:** golden light, divine rays, floating Olympus, a colossal god in the distance.
- **Road:** marble with gold inlays as guides.
- **Obstacles:** long = **fallen colossus / chariot / serpent statue** (orientation =
  climbable/deadly) + **time-damaged sci-fi elements**; jump = broken columns/blocks; slide =
  arches/garlands; lane = marble walls/statues; core = golden laurels.
- **Setting + ads:** buildings with **clear names → satirical ads** (fast food, banks,
  institutions) + posters (MDK tone, anachronistic). **Palette:** gold/ivory/bronze + cyan accent.
  **Audio:** epic strings + choir.

### 4. Solarpunk (excursion)
- **Setting:** eco-futurist city, **bright, daytime** — green skyscrapers, solar panels, clean tech.
- **Sky:** clear blue, clouds, sun, eco-airships, birds; **sporadic pterodactyl** (rare appearances).
- **Road:** clean open road, guides made of vines + solar.
- **Obstacles:** long = **eco-tram/solar bridge** with greenery on the roof (orientation =
  climbable/deadly), **carrying ads**; jump = planters/panels; slide = pergolas/hanging gardens;
  lane = living walls/glass; core = green seed of light.
- **Palette:** green + warm gold + white (bright contrast). **Ads:** YES (holo-eco). **Audio:**
  warm, uplifting.

### 5. Unknown Future — the rarest (inspired by MDK)
- **Setting:** surreal, **as empty and lifeless as possible**; drifting through void/space.
- **Sky:** deep space, **planet fragments (broken shards) drifting with debris fields around them**
  (small asteroids, dust, rings of rubble — particle system), nebulae, an eerie silence. *(Now:
  whole icosahedra as placeholders; at final art → shards + debris.)*
- **Road:** **semi-transparent** → the void is visible below; **lane lines stay opaque/neon**
  (readability).
- **Obstacles:** long = **space wrecks / fragmented platforms** (orientation = climbable/deadly);
  jump = debris/monoliths; slide = broken arches/energy barriers; lane = fractured walls/asteroids;
  core = a shard of pure white-cyan light.
- **Palette:** cold blue-violet, ethereal, desaturated + neon accents. **Ads:** NO. **Audio:**
  sparse, otherworldly ambient.

---

## 4. Required multimedia + recommended vendors + budget

> Important distinction: these are **production costs** (one-off / subscription for the duration
> of development), NOT per-user runtime costs — so they do not violate the "no paid services at
> runtime" principle.

### 4.1. 3D assets (the most important — the bottleneck)

**Main recommendation: ready-made, coherent low-poly packs with a clean commercial licence** —
they beat AI 3D generation by far (which yields dirty topology + inconsistent style + ambiguous
licensing).

| Vendor | What it offers | Approx. price | Recommendation |
|---|---|---|---|
| **Synty Studios — POLYGON** | AAA-indie low-poly packs: Sci-Fi City, Cyberpunk, Prehistoric, Ancient Empire, Nature/Sci-Fi | ~$30–90 / pack | **Best** for a unified style across 4 eras. 3–5 packs cover everything. |
| **Quaternius** | Low-poly packs, **CC0 (free)** | $0 | Budget variant / quality placeholder. |
| **Kenney.nl** | CC0 assets (free) | $0 | Prototype / UI / props. |
| **Freelance artist** (Fiverr/ArtStation) | Custom Aero hero + unique enemies, rig + retopo | ~$150–800 / model | For a unique identity (hero + Warden + Wolf). |
| **Meshy.ai / Tripo3D / CSM** | AI 3D generation | ~$20–60/month | Only for unique props; needs manual cleanup. |

**Character animations:** **Mixamo** (Adobe) — **free**, auto-rig + Run/Jump/Slide (clean humanoid
mesh only).

### 4.2. Environment textures

| Vendor | Price | Note |
|---|---|---|
| Included in the **Synty** packs | — | Simplest; style already coherent. |
| **ambientCG / Poliigon (free)** | $0 | Seamless CC0 textures. |
| **Midjourney v6** | ~$10–30/month | Custom tileable textures (seamless parameter). |

### 4.3. Audio

| Type | Recommended vendor | Price | Note |
|---|---|---|---|
| **Music (loops)** | **Suno AI** or **Udio** | ~$10–30/month | Synthwave/Phonk 130–140 BPM; a human editor for seamless loops. |
| **Music (alternative, clean licence for marketing)** | **Epidemic Sound / Artlist** | ~$15–20/month | Licence that also covers viral clips (TikTok/Reels). |
| **SFX** | **ElevenLabs (Text-to-SFX)** | ~$5–22/month | Or free: **Freesound (CC0)**, **Sonniss GDC**, **Kenney Audio**. |

### 4.4. UI / fonts / icons

- **Google Fonts** (Orbitron, Rajdhani — cyber, free).
- **Midjourney** for power-up icons / **Kenney UI** (free).
- HUD assembled in HTML/CSS/Canvas (done in code).

### 4.5. Budget by variant (estimates, 2026, approximate)

| Category | Lean | Premium |
|---|---|---|
| 3D (Synty 3–5 packs) | $150–400 | $200–450 |
| Custom hero + enemies (freelance) | $0 (Synty/AI) | $500–2,000 |
| Textures (Midjourney) | $0–30 | $30 |
| Music (Suno / Epidemic) | $10–30 | $30–60 (a few months) |
| SFX | $0 (free) | $0–22 |
| Brand domain (.app/.io) | $15–60/year | $15–60/year |
| Cloudflare (Worker + D1) | **$0** (free tier) | $0 |
| AI 3D tools (optional) | $0 | $20–60/month |
| **ESTIMATED TOTAL** | **~$300–800** | **~$1,500–4,000** |

> Recommendation: **start lean** (Synty + Suno + domain), validate traction, then invest in custom
> art only if the game catches on.

---

## 5. Leaderboard & backend (Cloudflare Worker + D1)

- **Worker** with 2 routes: `POST /score` (submit a score) and `GET /leaderboard` (top N +
  regional).
- **D1** (serverless SQLite, free tier) — table `scores(id, name, score, era, country, ts)`,
  indexed on `score` for top-N (D1 is better than KV for sortable rankings; KV only for a simple
  cache).
- **Regional:** the country from `request.cf.country` (Cloudflare provides it for free) → ranking
  per country.
- **Anonymity:** browser ID = random UUID in localStorage; freely chosen "name" (no account).
- **Anti-cheat (best effort, it is a free game):**
  - **HMAC-signed** payload with a secret on the Worker (makes brute-force submission harder).
  - **Sanity caps** (max plausible score / time played) + **rate limiting** (per IP/ID).
  - We accept that a web client is 100% gameable — the goal is only to discourage easy cheating.
- **Cost:** $0 on the free tier (100k Worker requests/day, generous D1). Fits the "no paid
  services at runtime" principle.
- **Decoupling:** the leaderboard is optional — the game works fully without it (local best score
  + ghost).

---

## 6. Monetisation

> **AdSense caution:** game-ad networks and **rewarded video** are **separate** networks that
> usually **do NOT coexist with AdSense** on the same page → we do **NOT** put game ads on the
> clean domains (fun-zone/play-zone). The game monetises **on its own domain**.

| Source | How | Fit |
|---|---|---|
| **Aggregators** (Poki, CrazyGames, GameDistribution, Y8) | They host/embed your game, serve their own ads, **revenue share** (~50–70% to the dev) | **The largest source of traffic + revenue** for web games. |
| **Game-ads SDK on your own domain** (AdinPlay, GameDistribution SDK) | Banners + interstitial + **rewarded video** | Control + direct revenue; needs traffic. |
| **Rewarded "Revive"** | Voluntary video ad to continue a record run | Very suited to a runner; good conversion. |
| **Interstitial between runs** | A short ad every few game-overs | Balance with UX (not too often). |
| **Cosmetics** | Skins bought with cores (no payment now; IAP only if it grows) | Engagement, no friction. |

**Recommended strategy:** launch with **rewarded + interstitial SDK** on `chronodrift.app` **and**
submit to **aggregators** for reach. AdSense stays **only** on the portal/utilities.

> Realistically: web-game monetisation is hard at low traffic — aggregators bring the volume.

---

## 7. Promotion & virality

- **Built-in viral loop — Chrono-Share via URL:** at game-over a compressed URL is generated
  (`?run=seed_score_era`). When opened, the game runs a **deterministic ghost** of that run
  (seed + input log) as an opponent → every share brings new players.
- **Aggregators** (Poki/CrazyGames/Y8/itch.io/GameDistribution) — the main organic source.
- **Vertical 9:16 clips** of gameplay over Phonk (OpusClip/CapCut) → TikTok, YT Shorts, Reels.
- **Communities:** Reddit (r/webgames, r/playmygame, r/incremental_games), **Product Hunt**,
  **Show HN**, own Discord.
- **Launch manifesto:** "A spectacular 3D game on the web, 100% anonymous, no install, no login".

---

## 8. Roadmap by phase (realistic — NOT a fixed 6 weeks)

> Reframed from the GDD: **MVP-first**. We validate fun + performance before expensive art.

- **Phase 0 — Vertical slice (DONE):** Three.js + 3 lanes + pooling + swipe/keyboard +
  collisions + increasing speed + game-over + local best score. **Validated:** smooth + fun on
  the phone.
- **Phase 1a — Eras (DONE, placeholder):** 4 data-driven eras + "temporal rift" (palette morph +
  flash + camera shake) + era-name toast. Synty art is mounted later into these slots.
- **Phase 1b — Core mechanics (IN PROGRESS — before graphics):** §3.1–3.4 — decoupled speed +
  score/session (total towards 1M), data-driven difficulty (`difficulty.ts`), row generation
  with passability guarantee, **trains** (blocking + climbable with trampoline/roof-run), visual
  road curvature. **Criterion:** train control is correct and fun on the phone.
- **Phase 2 — Art & animations:** Synty integration per era, Mixamo animations
  (run/jump/slide/roof).
- **Phase 3 — Power-ups & audio:** magnet/freeze/phase-shift, music + SFX, audio-reactive neon,
  "juice".
- **Phase 4 — Persistence & virality:** skins, **Chrono-Share + deterministic ghost**.
- **Phase 5 — Leaderboard:** Worker + D1, regional, best-effort anti-cheat.
- **Phase 6 — Optimisation:** atlas/KTX2, frustum culling, profiling on a weak phone + **a real
  iPhone**.
- **Phase 7 — Monetisation & launch:** game-ads SDK / aggregators, build, marketing.

**Honest estimate:** 6 weeks → a **solid vertical slice + 1–2 eras**, not a finished commercial
product. Producing coherent art is the real effort.

---

## 9. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **WebGL on iOS** (memory/context lost) | High | Strict texture budget, KTX2, early test on iPhone, context-lost fallback. |
| **Artistic coherence** across 4 eras | High | Synty (unified style) instead of inconsistent AI 3D. |
| **AI asset licensing** (commercial) | Medium | Prefer CC0/Synty (clear licence); avoid AI 3D for shipped assets. |
| **Leaderboard cheating** | Medium | HMAC + caps + rate-limit; accept "best effort". |
| **Weak monetisation at low traffic** | Medium | Aggregators for volume; rewarded for conversion. |
| **AdSense conflict** | Medium | Game ads ONLY on the game's domain, not on the portal. |
| **Scope creep** | High | MVP-first; phases with go/no-go criteria. |
| **Era transition performance** | Medium | Pre-warm the pool before the portal. |

---

## 10. Division of roles

| Code (the developer/agent) | Owner (decisions/purchases) |
|---|---|
| Three.js engine, mechanics, pooling, collisions, power-ups | Approves the direction; chooses the budget variant |
| Era transitions, portal/glitch shaders, audio-reactive neon | Buys the Synty packs / audio subscription |
| Persistence, Chrono-Share + deterministic ghost | Generates/buys the 3D assets + audio |
| Worker + D1 leaderboard (+ anti-cheat) | Cloudflare account (owned); brand domain |
| Ads SDK integration, build, deploy | Game-ads network account / aggregator submissions |
| Optimisation + profiling | Testing on own phones (Android + iPhone) |

---

## 11. Open decisions (to confirm before Phase 1)

1. **Brand domain:** `chronodrift.app` / `.io`? (Recommended to reserve it early.)
2. **Art variant:** *lean* (Synty/CC0) or *premium* (custom artist for hero/enemies)?
3. **Leaderboard:** global + regional (Worker + D1) from the start, or local + ghost first?
4. **Monetisation at launch:** aggregators (Poki etc.) or an SDK on the own domain — or both?
5. **Approved budget:** lean (~$300–800) or premium (~$1.5–4k)?

---

## 12. Immediate step

**Phase 0 — a playable vertical slice with placeholders** (cubes/CC0), to validate **mechanics +
performance on the phone** before any investment in art/audio. If it is smooth and fun, we
continue with art (Synty) + eras.
