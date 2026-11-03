#!/usr/bin/env node
/**
 * Asserts the HTTP contract of every Kitchen tool against what
 * developer.kitchen.co actually documents.
 *
 * This file exists because the Kitchen API's shape is not the obvious
 * REST layout, and every place it differs was originally got wrong by
 * assuming otherwise:
 *
 *   - updates are PUT, never PATCH
 *   - labels and custom fields are board-scoped, not workspace-scoped
 *   - subtasks, subtask lists, comments, notes, labels, members and
 *     custom field values are all nested under their task
 *   - messages and notes are nested under their conversation
 *   - containment on create is `folder`; moving afterwards is `parent`
 *   - `visibility` is required on create for every container
 *   - folders and subtask lists use `name`; everything else `title`
 *
 * None of that produces a type error. It produces a 404, a 422, or —
 * worst of all — a 200 that silently ignored the field you sent. So the
 * contract is asserted here from the declared specs, with no network.
 *
 * Run: node scripts/test-api-contract.mjs
 */

const { buildToolRegistry } = await import("../dist/tools/index.js");

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

/* ------------------------------------------------------------------ */
/* Synthesise minimal valid arguments from a Zod shape                 */
/* ------------------------------------------------------------------ */

function sampleFor(schema, key) {
  let s = schema;
  // Unwrap optional/nullable/default to reach the inner type.
  for (let i = 0; i < 8; i += 1) {
    const def = s?._def;
    if (!def) break;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
      s = def.innerType;
      continue;
    }
    if (def.typeName === "ZodDefault") {
      s = def.innerType;
      continue;
    }
    break;
  }
  const t = s?._def?.typeName;
  switch (t) {
    case "ZodString":
      return key;
    case "ZodNumber":
      return 1;
    case "ZodBoolean":
      return true;
    case "ZodEnum":
      return s._def.values[0];
    case "ZodArray":
      return [];
    case "ZodRecord":
      return {};
    case "ZodObject":
      return {};
    case "ZodUnion":
      return sampleFor(s._def.options[0], key);
    default:
      return key;
  }
}

