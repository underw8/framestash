---
paths:
  - "extension/page.js"
---
# Page-world GraphQL bridge

- Never call the story "seen" mutations.
- Replies are untrusted; the panel validates them with `itemsFromNode`.
- Provided variables (query flags) come from each query's definition, never hard-coded.
- Instagram's JSON block replies pass through as `login` / `checkpoint` / `spam` flags; don't retry them here.
- Each request gets exactly one reply on its port, carrying `requests` (GraphQL requests made) for the budget.
- Query details drift: re-check with docs/playbook.md steps 1-5 and update docs/instagram-api.md when they change.
