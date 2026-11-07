#!/usr/bin/env node
/**
 * The shared-client-folder guard.
 *
 * These assertions exist because the failure they prevent is silent.
 * Kitchen will let a doc be shared with a client while it sits at the
 * workspace root or inside a private folder: the client can open it by
 * link, and nobody can find it by browsing. Nothing errors. The only
 * way to catch a regression here is to assert the guard fires.
 *
 * The folder list is stubbed rather than fetched, so the test states
 * the rule instead of depending on how the live workspace happens to
 * be organised today.
 *
 * Run: node scripts/test-client-sharing.mjs
 */

import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { buildToolRegistry } from "../dist/tools/index.js";

const originalDispatcher = getGlobalDispatcher();

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

/* ------------------------------------------------------------------ */
/* A fake Kitchen, so the guard is tested and the network is not.      */
/* ------------------------------------------------------------------ */

const SHARED = {
  id: "fo_shared",
  name: "Acme: Client Work",
  visibility: "shared",
  description: null,
  archived_at: null,
};
const PRIVATE = {
  id: "fo_private",
  name: "Internal",
  visibility: "private",
  description: null,
  archived_at: null,
};

/**
 * Install a fake Kitchen at the network layer.
 *
 * undici's MockAgent rather than a module stub: ES module exports are
 * immutable, and intercepting the socket has the better property
 * anyway — the real URL building, query encoding and error mapping all
 * run, so a mistake in any of them shows up here.
 */
async function withKitchen(routes, fn) {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const pool = agent.get("https://test.kitchen.co");
  const calls = [];

  pool
    .intercept({
      path: (path) => {
        for (const [pattern] of routes) {
          if (pattern.test(path.split("?")[0])) return true;
        }
        return false;
      },
      method: () => true,
    })
    .reply((opts) => {
      const path = opts.path.split("?")[0];
      calls.push(`${opts.method} ${path}`);
      for (const [pattern, responder] of routes) {
        if (pattern.test(path)) {
          const body = responder({ method: opts.method, path });
          if (body && body.__status) {
            return { statusCode: body.__status, data: body.__body ?? {} };
          }
          return { statusCode: 200, data: body ?? {} };
        }
      }
      return { statusCode: 500, data: {} };
    })
    .persist();

  try {
    return await fn(calls);
  } finally {
    await agent.close();
    setGlobalDispatcher(originalDispatcher);
  }
}

