# Ultra presentation pass

This local pass builds on the existing premium arcade direction: small fast
ships, mint protected signals, red capture threats, violet interference, and
gold value. Keep the radar sharper and quieter than the cinematic frontier.
Desktop, narrow portrait and short landscape must retain readable silhouettes,
warnings, names and controls. Gameplay rules remain unchanged.

## Art and integration

- Four complete Blender models replace the old player and carrier assemblies.
  The interceptor has swept wings and twin nacelles; the guardian adds wider
  shield-emitter wings; the heavy adds reinforced shoulders, a reactor cover
  and larger cannons. White ceramic, smoked cyan glass, dark machinery, gold
  hardpoints and small class-coloured emitters retain the player identity.
  The crimson carrier has layered deck armour, six twin turrets, recessed
  hangars, a command citadel and paired drive nacelles. Old glowing outlines
  and primitive body details do not render underneath these assets.
- Editable masters are `art/blender/{interceptor,guardian,heavy,carrier}.blend`.
  Full-resolution transparent Cycles renders live in `art/bakes/`. Rebuild:

  ```sh
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/art/build-flight-art.py
  python3 tools/art/optimise-flight-art.py
  ```

  The packaging step requires Pillow. All sources are authored locally;
  there are no external textures, add-ons, model services or decoder fetches.
- The ships contain 8,634 / 9,034 / 9,206 triangles; the carrier contains
  21,336. Their 56 / 60 / 61 / 142 authoring parts merge into five shared
  material batches per model. Runtime GLBs total 2,047,304 bytes. A single
  neutral reflection environment serves the authored metals and is rebuilt
  after WebGL restoration. Existing cyan/rose scene lighting remains.
- Matching compressed WebP plates total 104,272 bytes, at 512 x 341 per ship
  and 768 x 384 for the carrier. The lower-cost mesh tier and vector/context-
  loss renderer use these Blender renders. The mesh tier also uses them if
  a GLB fails. If all assets fail, immediate procedural ships still represent
  the player and threats. Player/carrier caches use four model/bake identities.
- Models load once with an eight-second timeout. Title previews and normal
  flight share the same class assets. Engine thrust, bank, turn feedback,
  weapon heat, boss barrage and wounded-reactor feedback derive from existing
  presentation/state values. Colliders, damage, scores and attack timers are
  unchanged. Runtime paths end in `-v2`; increment that suffix for a later
  released revision. The service worker does not cache these models or images.
- Pickups use shared fine segmented signal frames and dark caption plates.
  The later alien/pickup pass below replaces their icon art with Blender bakes.
  Original icon art and code-native shapes remain available on asset failure.
- Pause freezes the presentation clock. Reduced effects quiet camera sway,
  weather, velocity streaks, idle ship/enemy banking, pickup rotation,
  expanding impact blooms and the troll's fast rainbow flash. Threat state,
  collection, firing and warnings retain their existing timing.
- WebGL loss selects vector rendering temporarily; restoring the context
  returns to the chosen mesh tier. Saved vector preferences survive reload.
  Failed module loading stays on vector without retrying every frame.
- Entity groups for departed IDs are removed from the scene maps, so waves
  and restarts do not retain every enemy group ever encountered. Shared
  geometry and materials remain reusable.

## Local acceptance

The reference checkout is `4905b12`. Evidence lives in the ignored
`.playwright-mcp/ultra/` directory, including before/after gameplay screenshots,
JSON traces and results. The fixed daily fixture uses the actual game update
and rendering paths and keyboard movement/fire, with actual hits and kills.

The reference traces were captured before this pass. With this checkout's
local dev server running, repeat acceptance:

```sh
npm run check:ultra
npm test
npm run build
```

The runner is restricted to loopback, uses isolated local storage and blocks
external DNS. It compares matching desktop/portrait/landscape gameplay traces,
checks pause, exercises missing image/model assets, saved vector choices,
WebGL initialisation failure, and context loss/restoration. A development-only
probe compares the entire authoritative state before/after rendering and
throws if rendering accesses gameplay RNG. It is stripped from production.
For a fresh reference capture, serve the unchanged reference checkout on its
own port and set `ULTRA_BASE_URL` when running `--baseline`; do not overwrite
the reference traces using the updated art checkout. Put any temporary
reference worktree under `~/WebstormProjects/.worktrees/` and remove it after
verification. This pass's scratch copy and Chrome profiles were removed.

