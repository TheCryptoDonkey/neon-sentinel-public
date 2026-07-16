# Neon Sentinel Design

**Title:** Neon Sentinel  
**Descriptor:** A Nostr arcade rescue shooter
**Line:** Hold the relay. Save the keys.

Neon Sentinel is the Pallasite sibling for a fast horizontal rescue-arcade shape: patrol, radar-first triage, abductors, rescues, escalating waves, and rare credit beacons. The Nostr theme is structural, not decorative: the people on the ground are the player's known signals from their web of trust.

## Core Loop

1. Patrol a horizontally wrapping relay frontier.
2. Abductors descend toward known signals.
3. Shoot the abductor before it escapes.
4. Catch the falling signal and bank a rescue.
5. If a signal is taken off-screen, a hostile spoof is created.
6. Rare 600B value beacons appear as roses, cake slices, full cake drops, or orange 600B medallions; taking them should be a route-risk decision.

The radar is mandatory. The game should be played through peripheral awareness and the minimap as much as through the ship's immediate lane; Neon Sentinel should treat the radar as a first-class playfield.

## Arcade Rescue, Not Copycat

Neon Sentinel should capture genre lessons without copying protected expression:

- keep the playable principles: whole-world radar triage, fast reversal, horizontal patrol, abduction pressure, rescue catches, instant-feeling laser shots, and escalating enemy roles
- avoid copying any classic game's specific ship/enemy silhouettes, terrain art, names, sounds, scoring table, exact wave compositions, UI copy, or audiovisual presentation
- make the fiction and mechanics Neon Sentinel-native: known Nostr signals, forged identities, relay jammers, WoT priority, NIP-85 reputation, rare 600B value beacons, and gamestr.io signing
- tune by feel against the arcade principle, not by cloning exact timings or assets

## WoT and NIP-85

The first playable uses a mocked roster. The production roster should resolve from:

- NIP-02 follows and mutual follows
- profile metadata for display names / pictures
- NIP-85 `kind 30382` user-subject trusted assertions, especially `rank`
- a game-default provider if the player has not declared providers with `kind 10040`

High-WoT and mutual contacts should matter visually and emotionally, but not dominate raw leaderboard score. The leaderboard must stay skill-first.

Avoid saying a lost player "turns evil". If an abduction completes, the game creates a **spoof** or **forged signal**. The player is defending people from impersonation and capture, not attacking their friends.

## Score Events

Neon Sentinel follows the Pallasite scoring convention: `kind 30762` is canonical.

Successful runs should publish a game-signed final score event:

```text
kind: 30762
pubkey: <neonsentinel game pubkey>
["d", "neonsentinel:<player_pubkey>:run-<run_id>"]
["game", "neonsentinel"]
["p", "<player_pubkey>"]
["score", "<score>"]
["state", "final"]
["wave", "<wave>"]
["duration", "<seconds>"]
["rescues", "<count>"]
["known_rescues", "<count>"]
["mutual_rescues", "<count>"]
["wot_rescues", "<count>"]
["lost", "<count>"]
["credits", "<run_credits>"]
["sats", "0"]
["max_combo", "<count>"]
["playerName", "<display_name>"]
["playerMode", "guest|nostr"]
["t", "arcade"]
["t", "rescue-shooter"]
["t", "nostr"]
["t", "neonsentinel"]
```

Live watch cards should reuse the Pallasite heartbeat pattern with `state=active`.

## NIP-98 and Claims

The player authenticates the claim with NIP-98. The server validates the payload, signs the `kind 30762`, and publishes to the game relay set. Neon Sentinel is not a faucet: `sats_claimed`, `sats`, and `payout_sats` stay at `0`. Optional value-for-value support is presented separately after game over with a reusable Lightning QR.

Relay policy:

