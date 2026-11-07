#!/usr/bin/env node
/**
 * Transport-level tests for the /mcp endpoint.
 *
 * These exist because the interesting failures are not in the tools,
 * they are in the plumbing: a client that sends a stale session id, a
 * client that only accepts application/json, a serverless cold start
 * that loses the session a previous request minted. Each of those looks
 * to a user like "the connector is broken" and none of them is caught
 * by testing the tools directly.
 *
 * Run: node scripts/test-transport.mjs            (all modes)
 *      TEST_MODE=stateless node scripts/test-transport.mjs
 */

import { spawn } from "node:child_process";

const MODES = ["stateless", "sessions", "no-credentials", "gate-token"];

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function boot() {
  const { buildApp } = await import("../dist/http.js");
  const app = buildApp();
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

/** POST a JSON-RPC message the way a given client would. */
async function rpc(base, body, { accept, sessionId, auth, headers = {} } = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Default to the stingy Accept a lenient client sends, so the
      // happy path is the one we are least sure about.
      accept: accept ?? "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...(auth ? { authorization: auth } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // SSE or an error page; leave json null and let the test report it.
  }
  return { res, text, json };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "transport-test", version: "0" },
  },
};

const TOOLS_LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

/* ------------------------------------------------------------------ */
/* Modes                                                               */
/* ------------------------------------------------------------------ */

/**
 * The default deployment: stateless, single-tenant env credentials.
 * This is how a hosted client that proxies MCP on the user's behalf
 * (xAI's Remote MCP tools, for one) will actually talk to us — each
 * call a fresh HTTP request, no guarantee of sticky routing.
 */
async function modeStateless(base) {
  const init = await rpc(base, INITIALIZE);
  check("initialize succeeds with Accept: application/json only", init.res.status === 200, `status ${init.res.status}: ${init.text.slice(0, 160)}`);
  check(
    "initialize returns a JSON body, not an SSE stream",
    init.json?.result?.serverInfo?.name === "kitchen-mcp-server",
    init.text.slice(0, 160),
  );
  check(
    "initialize mints no session id in stateless mode",
    !init.res.headers.get("mcp-session-id"),
    `got ${init.res.headers.get("mcp-session-id")}`,
  );

  // The critical one: a tools/list on a *different* connection, with no
  // session and no preceding initialize on this instance. A cold lambda
  // is indistinguishable from this.
  const list = await rpc(base, TOOLS_LIST);
  check("tools/list works with no session and no prior initialize", list.res.status === 200, `status ${list.res.status}: ${list.text.slice(0, 160)}`);
  const tools = list.json?.result?.tools ?? [];
  check("tools/list returns the tool set", tools.length > 50, `got ${tools.length} tools`);
  check(
    "workflow tools are NOT exposed by default",
    !tools.some((t) => t.name.startsWith("workflow_")),
    `found: ${tools.filter((t) => t.name.startsWith("workflow_")).map((t) => t.name).join(", ")}`,
  );
  check(
    "kitchen tools are exposed",
    tools.some((t) => t.name === "kitchen_list_boards"),
  );

  // A stale session id — what every client holds after a redeploy.
  const stale = await rpc(base, TOOLS_LIST, { sessionId: "00000000-0000-4000-8000-000000000000" });
  check(
    "a stale session id falls back to stateless instead of 404",
    stale.res.status === 200,
    `status ${stale.res.status}: ${stale.text.slice(0, 160)}`,
  );

  // A spec-compliant client sending both media types must still work.
  const strict = await rpc(base, TOOLS_LIST, {
    accept: "application/json, text/event-stream",
  });
  check("a spec-compliant Accept header still works", strict.res.status === 200, `status ${strict.res.status}`);

  // A full round trip on a request that never saw an initialize. The
  // tool reaches the Kitchen client and fails there on a fake key,
  // which still proves the transport carried the call and the result.
  const call = await rpc(base, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "kitchen_list_boards", arguments: { per_page: 1 } },
  });
  check("tools/call executes statelessly", call.res.status === 200, `status ${call.res.status}: ${call.text.slice(0, 160)}`);
  check(
    "tools/call reaches the handler",
    Boolean(call.json?.result),
    JSON.stringify(call.json?.error ?? {}).slice(0, 200),
  );

  const get = await fetch(`${base}/mcp`, {
    method: "GET",
    headers: { accept: "text/event-stream" },
  });
  check("GET without a session is refused with 405, not left hanging", get.res?.status === 405 || get.status === 405, `status ${get.status}`);
  check("405 advertises the methods we do serve", (get.headers.get("allow") ?? "").includes("POST"));

  const del = await fetch(`${base}/mcp`, { method: "DELETE" });
  check("DELETE without a session is a no-op 204", del.status === 204, `status ${del.status}`);
}

