// Vercel's Express framework detector loads this file as the
// serverless entrypoint and expects the default export to be an
// Express app (which itself is a (req, res) handler).
//
// We build the app from src/http.ts and export it. Local/Docker
// deployments still run via src/index.ts which calls app.listen().
//
// NOTE: On serverless targets the /mcp endpoint is unreliable — session
// state lives in memory and is lost across cold starts. /webhooks/kitchen
// is fine (stateless verify + ack + fire-and-forget dispatch).

import { buildApp } from "./http.js";

const app = buildApp();
export default app;
