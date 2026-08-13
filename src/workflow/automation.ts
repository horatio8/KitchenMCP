/**
 * Event-driven workflow automation.
 *
 * The webhook receiver already verifies and dedupes Kitchen deliveries.
 * This module decides what the workflow should *do* about them.
 *
 * Principles:
 *  - Never move a deliverable on the client's behalf. Automation
 *    observes, checks and annotates; humans transition.
 *  - Post findings where the work is (the task), not into a log nobody
 *    reads.
 *  - Be idempotent. Kitchen retries; the receiver dedupes by event id,
 *    but a comment posted twice is still noise, so checks are cheap and
 *    guarded.
 */

import { config } from "../config.js";
import { callKitchen } from "../kitchen/client.js";
import type { KitchenCredentials } from "../kitchen/credentials.js";
import { logger } from "../logger.js";
import { readDeliverable, runComplianceCheck } from "./engine.js";
import { APPROVAL_MARKER, classifyComment } from "./kitchen-map.js";
import type { State } from "./types.js";

export interface KitchenEvent {
  id: string;
  type: string;
  created?: number;
  data?: Record<string, unknown>;
}

export interface AutomationOutcome {
  eventId: string;
  eventType: string;
  actions: string[];
  skipped?: string;
}

/** Server-side credentials for automation. Null when not single-tenant. */
export function automationCredentials(): KitchenCredentials | null {
  if (!config.fallbackKitchenApiKey || !config.fallbackKitchenWorkspace) return null;
  return {
    apiKey: config.fallbackKitchenApiKey,
    workspace: config.fallbackKitchenWorkspace,
  };
}

/** Phrases a client might use that read as an approval. */
const APPROVAL_PHRASES = [
  /\bapproved\b/i,
  /\bapprove\b/i,
  /\bsigned?\s*off\b/i,
  /\bgood to go\b/i,
  /\ball good\b/i,
  /\bship it\b/i,
  /\bgo ahead\b/i,
  /\bhappy with (this|that|it)\b/i,
];

const CHANGE_PHRASES = [
  /\bchange\b/i,
  /\bamend\b/i,
  /\brevise\b/i,
  /\bnot quite\b/i,
  /\bcan we\b/i,
  /\bplease (fix|update|adjust)\b/i,
];

export function looksLikeApproval(text: string): boolean {
  if (!text) return false;
  if (CHANGE_PHRASES.some((r) => r.test(text))) return false;
  return APPROVAL_PHRASES.some((r) => r.test(text));
}

async function comment(
  creds: KitchenCredentials,
  taskId: string,
  content: string,
): Promise<void> {
  await callKitchen(creds, {
    method: "POST",
    path: `/api/tasks/${encodeURIComponent(taskId)}/comments`,
    body: { content },
  });
}

