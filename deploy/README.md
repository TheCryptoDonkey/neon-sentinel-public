# Neon Sentinel Deployment

## Game Score Signer

Neon Sentinel score claims follow the Pallasite pattern:

- the player signs a NIP-98 `/api/claim` request
- the server validates the run
- the server signs the authoritative `kind 30762` score with the Neon Sentinel game key
- only the game write relay set receives score events

The game signing key lives only on the deployment server:

```sh
sudoedit /etc/neonsentinel-api.env
```

```sh
NEON_SENTINEL_GAME_NPUB=npub1xuq53wm49lh820yd6sm82t5qrupfz0du0trrxzpg6y742sxyegssntwz40
NEON_SENTINEL_GAME_NSEC=nsec1...
NEON_SENTINEL_WRITE_RELAYS=wss://main.relay.gamestr.io,wss://relay.trotters.cc,wss://nos.lol,wss://relay.damus.io,wss://relay.nostr.band,wss://relay.primal.net,wss://relay.ditto.pub
```

`NEON_SENTINEL_GAME_NSEC` may also be a 64-character hex secret. The API refuses to sign if the nsec derives to a different pubkey than `NEON_SENTINEL_GAME_NPUB`.
`NEON_SENTINEL_WRITE_RELAYS` is optional; the default matches Pallasite's gamestr-facing relay fan-out.

After changing the key:

```sh
sudo chmod 600 /etc/neonsentinel-api.env
sudo systemctl restart neonsentinel-api.service
curl -fsS https://neonsentinel.com/api/claim/health
```

Do not put nsecs in Vite env vars, HTML, browser code, screenshots, release notes, or examples.

## Production Host

The default deploy host is `https://neonsentinel.com`, with `app.neonsentinel.com`, `www.neonsentinel.com`, and `neonsentinel.playechoseven.com` served by the same Caddy vhost. The Cloudflare SSL/TLS mode must be `Full (strict)` only after Caddy has issued a valid origin certificate for the production hostnames.

## 600 Billion membership

The claim API fetches the NIP-05 registry at `https://600.wtf/.well-known/nostr.json` (override with `NEON_SENTINEL_600B_URL`) and caches it in memory for 15 minutes. When a claimant's pubkey is listed there, the signed `kind 30762` score event carries `["nip05", "<name>@600.wtf"]` and `["t", "600b"]` tags — the game key's own attestation of membership, so clients cannot forge it. If 600.wtf is unreachable the signer keeps the last good roll and claims are never blocked; `/api/claim/health` reports the roll size and fetch time under `sixhundred`.

## Operations

- **`claims.jsonl` is append-only and never rotated by the service itself.** It is the durable audit log of every accepted claim (`NEON_SENTINEL_CLAIM_LOG`, default `/var/lib/neonsentinel/claims.jsonl`) and grows without bound over the life of the deployment. Rotate it externally (e.g. `logrotate`, or a periodic archive-and-truncate cron job) rather than deleting it live — the service only appends and re-reads it once at startup.
- The in-memory replay-protection map (keyed by pubkey/run/timestamps) is self-pruning: entries older than three times `STALE_RUN_MS` (30 minutes) are dropped on each new claim, so restarts and long uptimes don't need manual intervention there. Rotating `claims.jsonl` does not affect this — the in-memory map is rebuilt from the log at startup and then prunes itself independently.
- `/api/claim` and `/api/profile-image` are rate-limited per client IP (from `X-Forwarded-For`, which Caddy sets). If clients behind a shared NAT or corporate proxy start seeing `429 rate_limited`, that's the token bucket, not a Caddy/relay issue.
