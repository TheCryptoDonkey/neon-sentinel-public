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

The personal-recovery client `5dcf1b4` is active on Hetzner after hosted CI and
exact archive checksum verification. All 106 staged client files and 99 preserved
API files match; the API process remains 480607. Public HTML, version and service
worker match. Public verification then rejects the fixed SDK URL: it returns the
previous release's bytes although the origin has the locked new bundle. See
[partial deployment proof](evidence/neon-live-5dcf1b4-partial.json). That rollout
is not fully qualified. The follow-up uses a versioned SDK filename, checked
against the same locked package, to avoid the stale fixed-path asset.

The real SDK picker also exposed two local input failures. Enter on a provider
button opened the underlying game support prompt and prevented native button
activation. After guarding keyboard input, the accelerated idle demo still
started behind the dialog. Both now pass with keyboard and idle modal guards;
native Escape cancels login and retains the original receipt. See
[modal regression proof](evidence/neon-sdk-modal-regressions.json). These checks
use the actual SDK picker with a restored-identity fixture, blocked sockets and
external writes; they do not prove My Signet provider approval. All 101 unit
tests, builds, recovery UI and SDK modal checks pass locally.

Hosted CI now archives both the whole client and a hash manifest for every
checked file, plus its small code archive. This allows reuse of byte-identical
media without trusting a rebuilt client or downloading large media again.
The `59f6452` follow-up passes hosted CI run 38104841854 and both browser
checks against its exact archived code and full file manifest. It is now active
on Hetzner. All 107 staged client files and 99 preserved API files match; public
HTML, version, service worker, versioned SDK and entry JS/CSS pass exact-byte
checks. Process 480607 stays running, with its environment unchanged. See
[live proof](evidence/neon-live-59f6452.json),
[checked recovery](evidence/neon-recovery-checked-59f6452.json) and
[checked SDK modal](evidence/neon-modal-checked-59f6452.json).
Actual same-account My Signet reconnect/publication and physical acceptance
remain required for complete consumer acceptance.
An actual My Signet attempt stopped at initial arcade signer readiness before
any earned run or claim; it does not qualify recovery.

### Delayed recovery policy still open

Read-only inspection of the deployed compiled API on 11 October confirms
`STALE_RUN_MS = 10 * 60 * 1e3` and `stale_run` rejection. Source validates
run age before accepted-claim lookup, and prunes its cache after thirty minutes.
The current private recovery fixtures use recent runs; they do not qualify
publication after that window. Persistent receipts need compatible delayed
acceptance, durable idempotency and explicit owner-controlled handling of
permanently rejected receipts. Original timestamps must stay unchanged. No API
process, configuration or server code was changed by the client deployments.

A server candidate now accepts delayed runs with fresh NIP-98, serializes
acceptance, and durably stores the canonical signed event before relay writes.
Account/run ID is permanent; changing an accepted payload returns 409. An
unconfirmed relay write retries the same stored event after restart. Corrupt
history fails closed. Legacy unconfirmed rows without a saved event return
`recovery_event_missing` rather than fabricating a replacement. Original run
timestamps remain in the journal and score content.

The private compiled-API gate passes a seven-day-old run, no-ack persistence,
process restart and same-event publication, duplicate and concurrent retry,
changed-run rejection, future clock rejection, stale NIP-98 rejection, legacy
missing-event handling and corrupt-history refusal. It uses disposable keys
and simulated relay acknowledgements; no external writes or live provider.
All 101 units and both typechecks pass. CI now runs this gate and archives the
checked API with a source revision and SHA-256 manifest. This candidate is not
yet deployed; the current production ten-minute limit remains until deployment
and verification. See [API fixture proof](evidence/neon-api-delayed-recovery-candidate.json).

Saved-run recovery now offers REMOVE SELECTED RUN with an explicit native
confirmation naming its points and the irreversible removal of this device's
retry copy. It leaves published scores untouched. Cancel preserves all receipts;
confirmation removes only the selected account/run. Removal is disabled while
approval or submission is pending, and rechecks the active owner/generation
before changing storage. Server stale/conflict/missing-event rejections now
have readable player-facing labels. The private browser fixture passes cancel,
confirmation, other-account preservation, pending-control guards and all prior
recovery assertions at 390 × 844.

Hosted `723b087` run 38118195811 passes the API and account-bound recovery
gates but fails before opening the SDK picker: the accelerated attract demo
starts during setup and intercepts the saved-score click. The keyboard driver
now uses the real Escape input to return to the title before opening login.
Enter activation, four-second idle hold, Escape cancellation and original
receipt assertions remain unchanged and pass locally with the actual SDK.
No product attract timing or keyboard assertions were relaxed. Full hosted
qualification and both client/API deployment remain required.

The `869e80c` hosted gate also fails before opening login: returning to title
through Escape does not prevent the accelerated demo hiding the saved-score
button during setup. A private regression focuses that button and waits four
seconds; unchanged source switches to playing and hides the focused control.
The product now blocks idle demos while a DOM control owns keyboard focus,
and pointer movement resets title inactivity. The focused-control regression
passes. The actual SDK check separately blurs its active control, verifies no
interactive control owns focus, then holds the open dialog for four seconds;
Enter activation and Escape cancellation still pass. See
[focused-control proof](evidence/neon-focused-recovery-controls.json). This is
a product correction, not qualification of the earlier hosted failures.

The API journal also retains the previous timestamp-based on-disk key format
for rollback compatibility. Its new loader normalises that key to permanent
account/run identity, while an older API can still find a recent accepted
claim after rollback. The private compiled-API gate verifies the exact legacy
key and restart/same-event deduplication. See
[rollback-compatible API proof](evidence/neon-api-rollback-compatible.json).
A read-only check finds two valid confirmed legacy rows in the default server
history, with no unconfirmed legacy rows; actual environment/state-path and
checked-artifact deployment verification remain required. Production remains
unchanged until the full candidate gate passes.
