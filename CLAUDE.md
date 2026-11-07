# KitchenMCP

A hosted MCP server for the Kitchen.co client portal, used by Teller
Consulting (workspace `teller.kitchen.co`).

## Working agreements

- **Answer in dot points.** Standing instruction.
- **Out of scope** unless asked for directly: electoral-law or
  authorisation compliance, and the workflow-automation layer
  (`src/workflow/`, `WORKFLOW_TOOLS_ENABLED`, off by default — do not
  volunteer it).
- **Do not open a pull request** unless explicitly asked.
- Develop and push on `claude/kitchen-mcp-server-yaxsga`.

## Sending a finished artefact for approval

Follow `docs/APPROVAL-PATTERN.md` whenever a deliverable goes to a
client for approval. In short: verbatim copy into a Google Doc, client
gets edit access, file it under `Teller > Clients > <Client>` in Drive
as the archive, then embed that doc in the client's shared Kitchen
folder and grant the client membership.

Use an **embed** (`pe_…`) for this, never a doc (`doc_…`). A Kitchen
doc has no writable body, so a doc can be created and never filled.

## Embedded Google documents must open without a login

Every Google document embedded in Kitchen is shared with **anyone with
the link**, role **writer**:

```
share_file  fileId: <id>  permissionId: "anyoneWithLink"  role: "writer"
```

The client is not in the Teller Google Workspace. Share it with named
accounts only and the embed shows them a Google sign-in wall inside the
portal. Set this before embedding, confirm it with
`get_file_permissions`, then pass `link_sharing_confirmed: true` to
`kitchen_create_embed`.

This does mean anyone holding the URL can edit. That is a deliberate
trade for login-free editing; see the tradeoff note in
`docs/APPROVAL-PATTERN.md` and do not use it for contents that would
matter in a stranger's hands.

## Client work must live in a shared folder

Any tool that exposes a doc or embed to a client checks first that a
shared client folder exists, and stops to ask if one does not. Do not
weaken that guard to get a call through; if the precondition fails,
surface the question to the person making the request.

## The documentation is not sufficient on its own

`https://developer.kitchen.co` is incomplete and in places wrong. Three
errors were found only by making live calls, and one was introduced by
trusting the docs over working code (`hex_color` where the live API
demands `color`). Before changing a tool's contract on the strength of
a doc page, make the call.

Facts the docs omit are recorded in `docs/APPROVAL-PATTERN.md` and in
the tool descriptions themselves. Add to those rather than rediscovering.

## Tests

`npm test` runs four suites and must stay green:

- `scripts/test-workflow.mjs` — the (disabled) workflow engine
- `scripts/test-api-contract.mjs` — every tool's method, path and
  payload, asserted without network
- `scripts/test-client-sharing.mjs` — the shared-folder guards
- `scripts/test-transport.mjs` — `/mcp` across four deployment modes

The contract suite exists because the API's shape is not guessable:
updates are `PUT` and never `PATCH`, labels and custom fields are
board-scoped, subtasks and comments nest under their task. All of
those were originally wrong.

## Webhook capture

Every verified webhook is written to Vercel Blob before the delivery is
acked (`src/webhooks/sink.ts`), readable via `kitchen_events_*`. This is
not optional nicety: file thread comments have no read API at all, so
the captured payload is the only retrievable copy of a client's comment
on a piece of creative.
