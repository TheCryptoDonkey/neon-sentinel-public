# Neon Sentinel Art Direction

Neon Sentinel should feel like a premium Nostr arcade cabinet: high-speed, radar-first, cinematic, and readable under pressure. The target is not retro imitation. The target is the playability of a golden-age horizontal rescue shooter updated with modern 3D materials, profile-driven identity, and relay-frontier fiction.

## North Star

You are defending real known signals across a hostile relay frontier.

The screen must always answer three questions instantly:

- Where am I?
- Who is being targeted?
- What must I interrupt next?

## Visual Rules

- The radar is the strategic truth layer. It stays compact, sharp, and information-dense.
- The playfield is cinematic, but never at the cost of silhouette clarity.
- Contacts are protected people/signals, not pickups. They render as larger rotating profile spheres with relation-colour halos.
- Abductors must telegraph intent before capture. Capture is a readable beam/lock/progress state.
- The ship must be small, fast, elegant, and lethal. It should never read as a toy.
- Lasers are snap-fire punctuation, not full-screen hoses.
- SAT beacons are rare, large, gold, and obviously risky.
- Effects must inherit velocity and state: engine intensity follows thrust, capture beams charge, radar threat lines heat up, and explosions create short-lived readable shockwaves.

## Palette

Use a broad neon-HDR palette, not a one-note cyan game:

- relay/civilian: mint, jade, pale signal white
- high-WoT: gold, warm white
- threat: crimson, rose, orange
- jammer/spoof: blue-violet, magenta
- ship: white ceramic, cyan glass, black underbody, gold hardpoints
- world: deep teal, ink black, violet/orange nebula accents

## Object Scale

Arcade scale wins over physical realism.

- The ship should occupy roughly 5-7% of screen width.
- Normal enemies should be smaller than the ship but visually louder through colour/motion.
- Contacts should be bigger than normal pickups and emotionally readable.
- Boss/carrier enemies can be large, but only in boss waves.
- Terrain/relay infrastructure should imply scale without blocking gameplay.

## Motion Rules

- The ship snaps into reverse quickly but keeps enough inertia to reward anticipation.
- Camera look-ahead follows speed, not just direction.
- Contacts rotate at all times.
- Abductors visibly settle into lock before pickup.
- Speed streaks appear even at idle subtly, then intensify with thrust.
- Screen shake is reserved for damage, explosions, carrier hits, and hard captures.

## Gameplay Identity

The legendary loop is:

1. Read radar.
2. Reverse hard.
3. Interrupt capture.
4. Catch or save the contact.
5. Decide whether a SAT beacon is worth the route risk.
6. Clear wave pressure without losing the relay.

Everything that does not support this loop is secondary.

## Asset Pipeline Target

The prototype can use procedural Three.js meshes, but production art should move toward authored or generated assets:

- GLB player ship with multiple material slots and animated engine hardpoints.
- GLB enemy families with distinct silhouettes.
- Shader/material library for signal spheres, capture beams, and relay towers.
- GPU or batched particle system for sparks, trails, shockwaves, and implosions.
- Generated or authored relay-frontier backgrounds with layered parallax.

Until then, procedural meshes must stay small, sharp, and readable.
