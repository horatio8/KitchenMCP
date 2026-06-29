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
| `Mcp-Session-Id` | after initialise | Session ID returned by the server on `initialize` |

Both Kitchen headers may instead be supplied via the `KITCHEN_API_KEY` / `KITCHEN_WORKSPACE` env vars for single-tenant deployments.

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

## Development

```bash
npm install
npm run dev        # tsx watch
npm run typecheck
```

## Rate limits

Kitchen itself caps API usage at 60 requests/minute/user (200 with a raised limit) and 5 file uploads/minute. The MCP server applies its own per-tenant 120 req/min default at the HTTP edge; tune via `HTTP_RATE_LIMIT_PER_MINUTE`. Retries on `429`/`5xx` use the `Retry-After` header when present.

## License

MIT