- Score writes use the Pallasite-compatible gamestr fan-out: `wss://main.relay.gamestr.io`, `wss://relay.trotters.cc`, `wss://nos.lol`, `wss://relay.damus.io`, `wss://relay.nostr.band`, `wss://relay.primal.net`, and `wss://relay.ditto.pub`.
- Public Pallasite/profile relays remain toggleable read sources for kind 0, follows, and related metadata.
- Profile relay toggles must never add extra Neon Sentinel `kind 30762` write destinations.

Credit beacons must be much rarer than Pallasite:

- normal rescue: no credits
- known-signal rescue: tiny roll
- mutual / high-WoT rescue: slightly better roll
- perfect wave: guaranteed low-value beacon
- relay-breaker / boss kill: beacon burst

The in-game object should be large and unmistakable: a rotating Bitcoin-styled credit beacon, not coin dust or a payout promise.

## NIP-85 Output

Neon Sentinel can also act as a NIP-85 provider. After verified runs, the game/provider key can publish user-subject trusted assertions:

```text
kind: 30382
pubkey: <neonsentinel assertion provider pubkey>
["d", "<player_pubkey>"]
["rank", "<0-100 guardian rank>"]
["neonsentinel_verified_runs", "<count>"]
["neonsentinel_best_wave", "<wave>"]
["neonsentinel_known_rescues", "<count>"]
["neonsentinel_guardian_class", "sentinel"]
["t", "neonsentinel"]
```

NIP-85 is the machine-readable reputation layer. NIP-58 badges can mirror visible achievements for clients that render trophies.

## Pallasite Reuse

Reuse:

- Signet login / restore / sign queue
- guest identity
- NIP-98 score claim pattern
- game-signed `kind 30762`
- live heartbeat/watch surface shape
- radar design lessons
- rotating 3D/pseudo-3D power-up feel
- WebGL mesh overlay pattern, with vector fallback
- post-process presentation modes as a portable canvas library
- future deterministic replay work

Do not reuse:

- asteroid physics as the core loop
- dense sat-drop economy
- Pallasite's wave/lore copy

## First Playable Target

The checked-in prototype should prove:

- fast horizontal patrol feels good
- radar gives enough information to route
- abductors create rescue pressure
- known-signal names make the stakes personal
- sat beacons feel rare and worth chasing

## Extraction Status

Pulled into the first Neon Sentinel prototype:

