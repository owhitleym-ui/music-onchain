# Design snapshot verification — November 19, 2026

The original frontend application and existing tests were copied without changing
login, wallet, approval, signing, payment, pricing, storage, or UI behavior.
Pinned dependencies and the package lock are unchanged. Added design tooling is
limited to instructions, a protected-file checksum guard, and a frontend CI job.

- Existing frontend tests: **109 passed**, zero failures.
- Design guard: **31 protected files match** the reviewed baseline.
- Guard rejection check: a simulated edit to `auth.jsx` was rejected; the file
  was restored exactly and the guard passed again.
- Staged upload audit: no server settings or values matching the three local
  server secrets, no common token/private-key patterns, and no `node_modules`,
  private environment files or generated builds.
- Clean dependency installation (`npm ci`): passed.
- Production build from the clean installation: **passed**.
- The 109 frontend tests also passed again with the clean installation.

The tests mock account/backend behavior. The owner previously verified real
email registration, wallet restoration and automatic account approval. Real
$5/$20/$50 participant checkout acceptance remains unfinished; do not treat a
passing design CI run as proof of real payments. The owner's backend and private
configuration are not shared in this design branch.

After visual changes, repeat the three commands in DESIGN-HANDOFF.md and review
mobile/desktop, light/dark, keyboard focus, disabled/pending/error states, the
explicit payment confirmation and sample/account separation. Integration back
into the owner's latest working app needs its own review and account/payment
checks before merging.
