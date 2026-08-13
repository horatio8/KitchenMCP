/**
 * How the deliverable workflow is encoded in Kitchen primitives.
 *
 *   Client engagement   → Board
 *   Lifecycle state     → List (board column)
 *   Deliverable         → Task
 *   Deliverable metadata→ fenced block in the task description
 *   Gate pass / approval→ Task comment (timestamped, attributed, append-only)
 *   Compliance report   → Task comment
 *   Sign-off certificate→ Doc
 *   Assets              → Files (folder per deliverable)
 *   Flight / election   → Milestone
 *   Client feedback     → Conversation
 *   Commercials         → Quote → Invoice
 *
 * Kitchen has no custom fields, so structured metadata lives in a fenced
 * block at the end of the task description. It is machine-written and
 * machine-parsed, but stays human-readable so anyone looking at the task
 * in the UI can see the same facts.
 */

import type { ComplianceReport, Jurisdiction, Platform } from "./compliance.js";
import {
  BOARD_COLUMN_ORDER,
  STATE_COLUMN_TITLES,
  type DeliverableType,
  type State,
  type Workstream,
} from "./types.js";

export const META_FENCE = "```deliverable";
export const META_FENCE_END = "```";

export interface DeliverableMeta {
  /** Stable short ID, e.g. "DLV-0042". */
  ref?: string;
  type?: DeliverableType;
  workstream?: Workstream;
  state?: State;
  jurisdiction?: Jurisdiction;
  region?: string;
  platforms?: Platform[];
  paid?: boolean;
  electoralMatter?: boolean;
  authorisationText?: string;
  payingEntity?: string;
  verifiedPlatforms?: Platform[];
  specialCategoryDeclared?: boolean;
  aiGeneratedMedia?: boolean;
  aiDisclosed?: boolean;
  flightStart?: string;
  flightEnd?: string;
  electionDate?: string;
  recordRetained?: boolean;
  /** Free-form version tag the client approves against, e.g. "v3". */
  version?: string;
  /** Where the item was before it was blocked / sent for rework. */
  resumeState?: State;
  /** Client-side approver, recorded so sign-off is attributable. */
  clientApprover?: string;
  /** Producer / reviewer / deployer names for the RACI record. */
  producer?: string;
  reviewer?: string;
  deployer?: string;
  /** Free-form notes. */
  notes?: string;
}

const LIST_KEYS = new Set(["platforms", "verifiedPlatforms"]);
const BOOL_KEYS = new Set([
  "paid",
  "electoralMatter",
  "specialCategoryDeclared",
  "aiGeneratedMedia",
  "aiDisclosed",
  "recordRetained",
]);

