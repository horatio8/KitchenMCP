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
  GATES,
  STATE_COLUMN_TITLES,
  gateById,
  type DeliverableType,
  type GateId,
  type State,
} from "./types.js";

type Creds = KitchenCredentials;

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

  return {
    taskId,
    title: task.title,
    boardId: task.board,
    listId: task.list,
    state,
    meta,
    brief: stripMeta(task.description),
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
    description: upsertMeta(view.brief, nextMeta),
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

  const input: ComplianceInput = {
    deliverableType: m.type ?? "internal",
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
    description: upsertMeta(view.brief, nextMeta),
  });

  return { recorded: true, comment };
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

export { STATE_COLUMN_TITLES };