The runner also selects all three ships in the real menu, pilots toward the
wounded carrier using keyboard input, captures its full silhouette, fires in
the boss scene, and compares live mesh versus matching baked quality paths
on desktop, portrait and landscape. GLB-only failure verifies the authored
bake remains visible. `--flight-only` repeats these focused art checks.
The guardian is launched through the menu and flown with movement/fire input;
quitting to the menu verifies departed actor groups are removed.
Presentation-only health fields are omitted from the reference trace schema;
the full state/RNG probe still includes authoritative health.

For a native-clock comparison, run `node tools/ultra-check.mjs --perf` with the
reference checkout on port 5191 and this checkout on port 5190. Both versions
must have isolated Vite caches, and no other game/graphics checks should run
concurrently. The 240-frame sample covers the same nine-enemy combat fixture.

On 2026-10-11, all 82 unit tests and the client/server builds passed. The six
core browser scenarios passed, including identical fixed-input gameplay
traces in three layouts, full state/RNG isolation, pause, reduced effects,
and context loss/restoration. Nine focused flight-art cases passed; all five
boss variants registered hits with actual firing. The final native-clock
sample measured a 16.7 ms median for both versions, with p95 16.8 ms before
and 16.7 ms after, and zero frames over 50 ms. An earlier candidate sample
had one frame over 50 ms; the repeated sample did not reproduce it. The
candidate selected the baked adaptive-quality path in this local sample.

Viewport fixtures, controlled frame clocks and local Chrome measurements are
browser evidence, not physical phone/gamepad acceptance, GPU profiling or
thermal endurance. This pass has no deployment or release authorisation.

## Alien fleet and powerups, 2026-10-11

The remaining seven alien identities now have dedicated Blender masters:
capture-claw abductor, needle hunter, resonator-wing jammer, asymmetric
counterfeit ship, packet-magazine spammer, three-pod Sybil and the corrupt
donkey banker. The six mechanical ships use complete live GLBs with five
shared material batches each, replacing their entire old procedural body.
Sybil shards retain their existing smaller presentation scale. The donkey
uses a sculpted Cycles plate in both renderers so its ears, hat, monocle and
cigar remain visible. Feeding and imminent-pop cues remain live.

All fifteen pickup kinds have modelled source scenes and matching transparent
plates: medical time cross, shield, relay antenna, charge cell, dual zap,
capture net, triple fanout, 600B medallion, rose, cake slice, whole cake,
prohibited hooded figure, 4:20 watch, scooter and red seized-clock padlock.
They use the same plate in mesh and vector. Faces stay toward the player;
quiet rotation, open signal brackets and captions provide motion and identity
without washing the modelled surfaces out. Red trap and purple cult meanings
remain distinct. Collection radius, value, rewards and duration are unchanged.

