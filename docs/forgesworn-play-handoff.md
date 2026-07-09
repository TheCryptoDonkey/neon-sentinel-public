# forgesworn-play handoff

Date: 2026-05-27

## One-line purpose

`forgesworn-play` is the shared ForgeSworn game scoring/signing toolkit for Pallasite, Neon Sentinel, and future arcade games: canonical `kind 30762` score events, NIP-98 player claims, server-side game signing, payout clamps, and relay-safe publishing.

It should be gamestr-compatible, but it is not the gamestr brand. Gamestr is Nathan's convention/ecosystem; ForgeSworn Play is our MIT implementation library and integration layer.

## Why it exists

Pallasite and Neon Sentinel are already converging on the same shape:

- browser game records a final run summary
- player signs/authenticates a claim
- server verifies the claim and clamps any sats payout
- server signs the authoritative game score as `kind 30762`
- score writes go only to the game write relay set
- public relays are used for profile/WoT reads, not polluted with game writes

That logic should not stay duplicated inside each game.

## Package shape

Primary package:

- npm: `forgesworn-play`
- repo: `forgesworn/forgesworn-play`
- licence: MIT
- TypeScript first, ESM-only, ES2022
- no hardcoded game ids or relays
- no private keys in browser code

Later package/crate:

- Rust crate: `forgesworn-play`
- purpose: shared event/tag/claim validation for native/WASM games such as Axenstax
- do this after the TypeScript API has stabilised in Neon Sentinel and Pallasite

## Core TypeScript API

Likely modules:

- `score`
  - build canonical `kind 30762` tags
  - parse/validate `kind 30762` events
  - define shared score summary and run metrics types
- `claim`
  - build claim payloads
  - verify claim shape
  - bind claim to player pubkey, game id, run id, timestamps, score, wave, duration, sats
- `nip98`
  - client helper to sign a claim request
  - server helper to verify the request against method, URL, body hash, timestamp window
- `server`
  - claim handler primitives for `/api/claim`
  - pluggable payout policy
  - pluggable replay/nonce store
  - pluggable game signer
- `relays`
  - read/write relay separation helpers
  - multi-relay publish result reporting

## Server endpoint model

Each game should expose:

```text
POST /api/claim
Authorization: Nostr <NIP-98 event>
Content-Type: application/json
```

Request body is a game claim payload.

Server flow:

1. Verify NIP-98 signature and body hash.
2. Extract player pubkey from the NIP-98 event.
3. Validate claim schema and game id.
4. Reject replayed run ids / nonces.
5. Clamp score, duration, sats, and payout policy.
6. Build canonical `kind 30762`.
7. Sign with the game key on the server.
8. Publish only to configured write relays.
9. Return event id, payout status, and relay publish counts.

## Canonical event shape

Neon Sentinel currently follows:

```text
kind: 30762
pubkey: <game pubkey>
["d", "<game>:<player_pubkey>:<run_id>"]
["game", "<game>"]
["p", "<player_pubkey>"]
["score", "<score>"]
["state", "final"]
["wave", "<wave>"]
["duration", "<seconds>"]
["rescues", "<count>"]
["known_rescues", "<count>"]
["lost", "<count>"]
["sats", "<credited_sats>"]
["max_combo", "<count>"]
["t", "arcade"]
["t", "nostr"]
["t", "<game>"]
```

Game-specific tags are allowed, but the shared library should keep the stable core small.

## Neon Sentinel concrete config

Game id:

```text
neonsentinel
```

Game signing identity:

```text
npub1xuq53wm49lh820yd6sm82t5qrupfz0du0trrxzpg6y742sxyegssntwz40
```

Derived via:

```text
nsec-tree derive path neon-sentinel
path: neon-sentinel@0
```

Relay policy:

- write: Pallasite-compatible gamestr fan-out: `wss://relay.gamestr.io`, `wss://relay.trotters.cc`, `wss://nos.lol`, `wss://relay.damus.io`, `wss://relay.nostr.band`, `wss://relay.primal.net`, `wss://relay.ditto.pub`
- read: public Pallasite/nostr profile relays, toggleable, read-only
- public score fan-out is limited to the configured write relay set; profile/WoT relay toggles do not add extra score-write destinations

## Non-goals

`forgesworn-play` should not be:

- a game engine
- a renderer
- a music/SFX package
- a Lightning wallet
- a full economy system
- a Signet login replacement
- a relay crawler
- a hardcoded Pallasite or Neon Sentinel SDK

## First extraction target

Extract from Neon Sentinel and Pallasite:

- `src/scoring.ts` style score tags and claim payload types
- `/api/claim` server signing flow
- relay read/write separation
- publish success/fail reporting
- tests for tag stability, claim validation, payout clamps, replay rejection, and relay routing

## Suggested first milestone

Milestone 0.1:

- `buildScoreTags`
- `buildScoreEventDraft`
- `buildClaimPayload`
- `verifyClaimPayload`
- `verifyNip98ClaimRequest`
- `createClaimHandler`
- `publishToRelays`
- in-memory replay store for tests
- documented adapter examples for Neon Sentinel and Pallasite

Milestone 0.2:

- durable replay store adapters
- stronger payout policy helpers
- heartbeat / active-run support
- Rust validator crate scaffold

## Important guardrails

- Do not put nsecs in docs, client code, examples, screenshots, or tests.
- Game keys live server-side only.
- Make all relays explicit in config.
- Treat write relays and profile-read relays as different classes.
- Keep the library small and composable; follow the ForgeSworn one-lib-per-purpose pattern.
- Public docs should describe generic games, not leak private deployment details unless the repo is private.