/** MCP_SESSIONS=1: the single-long-lived-process deployment. */
async function modeSessions(base) {
  const init = await rpc(base, INITIALIZE, {
    accept: "application/json, text/event-stream",
  });
  check("initialize succeeds", init.res.status === 200, `status ${init.res.status}: ${init.text.slice(0, 160)}`);
  const sid = init.res.headers.get("mcp-session-id");
  check("initialize mints a session id when sessions are enabled", Boolean(sid), `got ${sid}`);

  if (sid) {
    const list = await rpc(base, TOOLS_LIST, {
      sessionId: sid,
      accept: "application/json, text/event-stream",
    });
    check("a held session serves tools/list", list.res.status === 200, `status ${list.res.status}: ${list.text.slice(0, 160)}`);

    const del = await fetch(`${base}/mcp`, {
      method: "DELETE",
      headers: { "mcp-session-id": sid },
    });
    check("DELETE on a held session is accepted", del.status === 200 || del.status === 204, `status ${del.status}`);
  }
}

/** No credentials anywhere: the client must be told how to authenticate. */
async function modeNoCredentials(base) {
  const init = await rpc(base, INITIALIZE);
  check("a request with no resolvable credentials is refused", init.res.status === 401, `status ${init.res.status}`);
  const header = init.res.headers.get("www-authenticate") ?? "";
  check(
    "401 points at the protected-resource metadata (RFC 9728)",
    header.includes("resource_metadata=") && header.includes("oauth-protected-resource"),
    header,
  );

  const list = await rpc(base, TOOLS_LIST);
  check("tools/list with no credentials is also a 401, not a 400", list.res.status === 401, `status ${list.res.status}`);
}

/** MCP_GATE_TOKEN set: the static-token path a scripted client uses. */
async function modeGateToken(base) {
  const bare = await rpc(base, TOOLS_LIST);
  check("without the gate token the endpoint is closed", bare.res.status === 401, `status ${bare.res.status}`);

  const wrong = await rpc(base, TOOLS_LIST, { auth: "Bearer not-the-token" });
  check("a wrong gate token is rejected", wrong.res.status === 401, `status ${wrong.res.status}`);

  const right = await rpc(base, TOOLS_LIST, { auth: "Bearer test-gate-token" });
  check("the right gate token is accepted", right.res.status === 200, `status ${right.res.status}: ${right.text.slice(0, 160)}`);
  check(
    "and serves the tool set",
    (right.json?.result?.tools ?? []).length > 50,
    `got ${(right.json?.result?.tools ?? []).length}`,
  );

  const viaHeader = await rpc(base, TOOLS_LIST, {
    headers: { "x-mcp-auth": "test-gate-token" },
  });
  check("X-MCP-Auth is accepted as an alternative to the bearer", viaHeader.res.status === 200, `status ${viaHeader.res.status}`);
}

const RUNNERS = {
  stateless: modeStateless,
  sessions: modeSessions,
  "no-credentials": modeNoCredentials,
  "gate-token": modeGateToken,
};

const ENV = {
  stateless: { KITCHEN_API_KEY: "test-key", KITCHEN_WORKSPACE: "testws" },
  sessions: {
    KITCHEN_API_KEY: "test-key",
    KITCHEN_WORKSPACE: "testws",
    MCP_SESSIONS: "1",
  },
  "no-credentials": {},
  "gate-token": {
    KITCHEN_API_KEY: "test-key",
    KITCHEN_WORKSPACE: "testws",
    MCP_GATE_TOKEN: "test-gate-token",
  },
};

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

async function runOne(mode) {
  const { server, base } = await boot();
  try {
    await RUNNERS[mode](base);
  } finally {
    server.close();
  }
}

async function main() {
  const mode = process.env.TEST_MODE;

  if (mode) {
    if (!RUNNERS[mode]) {
      console.error(`unknown TEST_MODE: ${mode}`);
      process.exit(2);
    }
    console.log(`\n${mode}`);
    await runOne(mode);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }

  // config.ts reads process.env once at import, so each mode needs its
  // own process rather than a mutated environment.
  let failed = 0;
  for (const m of MODES) {
    console.log(`\n${m}`);
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [new URL(import.meta.url).pathname], {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          LOG_LEVEL: "silent",
          TEST_MODE: m,
          ...ENV[m],
        },
        stdio: "inherit",
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });
    if (code !== 0) failed += 1;
  }

  console.log(
    failed ? `\n${failed} mode(s) failed` : "\nall transport modes passed",
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
