// Vercel serverless entrypoint.
//
// Express app instances are functions with the (req, res) signature, so
// exporting the constructed app as the default makes Vercel invoke it
// directly per request.
//
// We import from the compiled `dist/` so Vercel does NOT re-run a
// TypeScript compile of our source with its own (different) tsconfig —
// our own `npm run build` step (auto-run from package.json#scripts.build)
// produces dist/ first, then @vercel/node bundles this JS entry and its
// dependencies. The "includeFiles" hint in vercel.json keeps the full
// dist tree in the function payload.
//
// NOTE: This deployment target is fine for the /webhooks/kitchen
// receiver (stateless verify + ack + fire-and-forget dispatch). The
// /mcp endpoint relies on in-memory session state that does NOT survive
// cold starts on serverless — for production MCP use Fly.io, Cloud Run,
// Railway, or any long-running host.

import { buildApp } from "../dist/http.js";

const app = buildApp();
export default app;
