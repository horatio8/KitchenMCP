// Vercel serverless entrypoint.
//
// `@vercel/node` bundles this TypeScript file (and everything it imports
// from src/) into a single serverless function. Express app instances
// are functions with the (req, res) signature, so exporting the app
// makes Vercel invoke it directly per request.
//
// NOTE: This deployment target is fine for the /webhooks/kitchen
// receiver (stateless verify + ack + fire-and-forget dispatch). The
// /mcp endpoint relies on in-memory session state that does NOT survive
// cold starts on serverless — for production MCP use Fly.io, Cloud Run,
// Railway, or any long-running host.

import { buildApp } from "../src/http.js";

const app = buildApp();
export default app;
