# Gamestr listing submission

Everything gamestr needs for https://gamestr.io/neonsentinel, ready to send.
Scores already publish to `wss://main.relay.gamestr.io` in the spec's kind-30762
shape, game-signed, and the claim service republishes the game's kind-0
profile on every boot so the listing metadata stays fresh on the relays.

## Metadata

| Field | Value |
|---|---|
| **Name** | Neon Sentinel |
| **Game identifier** (`game` tag) | `neonsentinel` |
| **Description** | A radar-first Nostr rescue shooter with Defender-style waves, a seeded daily gauntlet, and 600B pressure. Hold the relay, save the keys, don't get TIME LOCKED. |
| **Play URL** | https://neonsentinel.com/ |
| **Icon** (512×512) | https://neonsentinel.com/brand/icon-512.png |
| **Banner / key art** | https://neonsentinel.com/brand/neon-sentinel-key-art-v2.png |
| **Genres** | arcade, shooter, action |
| **Platform** | web (desktop + mobile, PWA) |

## Score signing (for the verified badge)

| Field | Value |
|---|---|
| **Signing model** | Game developer pubkey — a server-side claim service validates each run (NIP-98 authed `/api/claim`) and signs the kind-30762 with the game key; players never sign scores |
| **Game dev npub** | `npub1xuq53wm49lh820yd6sm82t5qrupfz0du0trrxzpg6y742sxyegssntwz40` |
| **Game dev pubkey (hex)** | `370148bb752fee753c8dd436752e801f02913dbc7ac6330828d13d5540c4ca21` |
| **Event shape** | kind 30762, `d` = `neonsentinel:<player-pubkey>:<run-id>`, `state` = `final`, player attributed via `p` tag; daily-gauntlet runs carry a `daily-YYYYMMDD-` run-id prefix |
| **Kind 0** | Published by the game key (name, about, picture, banner, website) — republished on every claim-service boot |
| **Relays published to** | main.relay.gamestr.io, relay.trotters.cc, nos.lol, relay.damus.io, relay.nostr.band, relay.primal.net, relay.ditto.pub |

## Ready-to-send message

> Hi — details for the Neon Sentinel listing (https://gamestr.io/neonsentinel).
>
> **Neon Sentinel** (game id `neonsentinel`) is a free web-based radar-first
> Nostr rescue shooter with Defender-style waves, a seeded daily gauntlet, and
> 600B pressure. Hold the relay, save the keys, don't get TIME LOCKED. Play at
> https://neonsentinel.com/
>
> Scores are game-dev signed (kind 30762, per your spec) by
> `npub1xuq53wm49lh820yd6sm82t5qrupfz0du0trrxzpg6y742sxyegssntwz40` — a
> server-side claim service validates each run before signing, so I'd like
> that pubkey registered for the verified badge. The game key also publishes
> its own kind-0 profile (name, icon, banner, about) to your relay.
>
> Icon: https://neonsentinel.com/brand/icon-512.png
> Banner: https://neonsentinel.com/brand/neon-sentinel-key-art-v2.png
> Genres: arcade, shooter, action
>
> PS — small fix for the Hang On, Fren listing while you're in there: it says
> "endless", but the game has a real ending (ten regions, one finish line —
> reaching it wins the grand tour). Suggested wording: "A Riviera Vespa
> road-tribute starring DNI — ten regions, one finish line. Grab the roses,
> sink the beers (carefully), don't run out of road."
