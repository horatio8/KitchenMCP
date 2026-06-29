// Vercel's Express framework detector loads this file as the
// serverless entrypoint. It requires a direct `import express` to
// recognise the file, and a default export that is an Express app
// (Express apps are themselves (req, res) handlers).
//
// We import the heavy lifting from the already-built dist/ instead
// of from sibling TS files: Vercel's adapter does a second tsc pass
// on transitively-imported TS source with different settings than
// tsconfig.json (no esModuleInterop), which breaks default-imports
// of CJS deps like helmet and express-rate-limit. By importing JS
// directly, the adapter has nothing to recompile.
//
// Local/Docker deployments still run via src/index.ts which calls
// app.listen() — completely independent of this file.
//
// NOTE: On serverless targets the /mcp endpoint is unreliable —
// session state lives in memory and is lost across cold starts.
// /webhooks/kitchen is fine (stateless verify + ack + fire-and-forget
// dispatch).

import express from "express";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- the .js path exists post-build; ts has no .d.ts for it.
import { buildApp } from "../dist/http.js";

const app: express.Express = buildApp();
export default app;