- Pallasite generated space backdrop as the relay frontier base.
- Pallasite-style whole-world radar with visible-strip box.
- Pallasite-inspired post effects in `src/postfx.ts`: clean, CRT, synthwave, hologram, blueprint, VHS.
- Cinematic HDR/bloom post effect is now the default; CRT/VHS stay optional for retro presentation.
- Settings strip for visual tier and presentation mode.
- Split relay config in `src/relays.ts`: fixed gamestr-facing score write set, public Pallasite/profile relays as read-only toggles.
- Default `3D MESH` tier, with `VECTOR` available as a low-cost/classic fallback.
- Lightweight Three.js mesh overlay for the ship, abductors/spoofs, known signals, and large 600B value beacons.
- Ship model now targets high-speed pseudo-inertia: strong horizontal acceleration, aggressive reverse thrust, retained drift, snappy vertical thrusters, collision response, and camera look-ahead.
- Gameplay pressure now includes whole-world abductor spawns, hostile bolts, relay jammers, hunter enemies, radar disruption, particle bursts, screen shake, and stronger pickup/rescue feedback.
- Radar has been promoted to a primary play surface: larger field, clearer entity symbols, threat lines, visible-window frame, laser traces, carried-signal rings, and off-screen abduction tells.
- Local `kind 30762` claim payload builder in `src/scoring.ts`; server signing still comes later.
- Signet browser bundles copied under `public/signet/` for the future login/claim path.
- A Neon Sentinel soundtrack player now mirrors the Pallasite pattern: persisted master/music/SFX mix, gesture warm-up, state-driven title/wave/game-over crossfades, and a settings-panel track picker.
- Lightweight synthesized arcade audio engine in `src/audio.ts`: engine bed follows thrust/speed, capture tone follows active abduction lock, and short event sounds fire on laser, hits, kills, rescues, damage, credit pickups, bursts, pressure hunters, and wave starts.
- Live feel tuning panel in settings for thrust, reverse, drag, threat speed, laser range, capture lock timing, actor scale, and contact scale. The panel now includes baked ARCADE, CINEMA, and HARD presets, a reset-to-arcade action, and a compact readout. `?debug=1` shows the current tuning readout in the HUD while playing.
- Two seasoning enemy roles beyond the core five, each with vector sprites, 3D meshes, and radar codes: the **spammer** (`S`, blue-violet mine-layer that cruises the frontier in bombing passes and seeds pulsing spam mines) and the **sybil** (`Y`, pink identity cluster that looms at standoff range and splits into two fast shards when destroyed). Spammers arrive from wave 5 (600B: 4), sybils from wave 6 (600B: 5).
- Two rare universal pickups shared by both beacon economies: **zap** (gold bolt, 8-second double-score window with a HUD ×2 tag) and **net** (mint lattice, 7-second auto-catch aura that hauls falling signals to the ship). Both roll only on value-2+ beacons.
- 600B pressure tier tightened: spawnScale 1.14, enemySpeed 1.02, liftLockScale 0.62, carrySpeedScale 1.12, rescueWindowScale 0.94, rescue beacon drops trimmed to 10/7/4.5% and beacon TTL to 9.6s. Lives stay at 4.
- Title polish: VECTOR/3D render as matched pills, value-for-value buttons use outline styling so START GAME is the only solid-gold call to action, and the keyboard hint is shorter.
- The one-more-go pass (2026-07-03), eight features that make the cabinet compulsive:
  - **Extends**: an extra ship banks every 50,000 points (a burst cell when the rack is full), with a dedicated six-note fanfare distinct from the pickup 1UP.
  - **Instant retry**: `R` on any game-over stage relaunches in one keypress; nostr claims publish in the background, a guest bypassing name entry keeps the score local (same as SKIP).
  - **Rival chase**: the leaderboard becomes a mid-run ladder — the HUD shows the next real score to beat (`NEXT ▲ 60,761 DAZ`, right-aligned under the chain readout), overtakes celebrate with a sting and advance to the next rung, and your own best sits on the ladder as `YOUR BEST`.
  - **Earned bursts**: the smart burst is earned, not just found — a perfect wave (no ships lost, no contacts forged) and every carrier kill arm a cell, still capped by the ship's burst rack.
  - **Combo escalation**: kill chains blip a rising `comboTick` per link (pitch multiplier threaded through the synth helpers), score popups grow with the chain, and Grandpa announces "Chain! Times eight!" once per chain (`public/sfx/chain-times-eight.m4a`).
  - **Gamepad**: polled Gamepad API — stick/dpad move, A/R2 fire, B/X/bumpers burst, Start pauses in play and doubles as the start key on menus.
  - **Daily gauntlet**: a shared seeded run per UTC day (title toggle next to START, or `?daily`). Everyone flies interceptor/NORMAL; all gameplay randomness flows through `rand()`, reseeded per wave from the date seed so drift cannot compound. The run marks itself via the `daily-YYYYMMDD-` runId prefix in the score event's d tag — zero server changes — and the game-over panel plus rival ladder switch to the day's board.
  - **Attract mode**: idle on the title for ~26 s and a bot flies a silent demo (wave 3 start, watchable-not-good AI, earned-burst theatre), with a flashing PRESS ANY KEY banner and the live top-5 board. Nothing publishes or records; any input exits.
- Debug params added: `?score=N` seeds the run score (extend/rival verification), `?attract` drops the attract idle delay to ~2.6 s, `?daily` arms the daily gauntlet.

The postfx module is intentionally game-agnostic. If it holds up in Neon Sentinel, it should graduate into a shared package used by Pallasite, Neon Sentinel, and future gamestr.io arcade titles.