function taskIdFrom(event: KitchenEvent): string | undefined {
  const d = event.data ?? {};
  const direct = d.id;
  if (typeof direct === "string" && direct.startsWith("tsk_")) return direct;
  const nested = d.task;
  if (typeof nested === "string" && nested.startsWith("tsk_")) return nested;
  if (nested && typeof nested === "object") {
    const id = (nested as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/**
 * React to a verified Kitchen event. Returns a description of what was
 * done so the receiver can log it. Never throws into the caller — the
 * webhook has already been acked by the time this runs.
 */
export async function handleWorkflowEvent(
  event: KitchenEvent,
): Promise<AutomationOutcome> {
  const out: AutomationOutcome = {
    eventId: event.id,
    eventType: event.type,
    actions: [],
  };

  const creds = automationCredentials();
  if (!creds) {
    out.skipped = "no server-side Kitchen credentials configured";
    return out;
  }

  const taskId = taskIdFrom(event);
  if (!taskId) {
    out.skipped = "event carries no task id";
    return out;
  }

  try {
    switch (event.type) {
      case "task.list_updated":
        await onListUpdated(creds, taskId, out);
        break;
      case "task.comment_created":
        await onCommentCreated(creds, taskId, event, out);
        break;
      case "task.due":
      case "task.due_reminder":
        await onDue(creds, taskId, out);
        break;
      default:
        out.skipped = `no automation for ${event.type}`;
    }
  } catch (err) {
    logger.warn(
      { eventId: event.id, type: event.type, taskId, err: String(err) },
      "workflow automation failed",
    );
    out.actions.push(`error: ${String(err)}`);
  }

  return out;
}

/** A deliverable landed in a new column. */
async function onListUpdated(
  creds: KitchenCredentials,
  taskId: string,
  out: AutomationOutcome,
): Promise<void> {
  const view = await readDeliverable(creds, taskId);
  if (!view.state) {
    out.skipped = "task is not on a workflow column";
    return;
  }

  const state: State = view.state;

  // Entering compliance: run the check automatically and post the report.
  if (state === "compliance_review") {
    const already = view.audit.some((a) => a.kind === "compliance");
    const { report } = await runComplianceCheck(creds, { taskId, post: true });
    out.actions.push(
      `posted compliance report (${report.verdict}, ${report.summary.blockers} blocker(s))` +
        (already ? " [re-run]" : ""),
    );
    return;
  }

  // Entering approved without a recorded approval: say so, loudly.
  if (state === "approved" && !view.clientApproved && view.meta.type !== "internal") {
    await comment(
      creds,
      taskId,
      `⚠ **Workflow warning** — this moved into Approved but there is no \`${APPROVAL_MARKER}\` record on the card.\n\n` +
        "An approval that isn't written down isn't an approval. Record who approved it, which version, " +
        "and whether the approval covers placement and spend as well as creative.",
    );
    out.actions.push("warned: approved without an approval record");
    return;
  }

  // Entering deployed while compliance still shows blockers.
  if (state === "deployed") {
    const complianceEntries = view.audit.filter((a) => a.kind === "compliance");
    const last = complianceEntries[complianceEntries.length - 1];
    if (last && /LIKELY REJECTED/i.test(last.excerpt)) {
      await comment(
        creds,
        taskId,
        "⚠ **Workflow warning** — this was deployed while the last compliance check still read LIKELY REJECTED. " +
          "Re-run the check and confirm the blockers were cleared, or pull the placement.",
      );
      out.actions.push("warned: deployed over an unresolved compliance verdict");
    }
    if (!view.meta.recordRetained) {
      out.actions.push("note: no retained creative record flagged on this deliverable");
    }
  }
}

/** Someone commented — possibly the client approving. */
async function onCommentCreated(
  creds: KitchenCredentials,
  taskId: string,
  event: KitchenEvent,
  out: AutomationOutcome,
): Promise<void> {
  const data = event.data ?? {};
  const content =
    typeof data.content === "string"
      ? data.content
      : typeof (data.comment as Record<string, unknown>)?.content === "string"
        ? ((data.comment as Record<string, unknown>).content as string)
        : "";

  if (!content) {
    out.skipped = "comment carried no content";
    return;
  }

  // Ignore our own structured records — they already are the audit trail.
  if (classifyComment(content) !== "other") {
    out.skipped = "structured workflow comment, not client feedback";
    return;
  }

  if (!looksLikeApproval(content)) {
    out.skipped = "comment does not read as an approval";
    return;
  }

  const view = await readDeliverable(creds, taskId);
  if (view.clientApproved) {
    out.skipped = "approval already recorded";
    return;
  }

  await comment(
    creds,
    taskId,
    "**Possible client approval detected.**\n\n" +
      `> ${content.slice(0, 300).replace(/\n/g, "\n> ")}\n\n` +
      "This has *not* been recorded as a formal approval yet. To make it binding and auditable, record it with " +
      "the approver's name, the exact version approved, and whether the approval covers placement and spend " +
      "as well as creative.\n\n" +
      `_Current version on this card: ${view.meta.version ?? "unset"}._`,
  );
  out.actions.push("flagged a possible client approval for formalisation");
}

/** Something is due. */
async function onDue(
  creds: KitchenCredentials,
  taskId: string,
  out: AutomationOutcome,
): Promise<void> {
  const view = await readDeliverable(creds, taskId);
  if (!view.state) {
    out.skipped = "task is not on a workflow column";
    return;
  }
  if (["deployed", "verified", "archived", "cancelled"].includes(view.state)) {
    out.skipped = `already ${view.state}`;
    return;
  }

  const remaining = view.remaining.length;
  await comment(
    creds,
    taskId,
    `**Due now** — still in *${view.state}* with ${remaining} step(s) left ` +
      `(${view.remaining.join(" → ") || "none"}).\n\n` +
      (view.state === "client_review"
        ? "Waiting on the client. Chase the named approver rather than the group thread."
        : view.state === "compliance_review"
          ? "Waiting on compliance sign-off."
          : "Needs attention to hit its date."),
  );
  out.actions.push(`posted due nudge (state=${view.state})`);
}
