/**
 * The workflow engine: reads and writes deliverable state in Kitchen,
 * enforcing the state machine and gate discipline.
 *
 * Every state change is written twice — once as structural truth (the
 * task moves to a different list, the metadata block updates) and once
 * as narrative truth (a comment on the task). The comment history is
 * the audit trail; it is append-only in practice because nothing here
 * ever edits or deletes a comment.
 */

import { callKitchen } from "../kitchen/client.js";
import type { KitchenCredentials } from "../kitchen/credentials.js";
import { evaluateCompliance, type ComplianceInput, type ComplianceReport } from "./compliance.js";
import {
  auditEvidence,
  parseEvidence,
  renderEvidenceReport,
  stripEvidence,
  upsertEvidence,
  type EvidenceAudit,
  type EvidenceEntry,
} from "./evidence.js";
import { missingMeta, recipeFor, type Recipe } from "./recipes.js";
import {
  buildStateIndex,
  classifyComment,
  desiredColumns,
  extractGateId,
  hasClientApproval,
  hasGatePass,
  mergeMeta,
  parseMeta,
  renderClientApproval,
  renderComplianceComment,
  renderGatePass,
  renderTransition,
  stripMeta,
  upsertMeta,
  type DeliverableMeta,
  type KitchenList,
} from "./kitchen-map.js";
import { checkTransition, happyPath } from "./states.js";
import {
  BOARD_COLUMN_ORDER,
  GATES,
  STATE_COLUMN_TITLES,
  gateById,
  type DeliverableType,
  type GateId,
  type State,
} from "./types.js";

type Creds = KitchenCredentials;

/**
 * Compose a task description from its three parts.
 *
 * The description carries a human brief plus two machine blocks. Every
 * write MUST go through here — writing `upsertMeta(brief, meta)` alone
 * silently drops the evidence register, because `brief` has already had
 * both blocks stripped out of it.
 */
function composeDescription(
  brief: string,
  meta: DeliverableMeta,
  evidence: EvidenceEntry[],
): string {
  return upsertEvidence(upsertMeta(brief, meta), evidence);
}

/* ------------------------------------------------------------------ */
/* Low-level Kitchen helpers                                           */
/* ------------------------------------------------------------------ */

interface KitchenTask {
  id: string;
  title: string;
  description: string | null;
  list: string;
  board: string;
  completed?: number;
  due_at?: string | null;
  assignee?: string | null;
}

async function getTask(creds: Creds, taskId: string): Promise<KitchenTask> {
  const res = (await callKitchen(creds, {
    method: "GET",
    path: `/api/tasks/${encodeURIComponent(taskId)}`,
  })) as { data?: KitchenTask } | KitchenTask;
  return (res as { data?: KitchenTask }).data ?? (res as KitchenTask);
}

async function listBoardLists(creds: Creds, boardId: string): Promise<KitchenList[]> {
  const res = (await callKitchen(creds, {
    method: "GET",
    path: `/api/boards/${encodeURIComponent(boardId)}/lists`,
    query: { per_page: 100 },
  })) as { data?: KitchenList[] };
  return res.data ?? [];
}

interface KitchenComment {
  id: string;
  content?: string;
  created_at?: string;
  author?: string;
  attachments?: string[];
}

async function listComments(creds: Creds, taskId: string): Promise<KitchenComment[]> {
  const res = (await callKitchen(creds, {
    method: "GET",
    path: `/api/tasks/${encodeURIComponent(taskId)}/comments`,
    query: { per_page: 100 },
  })) as { data?: KitchenComment[] };
  return res.data ?? [];
}

function commentText(c: KitchenComment): string {
  return c.content ?? "";
}

async function addComment(
  creds: Creds,
  taskId: string,
  content: string,
  attachments?: string[],
): Promise<unknown> {
  return callKitchen(creds, {
    method: "POST",
    path: `/api/tasks/${encodeURIComponent(taskId)}/comments`,
    body: {
      content,
      // Required by the Kitchen API — a comment POST without it 422s.
      format: "text",
      ...(attachments?.length ? { attachments } : {}),
    },
  });
}