Masters live in `art/blender/<kind>.blend`; native renders in
`art/bakes/<kind>-v3.png`. The generated `art/alien-pickup-review.png` sheet
documents every new asset. Rebuild with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/art/build-alien-pickup-art.py
python3 tools/art/optimise-alien-pickup-art.py
```

Optional kinds after `--` rerender a subset. The flight authoring file is now
importable without rerendering the previously completed player/boss masters.
No dependencies beyond Blender and Pillow were added.

Six new GLBs total 1,346,972 bytes, with 3,748–8,060 triangles each. New WebPs
total 217,308 bytes. Mechanical enemy plates are 384 x 256; the donkey is
384 x 384; pickups are 256 x 256. The native renders are 768 x 512 for ships,
768 x 768 for the donkey and 512 x 512 for pickups. Decoded RGBA base levels
total 6,881,280 bytes, before mipmaps and renderer copies. Download bytes do
not describe GPU memory. Enemy GLBs load once on first visible encounter;
the shared images preload once. Following the cake regression fix below,
there are 27 image identities: 21 Blender plates and six original cake slices.
The ten model identities and 21 pickup/donkey billboard identities bound
the new shared resources.

Low-cost mode uses the same enemy bakes. GLB failure retains those bakes;
complete image/model failure retains immediate procedural threats and
recognisable pickup drawings. Failed requests are not retried each frame.
The existing stolen-avatar/name, capture, shot and troll feedback stays live.
Reduced effects additionally quiet the donkey feeding pulse. Pause and
context restoration keep the existing presentation-clock behaviour.

Before/after evidence for this extension is in the ignored
`.playwright-mcp/ultra-alien-before/` and `ultra-alien-after/` directories. The
baseline includes the completed player/boss pass. Repeat with the server on
5190:

```sh
ULTRA_OUT=.playwright-mcp/ultra-alien-after ULTRA_REFERENCE=.playwright-mcp/ultra-alien-before node tools/ultra-check.mjs
ULTRA_OUT=.playwright-mcp/ultra-alien-after node tools/ultra-check.mjs --families-only
node tools/ultra-check.mjs --cold-current
```

`?combat&daily&artfamilies` is a development-only, unranked review fixture.
It arranges actual enemies and all pickup kinds in the normal playfield;
production strips this extra fixture. Keyboard movement, shots, hits and
pickup collection still use the real simulation. Its state arrangement is
separate from the normal `?combat` seed used for trace/performance comparison.

The six core browser cases and nine previous flight cases passed, including
identical desktop/portrait/landscape fixed-input traces, pause, context loss
and restoration. Six additional family cases passed: desktop, portrait,
landscape, vector, GLB failure and all-assets failure. All new art identities
were checked for ready/failure status and their actual rendering paths. Real
keyboard movement/fire registered hits and collected pickups in every family
case. Full-state/camera invariance and zero gameplay RNG calls were verified.
All 82 unit tests and client/server builds passed. The existing Three chunk
size advisory remains.

The native-clock nine-enemy sample used one active page, 60 warm-up frames,
240 measured frames, identical viewport/scene and no concurrent graphics jobs.
Both before and after measured 16.7 ms median and p95, with zero frames over
50 ms. Both chose adaptive baked art. Draw calls decreased from 426 to 186;
retained geometries were 66 then 94, and textures 32 then 40. These local
Chrome results do not establish physical-device GPU or thermal performance.
With browser caching disabled, simulated 100 ms latency and 2.5 MB/s download,
recognisable play began in the immediate vector path at 2.14 s; all new
sprites and six lazy GLBs were ready at 5.54 s. The upgrade preserved the
entire authoritative state/camera and made zero gameplay RNG calls. These
are local dev-server timings, not production/CDN or physical-device timings.
No release, deployment or physical-device acceptance was performed.

### Cake and title-loadout regression fixes

The fleet pass accidentally preferred a generic Blender cake slice over the
six accepted `public/pickups/600b/cake-piece-N.png` illustrations. Both Canvas
and Three now select those original numbered icing designs using the real
beacon `spriteIndex`. Every slice has its own bounded shared billboard; all
other pickups retain their Blender artwork. The generic slice master and
bake remain as authoring history, but are no longer requested by gameplay.
The six 192x192 originals total 95,876 bytes; the shared active image set is
307,448 download bytes and 7,503,872 decoded RGBA base-level bytes, excluding
mips and renderer duplication. Pickup collision, rewards, TTL and variant
randomness are unchanged.

Normal menu launches already carried all three selected ship classes into
the game. The reproduced failure was an armed Daily gauntlet: its fixed
Interceptor/Normal rules overrode the player's choice while the title still
previewed a different ship. The title now displays the actual Daily loadout.
Explicit ship or pressure selection switches to a standard run, including
arrow buttons, keyboard cycling and digit shortcuts. Choosing Daily again
retains the original shared seed and fixed loadout, and preserves the user's
personal choices for standard play.

Local evidence is in `.playwright-mcp/ultra-fixes-before/`,
`ultra-fixes-after/` and `ultra-fixes-core/`. Repeat with:

```sh
ULTRA_OUT=.playwright-mcp/ultra-fixes-after node tools/ultra-check.mjs --selection-only
ULTRA_OUT=.playwright-mcp/ultra-fixes-core ULTRA_REFERENCE=.playwright-mcp/ultra-alien-before node tools/ultra-check.mjs --core-only
```

Eight real pointer menu-launch cases passed: all three classes, choosing a
ship after arming Daily, portrait, vector, complete model failure and an
untouched Daily run. Each case fired through actual gameplay, checked its
launched class/mode, and captured the rendered ship. Four cake cases passed
in desktop, portrait, vector and complete art failure. All six variants were
checked against their image URLs and collected using real keyboard movement.
High, baked/reduced and immediate fallback captures were inspected. The
development-only `?combat&daily&cakes` fixture uses six real beacons and is
stripped from the production bundle.

The six core regressions also passed: the three fixed-input traces remained
identical, pause froze presentation, context loss/restoration and saved
fallback choices worked, and rendering preserved the entire state/camera
with zero gameplay RNG calls. All 82 unit tests and both production builds
passed. These fixes remain local; no deployment or physical-device acceptance
was performed.

## Contact portrait spheres

The mesh renderer already had live spheres. Canvas displayed profile pictures as flat circular
insets inside the glow. Contacts now share one Blender sphere with angular
portrait UVs on both hemispheres. Each existing profile image becomes a
runtime texture; portraits are centre-cropped consistently and rotate with
the actual sphere through complete turns. Both renderers share the original
per-contact spin speed and presentation clock; pause freezes it and reduced
motion holds the textured body still. Surrounding rings retain their effects.
The same shape also carries stolen identities on forgery ships. No profile
data or user artwork is baked into the master or distributed assets.

`art/blender/contact-sphere.blend` is the editable source.
`tools/art/build-contact-art.py` generates the 1,840-triangle, single-batch
41,784-byte GLB and a native transparent 256x256 neutral lighting render.
`tools/art/optimise-contact-art.py` packages the latter into a 4,916-byte WebP.
Blender UV export and texture coordinates follow the [Blender glTF manual](https://docs.blender.org/manual/en/3.3/addons/import_export/scene_gltf2.html);
portrait colour textures use the [Three material colour-space convention](https://threejs.org/docs/pages/MeshStandardMaterial.html).

The WebGL low tier keeps the shared live sphere. A missing/loading GLB uses
an immediate procedural sphere with matching portrait UVs. Canvas projects
the portrait through the same angular mapping into a finite 16-frame cache
of 64x64 views, blending adjacent views to turn the skin smoothly around the
sphere. Rotation views are created only when encountered; lighting stays fixed
as the surface rotates. Canvas then applies the Blender lighting bake.
Missing lighting uses an immediate
radial shading fallback; missing portraits retain a coloured sphere and
the existing labels/initials. No pixel readback is required for remote skins.

Runtime avatar textures are capped at 64 (256x256 each, 16 MiB RGBA base
levels at capacity before mipmaps). Current roster/victim textures are pinned
during eviction; an oversized visible roster retains coloured sphere
overflow. Canvas portraits are separately capped at 32, with at most 16
immutable pose surfaces each (8 MiB RGBA total at capacity).
The neutral lighting image is 256 KiB decoded RGBA. Loading, failed assets,
quality changes and recycled entity IDs cannot change collision, contacts,
rescues, rewards, difficulty or gameplay RNG.

Focused native Chrome evidence is in `.playwright-mcp/ultra-contact-after/`.
Eight cases passed with synthetic cached profile skins: desktop, portrait,
landscape, saved vector, no WebGL, missing contact GLB, missing all model
art, and missing portraits. Captures were inspected at gameplay scale;
skins remain upright and shaded. Every case used normal movement/firing,
and presentation checks preserved state/camera with zero gameplay RNG calls.
Six copied render frames reused all 16 actual contact IDs with 96 distinct
skin identities: the avatar cache settled at 64, renderer texture residency
at 103 including other game art, and geometry residency at 90. Returning to
the original frame restored the correct faces. An 80-image Canvas stress
check retained exactly the configured portrait limit (64 static plates in the
initial pass, 32 sets of rotation views in the rotating revision).

Reproduce with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/art/build-contact-art.py
python3 tools/art/optimise-contact-art.py
ULTRA_OUT=.playwright-mcp/ultra-contact-after node tools/ultra-check.mjs --contacts-only
ULTRA_OUT=.playwright-mcp/ultra-contact-core ULTRA_REFERENCE=.playwright-mcp/ultra-contact-before node tools/ultra-check.mjs --core-only
```