/** Every field, so path templates and bodies are fully populated. */
function sampleArgs(shape) {
  const out = {};
  for (const [key, schema] of Object.entries(shape ?? {})) {
    out[key] = sampleFor(schema, key);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Build the spec index                                                */
/* ------------------------------------------------------------------ */

const registry = buildToolRegistry();
const specs = registry.describe();
const byName = new Map();

for (const spec of specs) {
  let req;
  try {
    req = spec.buildRequest(sampleArgs(spec.inputSchema));
  } catch (err) {
    req = { path: `<threw: ${String(err)}>` };
  }
  byName.set(spec.name, { ...spec, req });
}

/** Assert a tool issues this method and its path matches. */
function expectCall(name, method, pathPattern) {
  const entry = byName.get(name);
  if (!entry) {
    check(`${name} exists`, false, "tool not registered");
    return;
  }
  check(`${name} uses ${method}`, entry.method === method, `uses ${entry.method}`);
  const ok =
    pathPattern instanceof RegExp
      ? pathPattern.test(entry.req.path)
      : entry.req.path === pathPattern;
  check(`${name} path`, ok, `got ${entry.req.path}`);
}

/** Assert the request body carries exactly these keys (among others). */
function expectBodyKeys(name, keys) {
  const entry = byName.get(name);
  if (!entry) {
    check(`${name} exists`, false, "tool not registered");
    return;
  }
  const body = entry.req.body ?? {};
  for (const key of keys) {
    check(
      `${name} sends ${key}`,
      Object.prototype.hasOwnProperty.call(body, key),
      `body keys: ${Object.keys(body).join(", ") || "(none)"}`,
    );
  }
}

/** Assert the request body does NOT carry these keys. */
function expectNoBodyKeys(name, keys) {
  const entry = byName.get(name);
  if (!entry) return;
  const body = entry.req.body ?? {};
  for (const key of keys) {
    check(
      `${name} does not send ${key}`,
      !Object.prototype.hasOwnProperty.call(body, key),
      `body still has ${key}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

section("no PATCH anywhere — every documented update is PUT");
{
  const patchers = specs.filter((s) => s.method === "PATCH").map((s) => s.name);
  check("no tool issues PATCH", patchers.length === 0, patchers.join(", "));
}

section("updates are PUT");
for (const [name, path] of [
  ["kitchen_update_board", "/api/boards/id"],
  ["kitchen_update_client", "/api/clients/id"],
  ["kitchen_update_company", "/api/companies/id"],
  ["kitchen_update_conversation", "/api/conversations/id"],
  ["kitchen_update_doc", "/api/docs/id"],
  ["kitchen_update_folder", "/api/folders/id"],
  ["kitchen_update_invoice", "/api/invoices/id"],
  ["kitchen_update_list", "/api/lists/id"],
  ["kitchen_update_milestone", "/api/milestones/id"],
  ["kitchen_update_recurring_invoice", "/api/recurring-invoices/id"],
  ["kitchen_update_task", "/api/tasks/id"],
  ["kitchen_update_template", "/api/templates/id"],
  ["kitchen_update_webhook", "/api/webhooks/id"],
]) {
  expectCall(name, "PUT", path);
}

section("labels are board-scoped, not workspace-scoped");
expectCall("kitchen_list_labels", "GET", "/api/boards/board_id/labels");
expectCall("kitchen_get_label", "GET", "/api/boards/board_id/labels/id");
expectCall("kitchen_create_label", "POST", "/api/boards/board_id/labels");
expectCall("kitchen_update_label", "PUT", "/api/boards/board_id/labels/id");
expectCall("kitchen_delete_label", "DELETE", "/api/boards/board_id/labels/id");
// hex_color is required and is not called "color".
expectBodyKeys("kitchen_create_label", ["hex_color"]);
expectNoBodyKeys("kitchen_create_label", ["color"]);

section("custom fields: definitions on the board, values on the task");
expectCall("kitchen_list_custom_fields", "GET", "/api/boards/board_id/custom-fields");
expectCall("kitchen_get_custom_field", "GET", "/api/boards/board_id/custom-fields/id");
expectCall("kitchen_create_custom_field", "POST", "/api/boards/board_id/custom-fields");
expectCall("kitchen_update_custom_field", "PUT", "/api/boards/board_id/custom-fields/id");
expectCall("kitchen_delete_custom_field", "DELETE", "/api/boards/board_id/custom-fields/id");
expectCall("kitchen_list_task_custom_fields", "GET", "/api/tasks/task_id/custom-fields");
expectCall("kitchen_set_task_custom_field", "POST", "/api/tasks/task_id/custom-fields");
expectCall(
  "kitchen_update_task_custom_field",
  "PUT",
  "/api/tasks/task_id/custom-fields/custom_field_id",
);
expectCall(
  "kitchen_remove_task_custom_field",
  "DELETE",
  "/api/tasks/task_id/custom-fields/custom_field_id",
);
// name is required on update, not only on create.
expectBodyKeys("kitchen_update_custom_field", ["name"]);
expectBodyKeys("kitchen_create_custom_field", ["name", "type"]);
expectBodyKeys("kitchen_set_task_custom_field", ["custom_field", "value"]);

section("tasks are board-scoped; their children are task-scoped");
expectCall("kitchen_list_tasks", "GET", "/api/boards/board_id/tasks");
expectCall("kitchen_create_task", "POST", "/api/boards/board_id/tasks");
expectCall("kitchen_list_subtasks", "GET", "/api/tasks/task_id/subtasks");
expectCall("kitchen_get_subtask", "GET", "/api/tasks/task_id/subtasks/id");
expectCall("kitchen_create_subtask", "POST", "/api/tasks/task_id/subtasks");
expectCall("kitchen_update_subtask", "PUT", "/api/tasks/task_id/subtasks/id");
expectCall("kitchen_delete_subtask", "DELETE", "/api/tasks/task_id/subtasks/id");
expectCall("kitchen_list_subtask_lists", "GET", "/api/tasks/task_id/subtask-lists");
expectCall("kitchen_create_subtask_list", "POST", "/api/tasks/task_id/subtask-lists");
expectCall(
  "kitchen_update_subtask_list",
  "PUT",
  "/api/tasks/task_id/subtask-lists/id",
);
expectCall("kitchen_list_task_comments", "GET", "/api/tasks/task_id/comments");
expectCall("kitchen_get_task_comment", "GET", "/api/tasks/task_id/comments/id");
expectCall("kitchen_update_task_comment", "PUT", "/api/tasks/task_id/comments/id");
expectCall("kitchen_delete_task_comment", "DELETE", "/api/tasks/task_id/comments/id");
expectCall("kitchen_list_task_notes", "GET", "/api/tasks/task_id/notes");
expectCall("kitchen_create_task_note", "POST", "/api/tasks/task_id/notes");
expectCall("kitchen_list_task_labels", "GET", "/api/tasks/task_id/labels");
expectCall("kitchen_list_task_members", "GET", "/api/tasks/task_id/members");

section("task payloads use the API's field names");
// A task takes one assignee, not a members array, and start_at not starts_at.
expectNoBodyKeys("kitchen_create_task", ["members", "starts_at", "labels"]);
expectBodyKeys("kitchen_create_task", ["assignee", "start_at", "list", "title"]);
expectNoBodyKeys("kitchen_update_task", ["starts_at"]);
// Adding a label or member sends the bare noun.
expectBodyKeys("kitchen_add_task_label", ["label"]);
expectNoBodyKeys("kitchen_add_task_label", ["label_id"]);
expectBodyKeys("kitchen_add_task_member", ["user"]);
expectNoBodyKeys("kitchen_add_task_member", ["user_id"]);
// A subtask must name the checklist it belongs to.
expectBodyKeys("kitchen_create_subtask", ["subtask_list", "title"]);
// Comments and notes must declare a format or the API 422s.
expectBodyKeys("kitchen_create_task_comment", ["format"]);
expectBodyKeys("kitchen_create_task_note", ["format"]);

section("messages and notes are conversation-scoped");
expectCall(
  "kitchen_list_messages",
  "GET",
  "/api/conversations/conversation_id/messages",
);
expectCall(
  "kitchen_get_message",
  "GET",
  "/api/conversations/conversation_id/messages/id",
);
expectCall(
  "kitchen_create_message",
  "POST",
  "/api/conversations/conversation_id/messages",
);
expectCall(
  "kitchen_update_message",
  "PUT",
  "/api/conversations/conversation_id/messages/id",
);
expectCall(
  "kitchen_delete_message",
  "DELETE",
  "/api/conversations/conversation_id/messages/id",
);
expectCall(
  "kitchen_list_conversation_notes",
  "GET",
  "/api/conversations/conversation_id/notes",
);
expectCall(
  "kitchen_create_conversation_note",
  "POST",
  "/api/conversations/conversation_id/notes",
);
expectBodyKeys("kitchen_create_message", ["format"]);
expectNoBodyKeys("kitchen_create_message", ["attachment_ids"]);

section("moving uses POST /{id}/move with `parent`");
for (const [name, path] of [
  ["kitchen_move_board", "/api/boards/id/move"],
  ["kitchen_move_folder", "/api/folders/id/move"],
  ["kitchen_move_doc", "/api/docs/id/move"],
  ["kitchen_move_invoice", "/api/invoices/id/move"],
  ["kitchen_move_conversation", "/api/conversations/id/move"],
  ["kitchen_move_milestone", "/api/milestones/id/move"],
]) {
  expectCall(name, "POST", path);
  expectBodyKeys(name, ["parent"]);
  expectNoBodyKeys(name, ["folder_id", "parent_id"]);
}

section("archive and restore are POST /{id}/verb");
for (const resource of ["boards", "folders", "docs", "invoices", "conversations", "milestones"]) {
  const noun = { boards: "board", folders: "folder", docs: "doc", invoices: "invoice", conversations: "conversation", milestones: "milestone" }[resource];
  expectCall(`kitchen_archive_${noun}`, "POST", `/api/${resource}/id/archive`);
  expectCall(`kitchen_restore_${noun}`, "POST", `/api/${resource}/id/restore`);
}

section("create payloads carry the required visibility");
for (const name of [
  "kitchen_create_board",
  "kitchen_create_folder",
  "kitchen_create_doc",
  "kitchen_create_conversation",
  "kitchen_create_invoice",
]) {
  expectBodyKeys(name, ["visibility"]);
}

section("containment on create is `folder`, never `folder_id`");
for (const name of [
  "kitchen_create_board",
  "kitchen_create_doc",
  "kitchen_create_conversation",
  "kitchen_create_invoice",
  "kitchen_create_milestone",
  "kitchen_create_template",
]) {
  expectBodyKeys(name, ["folder"]);
  expectNoBodyKeys(name, ["folder_id", "board_id", "parent_id"]);
}

section("folders and subtask lists are named, not titled");
expectBodyKeys("kitchen_create_folder", ["name"]);
expectNoBodyKeys("kitchen_create_folder", ["title"]);
expectBodyKeys("kitchen_create_subtask_list", ["name"]);
expectNoBodyKeys("kitchen_create_subtask_list", ["title"]);
expectBodyKeys("kitchen_create_template", ["name"]);

section("clients and companies use the documented fields");
expectBodyKeys("kitchen_create_client", ["name", "email"]);
expectNoBodyKeys("kitchen_create_client", ["first_name", "last_name", "company_id"]);
expectBodyKeys("kitchen_create_company", ["name"]);
expectNoBodyKeys("kitchen_create_company", ["notes"]);

section("invoices have no title, and reference the client as `client`");
expectBodyKeys("kitchen_create_invoice", ["client", "items"]);
expectNoBodyKeys("kitchen_create_invoice", ["client_id", "title", "auto_charge", "due_date"]);
expectBodyKeys("kitchen_create_invoice", ["due_date_in_days"]);

section("files: upload is filename-only, three steps");
expectCall("kitchen_create_file_upload", "POST", "/api/files");
expectBodyKeys("kitchen_create_file_upload", ["filename"]);
// size and mime_type are inferred from the uploaded bytes; sending them 422s.
expectNoBodyKeys("kitchen_create_file_upload", ["name", "size", "mime_type"]);
expectCall("kitchen_complete_file", "POST", "/api/files/id/complete");
expectCall("kitchen_get_file", "GET", "/api/files/id");
expectCall("kitchen_delete_file", "DELETE", "/api/files/id");
expectCall("kitchen_list_folder_files", "GET", "/api/folders/folder_id/files");
expectCall("kitchen_add_folder_files", "POST", "/api/folders/folder_id/files");
expectBodyKeys("kitchen_add_folder_files", ["files"]);

section("doc memberships require a role and take user or company");
expectCall("kitchen_list_doc_memberships", "GET", "/api/docs/doc_id/memberships");
expectCall("kitchen_create_doc_membership", "POST", "/api/docs/doc_id/memberships");
expectCall(
  "kitchen_update_doc_membership",
  "PUT",
  "/api/docs/doc_id/memberships/membership_id",
);
expectCall(
  "kitchen_delete_doc_membership",
  "DELETE",
  "/api/docs/doc_id/memberships/membership_id",
);
expectBodyKeys("kitchen_create_doc_membership", ["role", "user", "company"]);
expectNoBodyKeys("kitchen_create_doc_membership", ["user_id"]);
expectBodyKeys("kitchen_update_doc_membership", ["role"]);

section("the deprecated Cards API is not exposed");
{
  const cardTools = specs.filter((s) => /\/api\/cards?\b/.test(
    (() => {
      try {
        return s.buildRequest(sampleArgs(s.inputSchema)).path;
      } catch {
        return "";
      }
    })(),
  ));
  check(
    "no tool targets /api/cards",
    cardTools.length === 0,
    cardTools.map((s) => s.name).join(", "),
  );
}

section("destructive operations are flagged");
{
  const unflagged = specs
    .filter((s) => s.method === "DELETE" && !s.destructive)
    .map((s) => s.name);
  // Removing a label, member or custom field value from a task detaches
  // rather than destroys, so those are legitimately not destructive.
  const detachers = new Set([
    "kitchen_remove_task_label",
    "kitchen_remove_task_member",
    "kitchen_remove_task_custom_field",
    "kitchen_delete_doc_membership",
  ]);
  const unexpected = unflagged.filter((n) => !detachers.has(n));
  check(
    "every destructive DELETE is flagged destructive",
    unexpected.length === 0,
    unexpected.join(", "),
  );
}

section("every path is well formed");
for (const [name, entry] of byName) {
  check(
    `${name} builds an /api path`,
    entry.req.path.startsWith("/api/") && !entry.req.path.includes("//") &&
      !entry.req.path.includes("undefined"),
    entry.req.path,
  );
}

section("coverage against the documented resource families");
{
  // Every resource family on developer.kitchen.co, and what this server
  // does about it. Keeping the list here means the gap is recorded in
  // the repo rather than in somebody's memory, and that adding a family
  // to the docs eventually shows up as a decision someone has to make.
  //
  // "absent" is a deliberate choice with a reason, not an oversight.
  const FAMILIES = {
    attachments: "absent: read-only views of files already reachable via kitchen_get_file",
    "billing-profiles": "absent: object documentation only, no endpoints",
    "board-memberships": "absent: not yet implemented",
    boards: "covered",
    "card-attachments": "absent: deprecated Cards API",
    "card-custom-fields": "absent: deprecated Cards API",
    "card-labels": "absent: deprecated Cards API",
    "card-members": "absent: deprecated Cards API",
    cards: "absent: deprecated Cards API, use tasks",
    clients: "covered",
    comments: "absent: generic comments; task comments are covered",
    companies: "covered",
    "conversation-attachments": "absent: not yet implemented",
    "conversation-memberships": "absent: not yet implemented",
    "conversation-notes": "covered",
    conversations: "covered",
    "custom-fields": "covered",
    "doc-memberships": "covered",
    docs: "covered",
    "embed-memberships": "absent: not yet implemented",
    embeds: "absent: not yet implemented",
    "file-comments": "absent: object documentation only",
    "file-threads": "absent: object documentation only",
    files: "covered",
    "folder-children": "covered",
    "folder-files": "covered",
    "folder-memberships": "absent: not yet implemented",
    folders: "covered",
    "invoice-memberships": "absent: not yet implemented",
    invoices: "covered",
    labels: "covered",
    "link-memberships": "absent: not yet implemented",
    links: "absent: not yet implemented",
    lists: "covered",
    members: "covered",
    messages: "covered",
    "milestone-memberships": "absent: not yet implemented",
    milestones: "covered",
    "recurring-invoices": "covered",
    subtasks: "covered",
    "task-attachments": "absent: not yet implemented",
    "task-comments": "covered",
    "task-custom-fields": "covered",
    "task-labels": "covered",
    "task-members": "covered",
    "task-notes": "covered",
    "task-subtask-lists": "covered",
    tasks: "covered",
    templates: "covered",
    users: "absent: object documentation only",
    webhooks: "covered",
  };

  const total = Object.keys(FAMILIES).length;
  const covered = Object.values(FAMILIES).filter((v) => v === "covered").length;
  const deprecated = Object.values(FAMILIES).filter((v) =>
    v.includes("deprecated"),
  ).length;
  const objectOnly = Object.values(FAMILIES).filter((v) =>
    v.includes("object documentation only"),
  ).length;
  const todo = Object.values(FAMILIES).filter((v) =>
    v.includes("not yet implemented"),
  ).length;

  check(
    "the family list matches the documented count",
    total === 51,
    `listed ${total}, sitemap has 51`,
  );
  check(
    "every family has a disposition",
    Object.values(FAMILIES).every((v) => typeof v === "string" && v.length > 0),
  );
  console.log(
    `  ${covered} covered, ${todo} not yet implemented, ` +
      `${deprecated} deprecated and excluded, ${objectOnly} object-docs only ` +
      `(of ${total})`,
  );
  // Anything claimed as covered must actually have tools.
  const prefixes = {
    boards: "kitchen_list_boards",
    clients: "kitchen_list_clients",
    companies: "kitchen_list_companies",
    "conversation-notes": "kitchen_list_conversation_notes",
    conversations: "kitchen_list_conversations",
    "custom-fields": "kitchen_list_custom_fields",
    "doc-memberships": "kitchen_list_doc_memberships",
    docs: "kitchen_list_docs",
    files: "kitchen_get_file",
    "folder-children": "kitchen_list_folder_children",
    "folder-files": "kitchen_list_folder_files",
    folders: "kitchen_list_folders",
    invoices: "kitchen_list_invoices",
    labels: "kitchen_list_labels",
    lists: "kitchen_list_lists",
    members: "kitchen_list_members",
    messages: "kitchen_list_messages",
    milestones: "kitchen_list_milestones",
    "recurring-invoices": "kitchen_list_recurring_invoices",
    subtasks: "kitchen_list_subtasks",
    "task-comments": "kitchen_list_task_comments",
    "task-custom-fields": "kitchen_list_task_custom_fields",
    "task-labels": "kitchen_list_task_labels",
    "task-members": "kitchen_list_task_members",
    "task-notes": "kitchen_list_task_notes",
    "task-subtask-lists": "kitchen_list_subtask_lists",
    tasks: "kitchen_list_tasks",
    templates: "kitchen_list_templates",
    webhooks: "kitchen_list_webhooks",
  };
  for (const [family, witness] of Object.entries(prefixes)) {
    check(
      `${family} claimed covered has a tool`,
      byName.has(witness),
      `${witness} missing`,
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
