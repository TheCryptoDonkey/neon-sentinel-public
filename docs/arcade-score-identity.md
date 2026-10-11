# Arcade score identity

The public client attempted a normally earned 6,326-point personal run under a
different guest key after its arcade parent closed. Both HTTP attempts were
blocked by the private fixture; no public score was published. See the
[published failure](evidence/neon-published-guest-substitution.json). Its entry
hash was independently refreshed; the deployed Git revision is unknown.

The candidate removes automatic guest fallback and captures the original
account in each personal run. NIP-98 and direct score signatures must match that
account and the exact original template, with a fresh signature check that
excludes cached verification metadata. Explicit guest gameplay remains available.

Personal runs now persist before signing in an account-bound recovery queue.
SAVED SCORES opens a selectable retry dialog after reload or at the end of a
run. Only the current account's receipts appear. RECONNECT ACCOUNT requires the
original account and a working signer; retry stays explicit. Duplicate attempts
share one pending approval and request. Positive publication acknowledgement
clears only that account's selected run; unconfirmed responses retain it.
The queue refuses overflow, damaged storage and quota errors without evicting
unpublished runs. Signature waits and request/response-body waits are bounded.
Signing failure never converts a personal run to guest or starts a payment.

Signet Login is pinned to 0.17.3 and its vendored bundle is checked against the
locked package during builds. Startup waits for a delayed SDK, consumes validated
redirect callbacks before session restoration, and rejects invalid callbacks.
Restored identity alone does not qualify as a live signer. The Android signer
URI is generic; Cambium and Amber physical compatibility remains unqualified.

Validation: all 101 unit tests, type checks and client/server builds pass.
Four of the first five identity regressions fail on unchanged source. The
[private browser recovery check](evidence/neon-personal-recovery-ui-local.json)
uses seeded public receipts and a simulated Signet/publisher, blocks external
writes and public relay sockets, and checks reload, delayed SDK, invalid/valid
callbacks, wrong-account reconnect, held approval, unconfirmed retention,
selective clearing, keyboard isolation and 44-pixel controls at 390 pixels wide.
The [normal-play check](evidence/neon-personal-recovery-earned-local.json)
earns 7,974 points without game-state injection, closes the arcade parent,
persists the original-account receipt after timeout, makes no claim request,
and returns to the signed-in title. It does not prove provider reconnect or
publication. Historical core-only proof remains separately available in
[evidence](evidence/neon-candidate-closed-parent.json).

This is a draft candidate, not yet published or physically accepted. Hosted CI
will archive the exact checked client and recovery proof. Actual My Signet
same-account reconnect, independently visible publication, physical signer
checks and deployment verification remain required for full consumer acceptance.
