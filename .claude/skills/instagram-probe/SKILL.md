---
name: instagram-probe
description: Re-check Instagram's private GraphQL queries that Framestash depends on (query ids, variables, reply shapes, block signals) on a live logged-in tab, and update docs/instagram-api.md. Use when downloads start failing, a reply shape looks wrong, or a doc says "to confirm".
---

# Probe Instagram's queries

Instagram changes its internals without notice. The procedure is in `docs/playbook.md` (steps 1–5). This skill is the short version for a Claude-in-Chrome session (see the `live-check` skill for tab handling).

1. **Session values** (playbook step 1): on a logged-in instagram.com tab, check that `window.require` exists and that `require("LSD").token`, `require("DTSGInitialData").token` and `require("PolarisConfig").getIGAppID()` return values.
2. **Query id and flags** (step 4): `require("<Op>_instagramRelayOperation")` gives the `doc_id`. Each key in `require("<Op>.graphql").params.providedVariables` is sent as `false`.
3. **One request** (step 5): POST `/api/graphql` exactly like `extension/page.js` `graphql()` does (same headers and body fields). Send **one** request per question. The pacing rules exist because Instagram blocks bursts.
4. **Compare** the reply with `docs/instagram-api.md`: the root field, the record shape, `page_info`, the highlight `title`, and the block signals (HTTP 400 with `feedback_required` / `checkpoint_required` / `login_required`).
5. **Update the docs first**: change `docs/instagram-api.md` (mark what you checked live, with the month), then change `page.js` or `naming.js` and run the tests.

Never call the story "seen" mutations, and never send requests in a loop. Report the exact reply fields you saw, not your reading of them.
