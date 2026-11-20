# Branch scope

The full-project integration branch `codex/full-app-step5` contains the owner-authorized functional snapshot. It is not a design-only change. The design baseline and guard are retained unchanged for design collaboration; do not regenerate them to accept integration changes. The design-only guidance below applies to work targeting `frontend-design` or `design/**`.

# Frontend design branch

The user requested visual improvements to the original Vite/React consumer app
in this folder. The separate team app in `apps/web/`, contracts, backend, and
root deployment settings are outside this design task.

- Read `DESIGN-HANDOFF.md` before editing.
- Improve layout, colors, typography, spacing, icons, charts and responsive
  behavior. Keep the current Vite/React stack and pinned dependencies.
- Keep authentication, account approval, wallet selection, signing, payment
  recovery, API endpoints, dollar math and purchase options unchanged.
- Preserve data-action/data-* hooks, input IDs, form behavior, dialog roots,
  keyboard/focus behavior, and visible payment/approval states when editing UI.
- The choices remain $5 = 1 spot, $20 = 4 ordinary entries in one transaction
  with no bonus, and $50 = 10 spots with the existing conditional multiplier.
- Keep `Demo — no real money`, sample/account separation, explicit payment
  confirmation, and real failure/pending states. Never fake account approval,
  a successful payment, a balance or a backend response for a design preview.
- Do not edit protected files, tests, the guard manifest, the guard script or
  the GitHub workflow to get a design change to pass. Request integration review
  if functional changes are necessary.
- Run `npm run check:design`, `npm test`, and `npm run build` in this folder.
- Do not commit private env files, keys, generated dependencies or builds.
- Work on a design branch and open a pull request targeting `frontend-design`.
  Do not merge into `main` or change hosting configuration as part of this task.
