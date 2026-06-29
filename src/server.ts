// Vercel's Express framework detector loads this file as the
// serverless entrypoint and expects the default export to be an
// Express app (which itself is a (req, res) handler).
//
// The detector also requires a DIRECT `import express` in the
// candidate file before it will accept it — an indirect import via
// our http.ts is not enough. The annotation below keeps the symbol in
// scope so TypeScript does not strip the import.
//
// Local/Docker deployments still run via src/index.ts which calls
// app.listen().
//
// NOTE: On serverless targets the /mcp endpoint is unreliable —
// session state lives in memory and is lost across cold starts.
// /webhooks/kitchen is fine (stateless verify + ack + fire-and-forget
// dispatch).

import express from "express";
import { buildApp } from "./http.js";

const app: express.Express = buildApp();
export default app;