/** Invoke one registered tool's handler directly. */
function toolHandler(name) {
  const reg = buildToolRegistry();
  const captured = new Map();
  reg.bind(
    {
      registerTool: (toolName, _meta, handler) => captured.set(toolName, handler),
    },
    () => ({ credentials: { apiKey: "test", workspace: "test" } }),
  );
  const handler = captured.get(name);
  if (!handler) throw new Error(`tool not registered: ${name}`);
  return async (args) => {
    const res = await handler(args, {});
    const text = res?.content?.[0]?.text ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
}

const folders = (list) => [
  [/^\/api\/folders$/, () => ({ data: list })],
  [/^\/api\/folders\/fo_shared$/, () => SHARED],
  [/^\/api\/folders\/fo_private$/, () => PRIVATE],
];

/* ------------------------------------------------------------------ */
/* kitchen_create_doc                                                  */
/* ------------------------------------------------------------------ */

async function testCreateDoc() {
  const create = toolHandler("kitchen_create_doc");

  // No shared folder anywhere: stop and ask.
  await withKitchen([...folders([PRIVATE])], async (calls) => {
    const res = await create({ title: "Brief", visibility: "shared" });
    check(
      "shared doc with no shared folder in the workspace stops and asks",
      res.status === "needs_user_decision" && res.reason === "no_shared_client_folder",
      JSON.stringify(res).slice(0, 180),
    );
    check(
      "it asks a question a human can answer",
      typeof res.question === "string" && /set one up/i.test(res.question),
      res.question,
    );
    check(
      "it offers the exact call that would create the folder",
      res.options?.[0]?.tool === "kitchen_create_folder" &&
        res.options[0].arguments.visibility === "shared",
      JSON.stringify(res.options),
    );
    check(
      "and it never reached POST /api/docs",
      !calls.includes("POST /api/docs"),
      calls.join(", "),
    );
  });

  // Shared folders exist but none was named: stop and ask which.
  await withKitchen([...folders([SHARED, PRIVATE])], async (calls) => {
    const res = await create({ title: "Brief", visibility: "shared" });
    check(
      "shared doc with no folder named stops and asks which folder",
      res.reason === "shared_folder_not_specified",
      JSON.stringify(res).slice(0, 180),
    );
    check(
      "the candidate folders are returned, shared only",
      res.shared_folders?.length === 1 && res.shared_folders[0].id === "fo_shared",
      JSON.stringify(res.shared_folders),
    );
    check("no doc was created", !calls.includes("POST /api/docs"), calls.join(", "));
  });

  // A folder was named, but it is private: stop and ask.
  await withKitchen([...folders([SHARED, PRIVATE])], async (calls) => {
    const res = await create({ title: "Brief", visibility: "shared", folder: "fo_private" });
    check(
      "a client doc aimed at a private folder is refused",
      res.reason === "folder_not_shared",
      JSON.stringify(res).slice(0, 180),
    );
    check("no doc was created", !calls.includes("POST /api/docs"), calls.join(", "));
  });

  // The correct call: shared visibility, shared folder. Proceeds.
  await withKitchen(
    [...folders([SHARED]), [/^\/api\/docs$/, () => ({ id: "doc_ok", visibility: "shared" })]],
    async (calls) => {
      const res = await create({ title: "Brief", visibility: "shared", folder: "fo_shared" });
      check("shared doc in a shared folder is created", res.id === "doc_ok", JSON.stringify(res));
      check("it did reach POST /api/docs", calls.includes("POST /api/docs"), calls.join(", "));
    },
  );

  // Private and internal docs are none of the guard's business.
  await withKitchen(
    [[/^\/api\/docs$/, () => ({ id: "doc_private", visibility: "private" })]],
    async (calls) => {
      const res = await create({ title: "Notes", visibility: "private" });
      check("a private doc is unaffected by the guard", res.id === "doc_private");
      check(
        "and the guard did not even list folders for it",
        !calls.some((c) => c.includes("/api/folders")),
        calls.join(", "),
      );
    },
  );
}

/* ------------------------------------------------------------------ */
/* kitchen_create_doc_membership                                       */
/* ------------------------------------------------------------------ */

async function testMembership() {
  const grant = toolHandler("kitchen_create_doc_membership");

  const CLIENT = [/^\/api\/clients\/u_client$/, () => ({ id: "u_client", group: "client" })];
  const NOT_FOUND = { __status: 404, __body: { message: "No query results for model [App\\User]" } };

  // A client grant with no shared folder: stop and ask.
  await withKitchen([...folders([PRIVATE]), CLIENT], async (calls) => {
    const res = await grant({ doc_id: "doc_1", role: "document_editor", user: "u_client" });
    check(
      "granting a client access with no shared folder stops and asks",
      res.reason === "no_shared_client_folder",
      JSON.stringify(res).slice(0, 180),
    );
    check(
      "no membership was created",
      !calls.some((c) => c.includes("memberships")),
      calls.join(", "),
    );
  });

  // A company target is always treated as a client.
  await withKitchen([...folders([PRIVATE])], async (calls) => {
    const res = await grant({ doc_id: "doc_1", role: "document_editor", company: "co_1" });
    check("a company target is treated as a client", res.reason === "no_shared_client_folder");
    check(
      "and no client lookup was needed for it",
      !calls.some((c) => c.includes("/api/clients/")),
      calls.join(", "),
    );
  });

  // With a shared folder present, the grant proceeds.
  await withKitchen(
    [
      ...folders([SHARED]),
      CLIENT,
      [/memberships$/, () => ({ id: "nms_1", role: "document_editor" })],
    ],
    async (calls) => {
      const res = await grant({ doc_id: "doc_1", role: "document_editor", user: "u_client" });
      check("with a shared folder present the grant proceeds", res.id === "nms_1", JSON.stringify(res));
      check(
        "and it reached the memberships endpoint",
        calls.some((c) => c.includes("memberships")),
        calls.join(", "),
      );
    },
  );

  // A teammate is not a client: guard skipped entirely.
  await withKitchen(
    [
      [/^\/api\/clients\/u_mate$/, () => NOT_FOUND],
      [/memberships$/, () => ({ id: "nms_2", role: "document_admin" })],
    ],
    async (calls) => {
      const res = await grant({ doc_id: "doc_1", role: "document_admin", user: "u_mate" });
      check("a teammate grant is not guarded", res.id === "nms_2", JSON.stringify(res));
      check(
        "and no folder lookup happened",
        !calls.some((c) => c.includes("/api/folders")),
        calls.join(", "),
      );
    },
  );
}

/* ------------------------------------------------------------------ */
/* kitchen_update_doc                                                  */
/* ------------------------------------------------------------------ */

async function testUpdateDoc() {
  const update = toolHandler("kitchen_update_doc");

  await withKitchen([...folders([PRIVATE])], async (calls) => {
    const res = await update({ id: "doc_1", visibility: "shared" });
    check(
      "flipping a doc to shared with no shared folder stops and asks",
      res.reason === "no_shared_client_folder",
      JSON.stringify(res).slice(0, 180),
    );
    check("no update was issued", !calls.some((c) => c.startsWith("PUT")), calls.join(", "));
  });

  await withKitchen(
    [[/^\/api\/docs\/doc_1$/, () => ({ id: "doc_1", title: "Renamed" })]],
    async (calls) => {
      const res = await update({ id: "doc_1", title: "Renamed" });
      check("a rename is unaffected by the guard", res.title === "Renamed");
      check(
        "and triggers no folder lookup",
        !calls.some((c) => c.includes("/api/folders")),
        calls.join(", "),
      );
    },
  );
}


/* ------------------------------------------------------------------ */
/* kitchen_create_embed — the object the approval pattern actually     */
/* relies on, since a Kitchen doc has no writable body.                */
/* ------------------------------------------------------------------ */

async function testCreateEmbed() {
  const create = toolHandler("kitchen_create_embed");
  // link_sharing_confirmed is set throughout: these assertions are about
  // the folder guard, and the Google sharing check runs first and would
  // otherwise answer every one of them.
  const args = {
    title: "Media Release (editable)",
    url: "https://docs.google.com/document/d/abc/edit",
    visibility: "shared",
    link_sharing_confirmed: true,
  };

  await withKitchen([...folders([PRIVATE])], async (calls) => {
    const res = await create(args);
    check(
      "shared embed with no shared folder stops and asks",
      res.reason === "no_shared_client_folder",
      JSON.stringify(res).slice(0, 180),
    );
    check("no embed was created", !calls.includes("POST /api/embeds"), calls.join(", "));
  });

  await withKitchen([...folders([SHARED, PRIVATE])], async (calls) => {
    const res = await create(args);
    check(
      "shared embed with no folder named stops and asks which",
      res.reason === "shared_folder_not_specified",
      JSON.stringify(res).slice(0, 180),
    );
    check("no embed was created", !calls.includes("POST /api/embeds"), calls.join(", "));
  });

  await withKitchen([...folders([SHARED, PRIVATE])], async (calls) => {
    const res = await create({ ...args, folder: "fo_private" });
    check(
      "a client embed aimed at a private folder is refused",
      res.reason === "folder_not_shared",
      JSON.stringify(res).slice(0, 180),
    );
    check("no embed was created", !calls.includes("POST /api/embeds"), calls.join(", "));
  });

  await withKitchen(
    [...folders([SHARED]), [/^\/api\/embeds$/, () => ({ id: "pe_ok", visibility: "shared" })]],
    async (calls) => {
      const res = await create({ ...args, folder: "fo_shared" });
      check("shared embed in a shared folder is created", res.id === "pe_ok", JSON.stringify(res));
      check("it reached POST /api/embeds", calls.includes("POST /api/embeds"), calls.join(", "));
    },
  );

  // The membership half, which is what gives the client edit access.
  const grant = toolHandler("kitchen_create_embed_membership");
  await withKitchen(
    [
      ...folders([SHARED]),
      [/^\/api\/clients\/u_client$/, () => ({ id: "u_client", group: "client" })],
      [/memberships$/, () => ({ id: "nms_e1", role: "embed_manager" })],
    ],
    async (calls) => {
      const res = await grant({
        embed_id: "pe_ok",
        role: "embed_manager",
        user: "u_client",
      });
      check("a client can be granted access to an embed", res.id === "nms_e1", JSON.stringify(res));
      check(
        "via the embed memberships endpoint",
        calls.some((c) => c.includes("/api/embeds/pe_ok/memberships")),
        calls.join(", "),
      );
    },
  );

  await withKitchen([...folders([PRIVATE])], async (calls) => {
    const res = await grant({ embed_id: "pe_ok", role: "embed_manager", company: "co_1" });
    check(
      "an embed grant to a company with no shared folder stops and asks",
      res.reason === "no_shared_client_folder",
      JSON.stringify(res).slice(0, 180),
    );
    check(
      "no membership was created",
      !calls.some((c) => c.includes("memberships")),
      calls.join(", "),
    );
  });
}


/* ------------------------------------------------------------------ */
/* Google documents must open without a login                          */
/* ------------------------------------------------------------------ */

async function testGoogleLinkSharing() {
  const create = toolHandler("kitchen_create_embed");
  const GDOC = "https://docs.google.com/document/d/1rNqKhU96T7MM9H7epZXHxXPAyv5QMCUHwNvLPYlhmuw/edit";
  const base = { title: "Media Release (editable)", visibility: "shared", folder: "fo_shared" };

  // Unconfirmed sharing: stop, whatever else is in order.
  await withKitchen([...folders([SHARED])], async (calls) => {
    const res = await create({ ...base, url: GDOC });
    check(
      "a Google doc with unconfirmed link sharing stops and asks",
      res.reason === "google_link_sharing_unconfirmed",
      JSON.stringify(res).slice(0, 200),
    );
    check(
      "it names the Drive call, with the file id filled in",
      res.options?.[0]?.arguments?.permissionId === "anyoneWithLink" &&
        res.options[0].arguments.fileId === "1rNqKhU96T7MM9H7epZXHxXPAyv5QMCUHwNvLPYlhmuw",
      JSON.stringify(res.options?.[0]),
    );
    check(
      "a client-editable doc asks for writer, not reader",
      res.options[0].arguments.role === "writer",
      res.options[0].arguments.role,
    );
    check("no embed was created", !calls.includes("POST /api/embeds"), calls.join(", "));
  });

  // Confirmed: proceeds.
  await withKitchen(
    [...folders([SHARED]), [/^\/api\/embeds$/, () => ({ id: "pe_g1" })]],
    async (calls) => {
      const res = await create({ ...base, url: GDOC, link_sharing_confirmed: true });
      check("with sharing confirmed the embed is created", res.id === "pe_g1", JSON.stringify(res));
      check("it reached POST /api/embeds", calls.includes("POST /api/embeds"), calls.join(", "));
    },
  );

  // A non-Google URL is not this guard's business.
  await withKitchen(
    [...folders([SHARED]), [/^\/api\/embeds$/, () => ({ id: "pe_other" })]],
    async () => {
      const res = await create({ ...base, url: "https://teamup.com/abc" });
      check("a non-Google URL needs no sharing attestation", res.id === "pe_other", JSON.stringify(res));
    },
  );

  // The /u/<n>/ trap: stripped, because it fails for everyone but its author.
  const { normaliseGoogleDocUrl, driveFileId, isGoogleDocUrl } = await import(
    "../dist/tools/client-sharing.js"
  );
  const scoped =
    "https://docs.google.com/document/u/0/d/1rNqKhU96T7MM9H7epZXHxXPAyv5QMCUHwNvLPYlhmuw/edit?usp=sharing";
  const normalised = normaliseGoogleDocUrl(scoped);
  check(
    "an account-scoped /u/0/ URL is stripped",
    normalised.url ===
      "https://docs.google.com/document/d/1rNqKhU96T7MM9H7epZXHxXPAyv5QMCUHwNvLPYlhmuw/edit?usp=sharing",
    normalised.url,
  );
  check("and says why it changed it", normalised.notes.length === 1, JSON.stringify(normalised.notes));
  check(
    "a clean URL is left exactly as it is",
    normaliseGoogleDocUrl(GDOC).url === GDOC && normaliseGoogleDocUrl(GDOC).notes.length === 0,
  );
  check("the file id is recovered from the URL", driveFileId(GDOC) === "1rNqKhU96T7MM9H7epZXHxXPAyv5QMCUHwNvLPYlhmuw");
  check(
    "docs, drive, sheets and slides all count as Google documents",
    ["docs", "drive", "sheets", "slides"].every((h) =>
      isGoogleDocUrl(`https://${h}.google.com/document/d/abcdefghij/edit`),
    ),
  );
  check("a lookalike host does not", !isGoogleDocUrl("https://docs.google.com.evil.test/d/abcdefghij/edit"));

  // The scoped URL reaches the API stripped, not just normalised in theory.
  await withKitchen(
    [...folders([SHARED]), [/^\/api\/embeds$/, () => ({ id: "pe_g2" })]],
    async () => {
      const handler = toolHandler("kitchen_create_embed");
      const res = await handler({ ...base, url: scoped, link_sharing_confirmed: true });
      check("the embed is created from a scoped URL", res.id === "pe_g2", JSON.stringify(res));
    },
  );
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log("\nkitchen_create_doc");
  await testCreateDoc();
  console.log("\nkitchen_create_doc_membership");
  await testMembership();
  console.log("\nkitchen_update_doc");
  await testUpdateDoc();
  console.log("\nkitchen_create_embed");
  await testCreateEmbed();
  console.log("\ngoogle link sharing");
  await testGoogleLinkSharing();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
