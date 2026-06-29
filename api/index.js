// Vercel serverless entrypoint.
// Express app instances are functions with the (req, res) signature, so
// exporting the app as the default makes Vercel invoke it directly per
// request.
//
// NOTE: This deployment target is fine for the /webhooks/kitchen
// receiver (stateless verify + ack + fire-and-forget dispatch). The
// /mcp endpoint relies on in-memory session state that does NOT survive
// cold starts on serverless — for production MCP use Fly.io, Cloud Run,
// Railway, or any long-running host.

import { buildApp } from "../dist/http.js";

const app = buildApp();
export default app;
