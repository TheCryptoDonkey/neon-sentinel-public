# Arcade score identity

The current public client attempted a normally earned 6,326-point personal
run under a different guest key after its arcade parent closed. Both HTTP
attempts were blocked by the private fixture. No public score was published;
see [published failure](evidence/neon-published-guest-substitution.json).
The public entry hash was independently refreshed. The deployed Git revision
is unknown; the matching fallback code is in this public repository.

The candidate removes automatic guest fallback. A personal summary captures
its account from the run state, and switched-account retry is rejected before
requesting a signature. Returned NIP-98 and direct-publication events must
match the original account and exact canonical template with a fresh signature
check; cached verification metadata is discarded. Explicit guest runs remain
available. Signing failure keeps the local result and requests reconnect.

The first five regression tests produce four failures and one pass on unchanged
source. The corrected suite also checks missing personal ownership and explicit
guest signing. The complete unit suite, type checks and client/server builds
pass. A private normal-play browser check is in progress.

This is a draft candidate. It is not published or physically accepted. A
selectable persisted personal-score retry panel, complete same-account
reconnect/reload recovery and actual My Signet acceptance remain required
before treating the consumer recovery goal as complete. Existing local-score
storage is not yet a complete recovery outbox.