These are local browser checks with test skins, not physical-phone or
authenticated live-profile acceptance. No release was requested or published.

The six core browser regressions also passed, giving 14 browser cases for
this pass. Desktop/portrait/landscape fixed-input traces matched the captured
baseline; pause, reduced effects and context loss/restoration passed. All 82
unit tests and both client/server production builds passed. A sequential,
native-rAF 240-frame, nine-enemy Chrome sample measured the same 16.7 ms
median/p95 before and after, with zero intervals over 50 ms. Draw calls stayed
at 186, geometry residency changed 94 to 95 (the shared authored sphere plus
loading fallback), and textures stayed at 40. This performance sample used
unavailable profiles; synthetic loaded skins and cache capacity were checked
separately above. It does not establish phone/thermal performance.

Rotation revision evidence is in `.playwright-mcp/ultra-contact-rotation/`
and `ultra-contact-rotation-core/`. All eight contact cases verified body
rotation, pause freeze and a stationary reduced-motion body. Both Canvas
cases verified changed skin pixels at a quarter turn and an identical
starting pose after a complete turn, after priming lazy views for readback.
The 32-portrait rotation cache and reused contact identities passed the
capacity/recovery checks. All six core cases passed again, including three
unchanged gameplay traces and context restoration. All 82 unit tests and
the final client/server builds passed. The existing Blender master and
runtime model are unchanged; the rotation uses their full spherical UVs.