async function updateTask(
  creds: Creds,
  taskId: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return callKitchen(creds, {
    method: "PUT",
    path: `/api/tasks/${encodeURIComponent(taskId)}`,
    body,
  });
}

async function moveTask(
  creds: Creds,
  taskId: string,
  boardId: string,
  listId: string,
): Promise<unknown> {
  return callKitchen(creds, {
    method: "POST",
    path: `/api/tasks/${encodeURIComponent(taskId)}/move`,
    body: { board: boardId, list: listId },
  });
}

/* ------------------------------------------------------------------ */
/* Board provisioning                                                  */
/* ------------------------------------------------------------------ */

export interface ProvisionResult {
  boardId: string;
  boardTitle: string;
  created: Array<{ state: State; listId: string; title: string }>;
  existing: Array<{ state: State; listId: string; title: string }>;
  warnings: string[];
}

/**
 * Make a board conform to the workflow: every lifecycle state gets a
 * column. Existing columns that already map to a state are reused, so
 * this is safe to run against a live board and safe to re-run.
 */
export async function provisionBoard(
  creds: Creds,
  args: { boardId?: string; boardTitle?: string; visibility?: string },
): Promise<ProvisionResult> {
  let boardId = args.boardId;
  let boardTitle = args.boardTitle ?? "";

  if (!boardId) {
    if (!args.boardTitle) {
      throw new Error("provisionBoard needs either boardId or boardTitle");
    }
    const created = (await callKitchen(creds, {
      method: "POST",
      path: "/api/boards",
      body: { title: args.boardTitle, visibility: args.visibility ?? "internal" },
    })) as { data?: { id: string; title: string } };
    boardId = created.data?.id;
    boardTitle = created.data?.title ?? args.boardTitle;
    if (!boardId) throw new Error("board creation returned no id");
  }

  const lists = await listBoardLists(creds, boardId);
  const index = buildStateIndex(lists);
  const result: ProvisionResult = {
    boardId,
    boardTitle,
    created: [],
    existing: [],
    warnings: [],
  };

  for (const { state, title } of desiredColumns()) {
    const existingId = index.get(state);
    if (existingId) {
      const list = lists.find((l) => l.id === existingId);
      result.existing.push({ state, listId: existingId, title: list?.title ?? title });
      continue;
    }
    const created = (await callKitchen(creds, {
      method: "POST",
      path: `/api/boards/${encodeURIComponent(boardId)}/lists`,
      body: { title },
    })) as { data?: { id: string } };
    const listId = created.data?.id;
    if (listId) {
      result.created.push({ state, listId, title });
      index.set(state, listId);
    } else {
      result.warnings.push(`could not create list "${title}"`);
    }
  }

  const unmapped = lists.filter((l) => l.title && !buildStateIndex([l]).size);
  for (const l of unmapped) {
    result.warnings.push(
      `list "${l.title}" does not map to a workflow state — deliverables parked there are invisible to the engine`,
    );
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Deliverable reads                                                   */
/* ------------------------------------------------------------------ */

export interface DeliverableView {
  taskId: string;
  title: string;
  boardId: string;
  listId: string;
  state: State | undefined;
  meta: DeliverableMeta;
  brief: string;
  audit: Array<{ kind: string; gateId?: string; createdAt?: string; excerpt: string }>;
  gatesPassed: GateId[];
  clientApproved: boolean;
  /** Remaining states on the happy path for this type. */
  remaining: State[];
  /** Next legal forward move, if any. */
  nextState?: State;
  dueAt?: string | null;
  /** Claims register and its audit. */
  evidence: EvidenceEntry[];
  evidenceAudit: EvidenceAudit;
  /** Metadata the recipe requires that is still empty. */
  missingMeta: string[];
  recipe?: Recipe;
}

export async function readDeliverable(
  creds: Creds,
  taskId: string,
): Promise<DeliverableView> {
  const task = await getTask(creds, taskId);
  const lists = await listBoardLists(creds, task.board);
  const index = buildStateIndex(lists);
  const meta = parseMeta(task.description);

  let state: State | undefined;
  for (const [s, id] of index) {
    if (id === task.list) {
      state = s;
      break;
    }
  }
  // Fall back to the metadata block if the list isn't a workflow column.
  if (!state && meta.state) state = meta.state;

  const comments = await listComments(creds, taskId);
  const bodies = comments.map(commentText);
  const gatesPassed = GATES.map((g) => g.id).filter((id) => hasGatePass(bodies, id));

  const type: DeliverableType = meta.type ?? "internal";
  const path = happyPath(type);
  const idx = state ? path.indexOf(state) : -1;
  const remaining = idx >= 0 ? path.slice(idx + 1) : path;

  const evidence = parseEvidence(task.description);

  return {
    taskId,
    title: task.title,
    boardId: task.board,
    listId: task.list,
    state,
    meta,
    // The brief is what remains once both machine blocks are removed.
    brief: stripEvidence(stripMeta(task.description)),
    evidence,
    evidenceAudit: auditEvidence(evidence),
    missingMeta: missingMeta(type, meta as Record<string, unknown>),
    recipe: recipeFor(type),
    audit: comments.map((c) => {
      const body = commentText(c);
      return {
        kind: classifyComment(body),
        gateId: extractGateId(body),
        createdAt: c.created_at,
        excerpt: body.slice(0, 200),
      };
    }),
    gatesPassed,
    clientApproved: hasClientApproval(bodies),
    remaining,
    nextState: remaining[0],
    dueAt: task.due_at ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export async function createDeliverable(
  creds: Creds,
  args: {
    boardId: string;
    title: string;
    brief: string;
    meta: DeliverableMeta;
    dueAt?: string;
    assignee?: string;
  },
): Promise<{ taskId: string; state: State; listId: string }> {
  const lists = await listBoardLists(creds, args.boardId);
  const index = buildStateIndex(lists);
  const intakeList = index.get("intake");
  if (!intakeList) {
    throw new Error(
      "board has no Intake column — run workflow_provision_board on it first",
    );
  }

  const meta = mergeMeta(args.meta, { state: "intake" });
  const description = upsertMeta(args.brief, meta);

  const created = (await callKitchen(creds, {
    method: "POST",
    path: `/api/boards/${encodeURIComponent(args.boardId)}/tasks`,
    body: {
      list: intakeList,
      title: args.title,
      description,
      ...(args.dueAt ? { due_at: args.dueAt } : {}),
      ...(args.assignee ? { members: [args.assignee] } : {}),
    },
  })) as { data?: { id: string } };

  const taskId = created.data?.id;
  if (!taskId) throw new Error("task creation returned no id");
  return { taskId, state: "intake", listId: intakeList };
}

/* ------------------------------------------------------------------ */
/* Gate sign-off                                                       */
/* ------------------------------------------------------------------ */

export interface GateSignResult {
  gateId: GateId;
  recorded: boolean;
  unsatisfied: string[];
  comment: string;
}

export async function signGate(
  creds: Creds,
  args: {
    taskId: string;
    gateId: GateId;
    by: string;
    checks: Array<{ id: string; passed: boolean; note?: string }>;
    version?: string;
  },
): Promise<GateSignResult> {
  const gate = gateById(args.gateId);
  if (!gate) throw new Error(`unknown gate: ${args.gateId}`);

  const supplied = new Map(args.checks.map((c) => [c.id, c]));
  const merged = gate.checks.map((c) => {
    const s = supplied.get(c.id);
    return {
      id: c.id,
      assertion: c.assertion,
      passed: s?.passed ?? false,
      note: s?.note,
    };
  });

  const unsatisfied = merged
    .filter((c) => !c.passed)
    .filter((c) => !gate.checks.find((g) => g.id === c.id)?.advisory)
    .map((c) => c.id);

  const comment = renderGatePass({
    gateId: gate.id,
    gateTitle: gate.title,
    by: args.by,
    checks: merged,
    version: args.version,
  });

  await addComment(creds, args.taskId, comment);

  return { gateId: gate.id, recorded: true, unsatisfied, comment };
}

/* ------------------------------------------------------------------ */
/* Transition                                                          */
/* ------------------------------------------------------------------ */

export interface AdvanceResult {
  ok: boolean;
  from?: State;
  to: State;
  moved: boolean;
  reason?: string;
  gateRequired?: GateId;
  gateSatisfied?: boolean;
  warnings: string[];
}

export async function advanceDeliverable(
  creds: Creds,
  args: {
    taskId: string;
    to: State;
    by: string;
    reason?: string;
    /** Move even if the guarding gate has no recorded sign-off. */
    force?: boolean;
  },
): Promise<AdvanceResult> {
  const view = await readDeliverable(creds, args.taskId);
  const warnings: string[] = [];

  if (!view.state) {
    return {
      ok: false,
      to: args.to,
      moved: false,
      reason:
        "current state unknown — the task is in a list that does not map to a workflow column. Move it onto a provisioned board first.",
      warnings,
    };
  }

  const type: DeliverableType = view.meta.type ?? "internal";
  const check = checkTransition(view.state, args.to, type);
  if (!check.allowed) {
    return {
      ok: false,
      from: view.state,
      to: args.to,
      moved: false,
      reason: check.reason,
      warnings,
    };
  }

  // Gate discipline.
  let gateSatisfied = true;
  const gateId = check.gate?.id;
  if (gateId && !check.gateSkippable) {
    gateSatisfied = view.gatesPassed.includes(gateId);
    if (!gateSatisfied) {
      if (!args.force) {
        return {
          ok: false,
          from: view.state,
          to: args.to,
          moved: false,
          reason: `gate ${gateId} (${check.gate?.title}) has not been signed off on this deliverable`,
          gateRequired: gateId,
          gateSatisfied: false,
          warnings,
        };
      }
      warnings.push(
        `FORCED past ${gateId} (${check.gate?.title}) without a recorded sign-off — this is now in the audit trail.`,
      );
    }
  } else if (gateId && check.gateSkippable) {
    warnings.push(
      `${gateId} is not required for deliverable type "${type}" — skipped by policy.`,
    );
  }

  // Client approval is special: never allow reaching `approved` without one.
  if (args.to === "approved" && type !== "internal" && !view.clientApproved) {
    if (!args.force) {
      return {
        ok: false,
        from: view.state,
        to: args.to,
        moved: false,
        reason:
          "no CLIENT-APPROVAL record on this deliverable. Record the client's explicit written approval first (workflow_record_approval).",
        warnings,
      };
    }
    warnings.push("FORCED into approved with no recorded client approval.");
  }

  // Structural move.
  const lists = await listBoardLists(creds, view.boardId);
  const index = buildStateIndex(lists);
  const targetList = index.get(args.to);
  let moved = false;
  if (targetList) {
    await moveTask(creds, args.taskId, view.boardId, targetList);
    moved = true;
  } else {
    warnings.push(
      `board has no column for "${args.to}" — state recorded in metadata only. Run workflow_provision_board.`,
    );
  }

  // Metadata + narrative.
  const patch: Partial<DeliverableMeta> = { state: args.to };
  if (args.to === "blocked" || args.to === "changes_requested") {
    patch.resumeState = view.state;
  }
  const nextMeta = mergeMeta(view.meta, patch);
  await updateTask(creds, args.taskId, {
    description: composeDescription(view.brief, nextMeta, view.evidence),
  });

  await addComment(
    creds,
    args.taskId,
    renderTransition({ from: view.state, to: args.to, by: args.by, reason: args.reason }) +
      (warnings.length ? `\n\n${warnings.map((w) => `⚠ ${w}`).join("\n")}` : ""),
  );

  return {
    ok: true,
    from: view.state,
    to: args.to,
    moved,
    gateRequired: gateId,
    gateSatisfied,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Compliance                                                          */
/* ------------------------------------------------------------------ */

export async function runComplianceCheck(
  creds: Creds,
  args: { taskId: string; overrides?: Partial<ComplianceInput>; post?: boolean },
): Promise<{ report: ComplianceReport; posted: boolean }> {
  const view = await readDeliverable(creds, args.taskId);
  const m = view.meta;

  // Negative/comparative claims come from the deliverable's own evidence
  // register, so the compliance check and the register can never disagree.
  const negativeClaims = view.evidence
    .filter((e) => e.status !== "withdrawn")
    .map((e) => ({
      claim: e.claim,
      evidence: [e.source, e.url, e.archived].filter(
        (x): x is string => Boolean(x),
      ),
    }));

  const input: ComplianceInput = {
    deliverableType: m.type ?? "internal",
    negativeClaims,
    jurisdiction: m.jurisdiction ?? "AU",
    region: m.region,
    platforms: m.platforms ?? [],
    paid: m.paid ?? false,
    electoralMatter: m.electoralMatter ?? true,
    authorisationText: m.authorisationText ?? null,
    payingEntity: m.payingEntity ?? null,
    verifiedPlatforms: m.verifiedPlatforms ?? [],
    specialCategoryDeclared: m.specialCategoryDeclared ?? false,
    aiGeneratedMedia: m.aiGeneratedMedia ?? false,
    aiDisclosed: m.aiDisclosed ?? false,
    flightStart: m.flightStart,
    flightEnd: m.flightEnd,
    electionDate: m.electionDate,
    recordRetained: m.recordRetained ?? false,
    ...args.overrides,
  };

  const report = evaluateCompliance(input);
  let posted = false;
  if (args.post !== false) {
    await addComment(creds, args.taskId, renderComplianceComment(report));
    posted = true;
  }
  return { report, posted };
}

/* ------------------------------------------------------------------ */
/* Client approval                                                     */
/* ------------------------------------------------------------------ */

export async function recordApproval(
  creds: Creds,
  args: {
    taskId: string;
    approver: string;
    version: string;
    scope: string;
    conditions?: string;
    quotedFrom?: string;
  },
): Promise<{ recorded: true; comment: string }> {
  const view = await readDeliverable(creds, args.taskId);
  const comment = renderClientApproval(args);
  await addComment(creds, args.taskId, comment);

  const nextMeta = mergeMeta(view.meta, {
    version: args.version,
    clientApprover: args.approver,
  });
  await updateTask(creds, args.taskId, {
    description: composeDescription(view.brief, nextMeta, view.evidence),
  });

  return { recorded: true, comment };
}

/* ------------------------------------------------------------------ */
/* Evidence register                                                   */
/* ------------------------------------------------------------------ */

export async function setEvidence(
  creds: Creds,
  args: { taskId: string; entries: EvidenceEntry[]; post?: boolean },
): Promise<{ entries: EvidenceEntry[]; audit: EvidenceAudit; posted: boolean }> {
  const view = await readDeliverable(creds, args.taskId);
  await updateTask(creds, args.taskId, {
    description: composeDescription(view.brief, view.meta, args.entries),
  });

  let posted = false;
  if (args.post !== false) {
    await addComment(creds, args.taskId, renderEvidenceReport(args.entries));
    posted = true;
  }
  return { entries: args.entries, audit: auditEvidence(args.entries), posted };
}

/* ------------------------------------------------------------------ */
/* Record pack — the statutory retention artefact                      */
/* ------------------------------------------------------------------ */

export interface RecordPack {
  taskId: string;
  title: string;
  generatedAt: string;
  /** Everything a disclosure return or complaint response needs. */
  markdown: string;
  /** Gaps that make this record incomplete. */
  gaps: string[];
}

/**
 * Assemble the retention record for a deliverable: what ran, who
 * authorised it, who paid, who approved it, on what evidence, and when.
 *
 * This is the document you produce when a regulator, a journalist or a
 * client's lawyer asks what happened. Assembling it after the fact from
 * a Slack thread is how agencies lose arguments.
 */
export async function buildRecordPack(
  creds: Creds,
  args: { taskId: string },
): Promise<RecordPack> {
  const view = await readDeliverable(creds, args.taskId);
  const m = view.meta;
  const gaps: string[] = [];

  const comments = await listComments(creds, args.taskId);
  const byKind = (kind: string) =>
    comments.filter((c) => classifyComment(commentText(c)) === kind);

  const approvals = byKind("approval");
  const gatePasses = byKind("gate");
  const complianceRuns = byKind("compliance");
  const transitions = byKind("transition");

  if (!m.authorisationText) gaps.push("No authorisation statement recorded.");
  if (!m.payingEntity) gaps.push("No paying entity recorded.");
  if (!approvals.length) gaps.push("No client approval record.");
  if (!complianceRuns.length) gaps.push("No compliance check was ever run.");
  if (!m.recordRetained) gaps.push("Final creative not marked as retained.");
  if (!view.evidenceAudit.clean && view.evidence.length) {
    gaps.push(`${view.evidenceAudit.unsourced.length} claim(s) remain unsourced.`);
  }
  if (!m.flightStart) gaps.push("No flight start date recorded.");

  const L: string[] = [];
  L.push(`# Record pack — ${view.title}`);
  L.push("");
  L.push(`Generated ${new Date().toISOString()} · Kitchen task \`${args.taskId}\``);
  L.push("");

  L.push("## What it was");
  L.push("");
  L.push(`- **Type:** ${m.type ?? "—"}`);
  L.push(`- **Workstream:** ${m.workstream ?? "—"}`);
  L.push(`- **Final state:** ${view.state ?? "unknown"}`);
  L.push(`- **Version of record:** ${m.version ?? "—"}`);
  L.push(`- **Platforms:** ${m.platforms?.join(", ") || "—"}`);
  L.push(`- **Paid placement:** ${m.paid ? "yes" : "no"}`);
  L.push(`- **Electoral matter:** ${m.electoralMatter === false ? "no" : "yes"}`);
  L.push("");

  L.push("## Authorisation and funding");
  L.push("");
  L.push(`- **Jurisdiction:** ${m.jurisdiction ?? "—"}${m.region ? ` / ${m.region}` : ""}`);
  L.push(`- **Authorisation statement:** ${m.authorisationText ?? "**MISSING**"}`);
  L.push(`- **Paying entity:** ${m.payingEntity ?? "**MISSING**"}`);
  L.push(`- **Advertiser verification confirmed on:** ${m.verifiedPlatforms?.join(", ") || "—"}`);
  L.push(`- **Special ad category declared:** ${m.specialCategoryDeclared ? "yes" : "no"}`);
  L.push("");

  L.push("## Flight");
  L.push("");
  L.push(`- **Start:** ${m.flightStart ?? "—"}`);
  L.push(`- **End:** ${m.flightEnd ?? "—"}`);
  L.push(`- **Election date:** ${m.electionDate ?? "—"}`);
  L.push("");

  L.push("## Approval");
  L.push("");
  if (approvals.length) {
    for (const a of approvals) {
      L.push(`> ${commentText(a).replace(/\n/g, "\n> ")}`);
      L.push("");
      L.push(`_Recorded ${a.created_at ?? "—"}, author \`${a.author ?? "—"}\`._`);
      L.push("");
    }
  } else {
    L.push("**No client approval was recorded against this deliverable.**");
    L.push("");
  }

  L.push("## Gate signatures");
  L.push("");
  if (gatePasses.length) {
    for (const g of gatePasses) {
      const id = extractGateId(commentText(g)) ?? "unknown gate";
      L.push(`- \`${id}\` — ${g.created_at ?? "—"} — author \`${g.author ?? "—"}\``);
    }
  } else {
    L.push("None recorded.");
  }
  L.push("");
  L.push(`Gates signed: ${view.gatesPassed.join(", ") || "none"}`);
  L.push("");

  L.push("## Compliance history");
  L.push("");
  if (complianceRuns.length) {
    const last = complianceRuns[complianceRuns.length - 1];
    L.push(`${complianceRuns.length} check(s) run. Most recent:`);
    L.push("");
    L.push("```");
    L.push(commentText(last).slice(0, 2000));
    L.push("```");
  } else {
    L.push("**No compliance check was ever run against this deliverable.**");
  }
  L.push("");

  L.push("## Evidence register");
  L.push("");
  L.push(view.evidence.length ? renderEvidenceReport(view.evidence) : "No claims registered.");
  L.push("");

  L.push("## State history");
  L.push("");
  if (transitions.length) {
    for (const tr of transitions) {
      L.push(`- ${tr.created_at ?? "—"} — ${commentText(tr).split("\n")[0].replace(/\*\*/g, "")}`);
    }
  } else {
    L.push("No state changes recorded.");
  }
  L.push("");

  L.push("## Attachments on record");
  L.push("");
  const withFiles = comments.filter((c) => (c.attachments?.length ?? 0) > 0);
  if (withFiles.length) {
    for (const c of withFiles) {
      L.push(`- ${c.created_at ?? "—"} — ${c.attachments?.join(", ")}`);
    }
  } else {
    L.push("No files attached to any comment on this task.");
  }
  L.push("");

  if (gaps.length) {
    L.push("## Gaps in this record");
    L.push("");
    for (const g of gaps) L.push(`- ${g}`);
    L.push("");
    L.push(
      "_A record with gaps is still the record. Fill them while the people involved still remember._",
    );
  } else {
    L.push("## Completeness");
    L.push("");
    L.push("No gaps detected. This record answers what ran, who authorised it, who paid, who approved it and on what evidence.");
  }

  return {
    taskId: args.taskId,
    title: view.title,
    generatedAt: new Date().toISOString(),
    markdown: L.join("\n"),
    gaps,
  };
}

/* ------------------------------------------------------------------ */
/* Board-level status                                                  */
/* ------------------------------------------------------------------ */

export interface BoardStatus {
  boardId: string;
  counts: Partial<Record<State, number>>;
  stalled: Array<{ taskId: string; title: string; state: State; dueAt?: string | null }>;
  awaitingClient: Array<{ taskId: string; title: string }>;
  awaitingCompliance: Array<{ taskId: string; title: string }>;
  blocked: Array<{ taskId: string; title: string }>;
  unmappedLists: string[];
}

export async function boardStatus(
  creds: Creds,
  args: { boardId: string },
): Promise<BoardStatus> {
  const lists = await listBoardLists(creds, args.boardId);
  const index = buildStateIndex(lists);
  const listToState = new Map<string, State>();
  for (const [s, id] of index) listToState.set(id, s);

  const res = (await callKitchen(creds, {
    method: "GET",
    path: `/api/boards/${encodeURIComponent(args.boardId)}/tasks`,
    query: { per_page: 100 },
  })) as { data?: KitchenTask[] };
  const tasks = res.data ?? [];

  const status: BoardStatus = {
    boardId: args.boardId,
    counts: {},
    stalled: [],
    awaitingClient: [],
    awaitingCompliance: [],
    blocked: [],
    unmappedLists: lists
      .filter((l) => l.title && !listToState.has(l.id))
      .map((l) => l.title as string),
  };

  const now = Date.now();
  for (const t of tasks) {
    const state = listToState.get(t.list);
    if (!state) continue;
    status.counts[state] = (status.counts[state] ?? 0) + 1;

    if (state === "client_review") status.awaitingClient.push({ taskId: t.id, title: t.title });
    if (state === "compliance_review")
      status.awaitingCompliance.push({ taskId: t.id, title: t.title });
    if (state === "blocked") status.blocked.push({ taskId: t.id, title: t.title });

    if (t.due_at) {
      const due = Date.parse(t.due_at);
      const live = !["archived", "cancelled", "verified"].includes(state);
      if (live && !Number.isNaN(due) && due < now) {
        status.stalled.push({ taskId: t.id, title: t.title, state, dueAt: t.due_at });
      }
    }
  }

  return status;
}

/* ------------------------------------------------------------------ */
/* Status reporting                                                    */
/* ------------------------------------------------------------------ */

export interface StatusReport {
  boardId: string;
  generatedAt: string;
  /** Internal view — blunt, includes what is going wrong. */
  internal: string;
  /** Client-facing view — what shipped, what's coming, what we need. */
  client: string;
}

/**
 * Two reports from one board read, because the internal standup and the
 * client update are genuinely different documents. The internal one
 * names what is stuck and why; the client one says what shipped, what is
 * next, and what the agency is waiting on them for.
 */
export async function buildStatusReport(
  creds: Creds,
  args: { boardId: string; clientName?: string; periodLabel?: string },
): Promise<StatusReport> {
  const status = await boardStatus(creds, { boardId: args.boardId });
  const c = status.counts;
  const n = (s: State) => c[s] ?? 0;

  const live =
    n("intake") + n("scoped") + n("in_production") + n("internal_review") +
    n("compliance_review") + n("client_review") + n("changes_requested") +
    n("approved") + n("scheduled");
  const shipped = n("deployed") + n("verified") + n("archived");

  /* ---- internal ---- */
  const I: string[] = [];
  I.push(`# Pipeline — ${args.clientName ?? args.boardId}${args.periodLabel ? ` · ${args.periodLabel}` : ""}`);
  I.push("");
  I.push(`${live} live, ${shipped} shipped, ${n("blocked")} blocked.`);
  I.push("");
  I.push("| State | Count |");
  I.push("|---|---|");
  for (const s of BOARD_COLUMN_ORDER) {
    if (n(s)) I.push(`| ${STATE_COLUMN_TITLES[s]} | ${n(s)} |`);
  }
  I.push("");

  if (status.stalled.length) {
    I.push(`## Overdue (${status.stalled.length})`);
    I.push("");
    for (const t of status.stalled) {
      I.push(`- **${t.title}** — ${STATE_COLUMN_TITLES[t.state]}, due ${t.dueAt?.slice(0, 10)}`);
    }
    I.push("");
  }
  if (status.blocked.length) {
    I.push(`## Blocked (${status.blocked.length})`);
    I.push("");
    for (const t of status.blocked) I.push(`- ${t.title}`);
    I.push("");
    I.push("_Blocked items need an owner and a date, or they need cancelling._");
    I.push("");
  }
  if (status.awaitingCompliance.length) {
    I.push(`## Waiting on compliance (${status.awaitingCompliance.length})`);
    I.push("");
    for (const t of status.awaitingCompliance) I.push(`- ${t.title}`);
    I.push("");
    I.push("_Usually one missing field. Clear these first — they hold up everything behind them._");
    I.push("");
  }
  if (n("changes_requested")) {
    I.push(
      `## Rework\n\n${n("changes_requested")} item(s) in Changes Requested. Anything sitting here beyond a week is a scoping failure — re-brief it rather than iterating.\n`,
    );
  }
  if (n("deployed") && !n("verified")) {
    I.push(
      `## Unclosed loops\n\n${n("deployed")} item(s) deployed but not verified. Confirm they are live, the authorisation is visible, and capture the permalink.\n`,
    );
  }
  if (status.unmappedLists.length) {
    I.push(
      `## Off-workflow columns\n\n${status.unmappedLists.map((x) => `\`${x}\``).join(", ")} — deliverables parked here are invisible to the engine.\n`,
    );
  }

  /* ---- client ---- */
  const C: string[] = [];
  C.push(`# Status update${args.clientName ? ` — ${args.clientName}` : ""}${args.periodLabel ? ` · ${args.periodLabel}` : ""}`);
  C.push("");
  C.push(`**${shipped}** deliverable(s) live. **${live}** in progress.`);
  C.push("");

  C.push("## In progress");
  C.push("");
  const inProgress =
    n("intake") + n("scoped") + n("in_production") + n("internal_review") + n("compliance_review");
  C.push(inProgress ? `${inProgress} item(s) in production and review with us.` : "Nothing currently in production.");
  C.push("");

  if (status.awaitingClient.length) {
    C.push(`## We need from you (${status.awaitingClient.length})`);
    C.push("");
    for (const t of status.awaitingClient) C.push(`- **${t.title}** — awaiting your sign-off`);
    C.push("");
    C.push(
      "_To keep these moving we need an explicit yes from the named approver, confirming the version and whether the approval covers placement and spend as well as creative._",
    );
    C.push("");
  }

  if (n("approved") || n("scheduled")) {
    C.push("## Approved and ready");
    C.push("");
    C.push(`${n("approved") + n("scheduled")} item(s) signed off and queued to go live.`);
    C.push("");
  }

  if (status.blocked.length) {
    C.push("## Held up");
    C.push("");
    for (const t of status.blocked) C.push(`- ${t.title}`);
    C.push("");
  }

  return {
    boardId: args.boardId,
    generatedAt: new Date().toISOString(),
    internal: I.join("\n"),
    client: C.join("\n"),
  };
}

export { STATE_COLUMN_TITLES };