/** Serialise metadata into the fenced block appended to a description. */
export function renderMeta(meta: DeliverableMeta): string {
  const lines: string[] = [META_FENCE];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      lines.push(`${k}: ${v.join(", ")}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push(META_FENCE_END);
  return lines.join("\n");
}

/** Pull the metadata block out of a task description. */
export function parseMeta(description: string | null | undefined): DeliverableMeta {
  if (!description) return {};
  const start = description.indexOf(META_FENCE);
  if (start < 0) return {};
  const rest = description.slice(start + META_FENCE.length);
  const end = rest.indexOf(META_FENCE_END);
  const body = end < 0 ? rest : rest.slice(0, end);

  const meta: Record<string, unknown> = {};
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    if (LIST_KEYS.has(key)) {
      meta[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (BOOL_KEYS.has(key)) {
      meta[key] = /^(true|yes|y|1)$/i.test(value);
    } else {
      meta[key] = value;
    }
  }
  return meta as DeliverableMeta;
}

/** Replace (or append) the metadata block in a description. */
export function upsertMeta(
  description: string | null | undefined,
  meta: DeliverableMeta,
): string {
  const body = stripMeta(description);
  const block = renderMeta(meta);
  return body ? `${body.trimEnd()}\n\n${block}` : block;
}

/** The description with the metadata block removed. */
export function stripMeta(description: string | null | undefined): string {
  if (!description) return "";
  const start = description.indexOf(META_FENCE);
  if (start < 0) return description;
  const rest = description.slice(start + META_FENCE.length);
  const end = rest.indexOf(META_FENCE_END);
  const after = end < 0 ? "" : rest.slice(end + META_FENCE_END.length);
  return (description.slice(0, start) + after).trim();
}

/** Merge new values over existing metadata, dropping undefined. */
export function mergeMeta(
  base: DeliverableMeta,
  patch: Partial<DeliverableMeta>,
): DeliverableMeta {
  const out: DeliverableMeta = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* List ↔ state mapping                                                */
/* ------------------------------------------------------------------ */

export interface KitchenList {
  id: string;
  title: string | null;
}

/** Normalise a list title so "5 · Compliance" matches "compliance". */
function normaliseTitle(title: string): string {
  return title
    .replace(/^[\s0-9]*[·.\-—:]?\s*/, "")
    .replace(/[^a-z]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

const STATE_ALIASES: Record<string, State> = {
  intake: "intake",
  inbox: "intake",
  requests: "intake",
  new: "intake",
  scoped: "scoped",
  scoping: "scoped",
  briefed: "scoped",
  in_production: "in_production",
  production: "in_production",
  drafting: "in_production",
  draft: "in_production",
  doing: "in_production",
  wip: "in_production",
  internal_review: "internal_review",
  internal_qa: "internal_review",
  qa: "internal_review",
  review: "internal_review",
  compliance: "compliance_review",
  compliance_review: "compliance_review",
  legal: "compliance_review",
  client_review: "client_review",
  with_client: "client_review",
  client: "client_review",
  changes_requested: "changes_requested",
  changes: "changes_requested",
  rework: "changes_requested",
  approved: "approved",
  signed_off: "approved",
  scheduled: "scheduled",
  queued: "scheduled",
  deployed: "deployed",
  live: "deployed",
  published: "deployed",
  verified: "verified",
  blocked: "blocked",
  cancelled: "cancelled",
  canceled: "cancelled",
  archived: "archived",
  done: "archived",
};

/** Resolve a Kitchen list to a workflow state, if it maps to one. */
export function stateForList(list: KitchenList): State | undefined {
  if (!list.title) return undefined;
  return STATE_ALIASES[normaliseTitle(list.title)];
}

/** Build a state → listId index for a board's lists. */
export function buildStateIndex(lists: KitchenList[]): Map<State, string> {
  const index = new Map<State, string>();
  for (const list of lists) {
    const state = stateForList(list);
    if (state && !index.has(state)) index.set(state, list.id);
  }
  return index;
}

/** The list titles a workflow board should have, in order. */
export function desiredColumns(): Array<{ state: State; title: string }> {
  return BOARD_COLUMN_ORDER.map((state) => ({
    state,
    title: STATE_COLUMN_TITLES[state],
  }));
}

/* ------------------------------------------------------------------ */
/* Comment formats — the audit trail                                   */
/* ------------------------------------------------------------------ */

export const GATE_MARKER = "GATE-PASS";
export const APPROVAL_MARKER = "CLIENT-APPROVAL";
export const COMPLIANCE_MARKER = "COMPLIANCE-CHECK";
export const TRANSITION_MARKER = "STATE-CHANGE";

export function renderGatePass(args: {
  gateId: string;
  gateTitle: string;
  by: string;
  checks: Array<{ id: string; assertion: string; passed: boolean; note?: string }>;
  version?: string;
}): string {
  const lines = [`**${GATE_MARKER} · ${args.gateTitle}** (\`${args.gateId}\`)`, ""];
  lines.push(`Signed by: ${args.by}`);
  if (args.version) lines.push(`Version: ${args.version}`);
  lines.push(`At: ${new Date().toISOString()}`);
  lines.push("");
  for (const c of args.checks) {
    lines.push(`- [${c.passed ? "x" : " "}] ${c.assertion}${c.note ? ` — ${c.note}` : ""}`);
  }
  const failed = args.checks.filter((c) => !c.passed);
  if (failed.length) {
    lines.push("");
    lines.push(`⚠ ${failed.length} check(s) not satisfied at sign-off.`);
  }
  return lines.join("\n");
}

export function renderClientApproval(args: {
  approver: string;
  version: string;
  scope: string;
  conditions?: string;
  quotedFrom?: string;
}): string {
  const lines = [`**${APPROVAL_MARKER}**`, ""];
  lines.push(`Approver: ${args.approver}`);
  lines.push(`Version approved: ${args.version}`);
  lines.push(`Scope of approval: ${args.scope}`);
  if (args.conditions) lines.push(`Conditions: ${args.conditions}`);
  if (args.quotedFrom) lines.push(`Source of approval: ${args.quotedFrom}`);
  lines.push(`Recorded: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "_This record fixes what was approved, by whom, and at which version. " +
      "Any change after this point requires a fresh approval._",
  );
  return lines.join("\n");
}

export function renderComplianceComment(report: ComplianceReport): string {
  return `**${COMPLIANCE_MARKER}**\n\n${report.text}`;
}

export function renderTransition(args: {
  from: State;
  to: State;
  by: string;
  reason?: string;
}): string {
  const lines = [
    `**${TRANSITION_MARKER}** ${STATE_COLUMN_TITLES[args.from]} → ${STATE_COLUMN_TITLES[args.to]}`,
  ];
  lines.push(`By: ${args.by} at ${new Date().toISOString()}`);
  if (args.reason) lines.push(`Reason: ${args.reason}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Audit trail reading                                                 */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  kind: "gate" | "approval" | "compliance" | "transition" | "other";
  gateId?: string;
  raw: string;
  createdAt?: string;
  author?: string;
}

export function classifyComment(body: string): AuditEntry["kind"] {
  if (body.includes(GATE_MARKER)) return "gate";
  if (body.includes(APPROVAL_MARKER)) return "approval";
  if (body.includes(COMPLIANCE_MARKER)) return "compliance";
  if (body.includes(TRANSITION_MARKER)) return "transition";
  return "other";
}

export function extractGateId(body: string): string | undefined {
  const m = /`(G\d_[a-z_]+)`/.exec(body);
  return m?.[1];
}

/** Has this gate been signed off in the comment history? */
export function hasGatePass(comments: string[], gateId: string): boolean {
  return comments.some(
    (c) => classifyComment(c) === "gate" && extractGateId(c) === gateId,
  );
}

export function hasClientApproval(comments: string[]): boolean {
  return comments.some((c) => classifyComment(c) === "approval");
}
