# Kitchen MCP Server

A hosted, multi-tenant [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the [Kitchen.co](https://developer.kitchen.co) client-portal API to MCP-compatible AI clients (Claude, ChatGPT, Cursor, etc.) over secure Streamable HTTP.

- Per-request Kitchen credentials passed via HTTP headers — one deployment can serve many tenants without ever storing their API keys.
- Dedicated typed tools for tasks, docs, clients, companies, invoices, conversations, messages, boards, lists, folders, milestones, labels, webhooks, files, and members.
- `kitchen_request` escape hatch for any endpoint not yet wrapped.
- Defence-in-depth: helmet, CORS allow-list, DNS-rebinding protection, per-tenant rate-limit, payload caps, log redaction, optional gate token.

## Quick start (local)

```bash
npm install
cp .env.example .env       # configure as needed
npm run build
npm start
# server is now listening on http://127.0.0.1:3000/mcp
```

## Quick start (Docker)

```bash
docker build -t kitchen-mcp .
docker run --rm -p 3000:3000 \
  -e ALLOWED_ORIGINS=https://claude.ai \
  -e MCP_GATE_TOKEN=$(openssl rand -hex 32) \
  kitchen-mcp
```

## How clients connect

Point any MCP client at `https://<your-host>/mcp` (Streamable HTTP transport). Send the following headers on every request:

| Header | Required | Description |
|---|---|---|
| `X-Kitchen-API-Key` | yes (per-tenant) | Kitchen bearer token from **Settings → API & Webhooks → API Tokens** |
| `X-Kitchen-Workspace` | yes (per-tenant) | Workspace subdomain (e.g. `acme` for `acme.kitchen.co`) |
| `Authorization: Bearer <MCP_GATE_TOKEN>` | required if `MCP_GATE_TOKEN` is set | Optional shared bearer that gates access to the MCP endpoint itself |
| `Mcp-Session-Id` | no | Only meaningful when `MCP_SESSIONS=1` (see below). Harmless otherwise — a session id the server does not recognise is ignored, not rejected. |

Both Kitchen headers may instead be supplied via the `KITCHEN_API_KEY` / `KITCHEN_WORKSPACE` env vars for single-tenant deployments.

### Sessions are off by default

The server answers every request on its own, without needing to have
seen an `initialize` from that client first. This is deliberate.

MCP session state lives in the serving process's memory. On a serverless
host — Vercel, Lambda, Cloud Run scaled to zero — the next request lands
in *different* memory, so a session id minted by one request 404s on the
next, and the client reports the connector as randomly broken. Nothing
this server does needs session affinity: there are no subscriptions, no
sampling, no server-initiated messages.

Consequences worth knowing:

- `initialize` returns no `Mcp-Session-Id`, and a stale one from before a
  redeploy is ignored rather than refused.
- `GET /mcp` answers `405` — there is no standalone SSE stream to open.
  Clients treat this as "no server-initiated messages", which is true.
- Responses are plain JSON, not a one-message SSE stream. More proxies
  and hosted clients handle that correctly.
- Replies tolerate `Accept: application/json` alone, which several real
  clients send despite the spec asking for both media types.

Set `MCP_SESSIONS=1` only on a single long-lived process (Fly.io,
a container, a VM).

### Claude Desktop example

```json
{
  "mcpServers": {
    "kitchen": {
      "transport": {
        "type": "http",
        "url": "https://kitchen-mcp.example.com/mcp",
        "headers": {
          "Authorization": "Bearer YOUR_MCP_GATE_TOKEN",
          "X-Kitchen-API-Key": "kc_live_xxxxxxxxxxxxxxxx",
          "X-Kitchen-Workspace": "acme"
        }
      }
    }
  }
}
```

### Grok (xAI)

Two different routes, depending on what "Grok" means here.

**The Grok app** (grok.com) — `Connectors` → `New Connector` → `Custom`,
then paste `https://<your-host>/mcp`. Grok's servers call the URL from
the public internet, so the host must be publicly reachable; a localhost
server needs a tunnel. Authentication is whatever the server asks for,
which for this one is the OAuth flow at `/oauth/authorize` (so
`MCP_GATE_TOKEN` must be set — it doubles as the login password).

**The xAI API** — Grok connects to MCP servers itself when you pass one
in the `tools` array. No OAuth needed: `authorization` sets the
`Authorization` header and `extra_headers` carries the rest, so the
static-token path works directly.

```python
from xai_sdk import Client
from xai_sdk.chat import user
from xai_sdk.tools import mcp

client = Client(api_key=os.environ["XAI_API_KEY"])
chat = client.chat.create(
    model="grok-4.7",
    tools=[
        mcp(
            server_url="https://<your-host>/mcp",
            server_label="kitchen",
            server_description="Kitchen.co client portal and the deliverable workflow.",
            authorization=os.environ["MCP_GATE_TOKEN"],
            extra_headers={
                "X-Kitchen-API-Key": os.environ["KITCHEN_API_KEY"],
                "X-Kitchen-Workspace": "acme",
            },
            # Omit to expose all ~120 tools. Naming them keeps the model
            # focused and, for a read-only subset, keeps it harmless.
            allowed_tool_names=[
                "workflow_board_status",
                "workflow_get_deliverable",
                "workflow_compliance_preview",
                "kitchen_list_boards",
                "kitchen_list_tasks",
            ],
        )
    ],
)
chat.append(user("What is sitting in compliance review?"))
print(chat.sample().content)
```

On the OpenAI-compatible Responses API the same thing is
`{"type": "mcp", "server_url": ..., "server_label": ..., "authorization": ...,
"headers": {...}, "allowed_tools": [...]}`. `require_approval` and
`connector_id` are not supported there.

Note that `ALLOWED_ORIGINS` does **not** gate either route: a
server-to-server caller sends no `Origin` header and is allowed through
by design. Endpoint access is `MCP_GATE_TOKEN`'s job.

## Security model

| Layer | Control |
|---|---|
| Transport | HTTPS terminated upstream; the server speaks plain HTTP behind your load balancer. |
| Endpoint access | Optional shared bearer gate (`MCP_GATE_TOKEN`) compared in constant time. |
| Tenancy | Kitchen API key + workspace are **per request**; never persisted; redacted from logs. |
| Origin | DNS-rebinding protection enforced by the MCP SDK transport; CORS allow-list configurable. |
| Rate limiting | 60 req/min default (matches Kitchen's published limit); per-tenant fingerprint to keep tenants isolated. |
| Payload | JSON body capped at 1 MiB; Kitchen response bodies capped at 2 MiB before parsing. |
| Path safety | `kitchen_request` passthrough rejects paths outside `/api/...` and disallows `//`. |
| Process | Container runs as non-root with healthcheck. |

> **Note:** You still need to terminate TLS upstream (Cloud Run, Fly.io, Vercel, nginx, ALB, etc.). The server is designed to sit behind a proxy.

## Available tools

Tool names follow the pattern `kitchen_<verb>_<resource>`. A non-exhaustive overview:

- Tasks: `kitchen_list_tasks`, `kitchen_get_task`, `kitchen_create_task`, `kitchen_update_task`, `kitchen_delete_task`, `kitchen_toggle_task_completion`, `kitchen_move_tasks`
- Subtasks: `kitchen_list_subtasks`, `kitchen_create_subtask`, `kitchen_update_subtask`, `kitchen_delete_subtask`
- Task labels/members/comments: `kitchen_add_task_label`, `kitchen_remove_task_label`, `kitchen_add_task_member`, `kitchen_remove_task_member`, `kitchen_list_task_comments`, `kitchen_create_task_comment`
- Docs: `kitchen_list_docs`, `kitchen_get_doc`, `kitchen_create_doc`, `kitchen_update_doc`, `kitchen_archive_doc`, `kitchen_restore_doc`, `kitchen_move_doc`, `kitchen_delete_doc` + doc memberships
- Clients & companies: full CRUD
- Invoices & recurring invoices: list/get/create/update/archive/restore/delete
- Conversations & messages: full CRUD + archive/restore
- Structure: boards, lists, folders, milestones, labels, members, templates
- Webhooks: CRUD
- Files: `kitchen_create_file_upload`, `kitchen_complete_file`, `kitchen_get_file`, `kitchen_delete_file`
- Low-level: `kitchen_request` — any `/api/...` path

Call `tools/list` from your MCP client for the full, schema-rich catalogue.

## Webhook receiver

This server also runs a verified Kitchen-webhook ingress at `POST /webhooks/kitchen`. It is **off by default** — enable it by setting `KITCHEN_WEBHOOK_SECRETS`.

### Set up

1. In Kitchen, create a webhook (Settings → API & Webhooks → Webhooks) pointed at `https://<your-host>/webhooks/kitchen`, subscribe to the events you want, and copy the generated `secret`.
2. Set `KITCHEN_WEBHOOK_SECRETS=<secret>` on the server. Multiple secrets (comma-separated) are supported so you can run several Kitchen workspaces or rotate without downtime — the receiver tries each in constant time.
3. (Optional) Set `KITCHEN_WEBHOOK_FORWARD_URL` if your actual handler lives elsewhere. The verifier POSTs the verified event JSON to that URL with an optional `X-Forward-Token` header (`KITCHEN_WEBHOOK_FORWARD_TOKEN`).

### Guarantees

- **Signature verification.** HMAC-SHA256 over the **raw request bytes** as received, compared in constant time. Matches Kitchen's [best-practices doc](https://developer.kitchen.co/webhooks/best-practices) exactly. Re-encoding the body is *not* used — that would be fragile across JSON serializers.
- **Idempotency.** Each `event.id` is processed at most once in a 24-hour window (Kitchen retries up to 3 times with backoff). Duplicates ack 200 so Kitchen stops retrying.
- **Asynchronous dispatch.** The receiver acks Kitchen as soon as the signature and shape are verified; downstream forwarding is fire-and-forget so a slow consumer can't time out the webhook.
- **Body cap.** 1 MiB hard cap.
- **No rate-limit on the webhook path.** Kitchen's retries should never be dropped at the edge.

### Response codes

| Code | Meaning |
|---|---|
| `200 {"ok":true}` | Verified, accepted, dispatching now. |
| `200 {"ok":true,"duplicate":true}` | Replay of an event we already processed. |
| `401 {"error":"invalid_signature"}` | Missing or wrong `Signature` header. |
| `400 {"error":"invalid_json"}` / `invalid_event_shape` / `empty_body` | Malformed payload. |
| `503 {"error":"webhook_receiver_not_configured"}` | `KITCHEN_WEBHOOK_SECRETS` is empty. |

### Extending the dispatcher

By default the dispatcher just logs the event and (optionally) forwards it. To wire in your own handler, edit `src/webhooks/dispatcher.ts` — `WebhookDispatcher.dispatch(event)` is the single integration point. Switch on `event.type` (e.g. `task.created`, `invoice.paid`, `client.updated`) and call your code from there.

```ts
async dispatch(event: KitchenWebhookEvent): Promise<void> {
  switch (event.type) {
    case "invoice.paid":     await onInvoicePaid(event.data); break;
    case "task.created":     await onTaskCreated(event.data); break;
    case "client.updated":   await onClientUpdated(event.data, event.previous_attributes); break;
    default: logger.debug({ type: event.type }, "unhandled webhook");
  }
}
```

### Verifying locally

```bash
SECRET='whsec_...your_secret...'
PAYLOAD='{"id":"evt_test","type":"task.created","created":1719322973,"data":{}}'
SIG=$(node -e "const c=require('crypto');process.stdout.write(c.createHmac('sha256','$SECRET').update('$PAYLOAD').digest('hex'))")
curl -X POST http://127.0.0.1:3000/webhooks/kitchen \
  -H "Content-Type: application/json" \
  -H "Signature: $SIG" \
  --data "$PAYLOAD"
```

## Deployment recipes

### Fly.io

```bash
fly launch --no-deploy --copy-config --name kitchen-mcp
fly secrets set MCP_GATE_TOKEN=$(openssl rand -hex 32) \
                ALLOWED_ORIGINS=https://claude.ai
# One long-lived process, so stateful sessions are safe here.
fly secrets set MCP_SESSIONS=1
fly deploy
```

### Google Cloud Run

```bash
gcloud run deploy kitchen-mcp \
  --source . \
  --region us-central1 \
  --port 3000 \
  --set-env-vars=ALLOWED_ORIGINS=https://claude.ai \
  --set-env-vars=TRUST_PROXY=1 \
  --set-secrets=MCP_GATE_TOKEN=kitchen-mcp-gate:latest
```

### Render / Railway / Heroku

Standard Node web service — set `PORT`, `ALLOWED_ORIGINS`, `MCP_GATE_TOKEN`, run `npm start`.

### Vercel

`src/server.ts` is the entrypoint. It imports `buildApp` from the
pre-built `dist/http.js` rather than from `src/`, because `@vercel/node`
runs its own `tsc` pass with different compiler options and will not
build the TypeScript sources correctly.

Leave `MCP_SESSIONS` unset. Serverless functions do not share memory
between invocations, so stateful MCP sessions break on the first cold
start. `GET /healthz` reports `mcp.sessions` and `mcp.gated` so you can
confirm what the deployed function actually has.

## Development

```bash
npm install
npm run dev        # tsx watch
npm run typecheck
npm test           # workflow logic + HTTP transport
```

`scripts/test-workflow.mjs` covers the state machine, gates, compliance
rules, the metadata and evidence codecs, and the AU state regimes.

`scripts/test-transport.mjs` boots the real app on an ephemeral port and
exercises `/mcp` the way awkward clients do: a stingy `Accept` header, a
stale session id, a `tools/call` with no preceding `initialize`, a bare
`GET`, a missing gate token. Those are the failures that read as "the
connector is broken", and none of them is visible from testing the tools
directly.

## Rate limits

Kitchen itself caps API usage at 60 requests/minute/user (200 with a raised limit) and 5 file uploads/minute. The MCP server applies its own per-tenant 120 req/min default at the HTTP edge; tune via `HTTP_RATE_LIMIT_PER_MINUTE`. Retries on `429`/`5xx` use the `Retry-After` header when present.

## License

MIT
