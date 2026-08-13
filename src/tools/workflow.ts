import { z } from "zod";
import {
  JURISDICTIONS,
  PLATFORMS,
  evaluateCompliance,
  platformMatrix,
  type ComplianceInput,
} from "../workflow/compliance.js";
import {
  advanceDeliverable,
  boardStatus,
  createDeliverable,
  provisionBoard,
  readDeliverable,
  recordApproval,
  runComplianceCheck,
  signGate,
} from "../workflow/engine.js";
import { allowedTransitions, happyPath } from "../workflow/states.js";
import {
  DELIVERABLE_TYPES,
  GATES,
  STATES,
  STATE_COLUMN_TITLES,
  WORKSTREAMS,
  WORKSTREAM_LABELS,
  gateById,
  requiredGates,
  type GateId,
} from "../workflow/types.js";
import type { ToolRegistry } from "./registry.js";

const stateEnum = z.enum(STATES);
const typeEnum = z.enum(DELIVERABLE_TYPES);
const workstreamEnum = z.enum(WORKSTREAMS);
const jurisdictionEnum = z.enum(JURISDICTIONS);
const platformEnum = z.enum(PLATFORMS);
const gateEnum = z.enum(GATES.map((g) => g.id) as [GateId, ...GateId[]]);

const metaShape = {
  type: typeEnum.optional(),
  workstream: workstreamEnum.optional(),
  jurisdiction: jurisdictionEnum.optional(),
  region: z.string().optional().describe("State/province, e.g. 'SA' for a South Australian election."),
  platforms: z.array(platformEnum).optional(),
  paid: z.boolean().optional().describe("Is this a paid placement?"),
  electoralMatter: z
    .boolean()
    .optional()
    .describe("Is this communicated for the dominant purpose of influencing a vote?"),
  authorisationText: z.string().optional().describe("The authorisation/disclaimer exactly as it will appear."),
  payingEntity: z.string().optional(),
  verifiedPlatforms: z.array(platformEnum).optional().describe("Platforms where advertiser verification is confirmed complete."),
  specialCategoryDeclared: z.boolean().optional(),
  aiGeneratedMedia: z.boolean().optional(),
  aiDisclosed: z.boolean().optional(),
  flightStart: z.string().optional().describe("ISO date."),
  flightEnd: z.string().optional().describe("ISO date."),
  electionDate: z.string().optional().describe("ISO date — drives blackout/freeze checks."),
  recordRetained: z.boolean().optional(),
  version: z.string().optional(),
  producer: z.string().optional(),
  reviewer: z.string().optional(),
  deployer: z.string().optional(),
  clientApprover: z.string().optional(),
  notes: z.string().optional(),
};

export function registerWorkflowTools(reg: ToolRegistry): void {
  /* ---------------- reference ---------------- */

  reg.add({
    name: "workflow_describe",
    description:
      "Describe the deliverable workflow: lifecycle states, gates and their checks, workstreams, deliverable types, and the platform permission matrix. Call this first when you need to reason about the process.",
    readOnly: true,
    inputSchema: {
      deliverable_type: typeEnum
        .optional()
        .describe("If given, shows the gates that are mandatory for this type."),
    },
    handler: async ({ deliverable_type }) => ({
      states: STATES.map((s) => ({ state: s, column: STATE_COLUMN_TITLES[s] })),
      workstreams: WORKSTREAMS.map((w) => ({ id: w, label: WORKSTREAM_LABELS[w] })),
      deliverable_types: DELIVERABLE_TYPES,
      gates: (deliverable_type ? requiredGates(deliverable_type) : GATES).map((g) => ({
        id: g.id,
        title: g.title,
        from: g.from,
        to: g.to,
        owner: g.owner,
        skipped_for: g.skipFor ?? [],
        checks: g.checks.map((c) => ({
          id: c.id,
          assertion: c.assertion,
          advisory: c.advisory ?? false,
        })),
      })),
      happy_path: deliverable_type ? happyPath(deliverable_type) : undefined,
      platform_matrix: platformMatrix(),
    }),
  });

  reg.add({
    name: "workflow_next_steps",
    description:
      "Given a current state, list the legal next moves and which gate guards each. Use to answer 'what can I do with this deliverable now?'.",
    readOnly: true,
    inputSchema: { state: stateEnum },
    handler: async ({ state }) => ({
      from: state,
      transitions: allowedTransitions(state).map((t) => ({
        to: t.to,
        kind: t.kind,
        gate: t.gate,
        gate_title: t.gate ? gateById(t.gate)?.title : undefined,
        description: t.description,
      })),
    }),
  });

  /* ---------------- provisioning ---------------- */

  reg.add({
    name: "workflow_provision_board",
    description:
      "Make a Kitchen board conform to the deliverable workflow by creating a column for every lifecycle state. Reuses columns that already map to a state (so 'Client Review', 'Drafting' etc. are kept). Safe to re-run. Pass board_title instead of board_id to create a new board.",
    inputSchema: {
      board_id: z.string().optional().describe("Existing board to bring into conformance."),
      board_title: z.string().optional().describe("Create a new board with this title instead."),
      visibility: z.enum(["private", "internal", "shared"]).optional(),
    },
    handler: async (input, ctx) =>
      provisionBoard(ctx.credentials, {
        boardId: input.board_id,
        boardTitle: input.board_title,
        visibility: input.visibility,
      }),
  });

  /* ---------------- deliverables ---------------- */

  reg.add({
    name: "workflow_create_deliverable",
    description:
      "Create a deliverable on a workflow board. Lands in Intake with its metadata block written into the description. The brief should say who it is for, what it must say, and the one action it should drive.",
    inputSchema: {
      board_id: z.string(),
      title: z.string(),
      brief: z.string().describe("Human-readable brief. Markdown is fine."),
      due_at: z.string().optional().describe("ISO 8601."),
      assignee: z.string().optional().describe("Kitchen user ID of the producer."),
      ...metaShape,
    },
    handler: async (input, ctx) => {
      const { board_id, title, brief, due_at, assignee, ...meta } = input;
      return createDeliverable(ctx.credentials, {
        boardId: board_id,
        title,
        brief,
        dueAt: due_at,
        assignee,
        meta,
      });
    },
  });

  reg.add({
    name: "workflow_get_deliverable",
    description:
      "Read a deliverable's full workflow position: current state, metadata, brief, which gates have been signed, whether the client has approved, the audit trail, and what remains on its path.",
    readOnly: true,
    inputSchema: { task_id: z.string() },
    handler: async ({ task_id }, ctx) => readDeliverable(ctx.credentials, task_id),
  });

  reg.add({
    name: "workflow_update_deliverable",
    description:
      "Update a deliverable's workflow metadata (jurisdiction, platforms, authorisation text, flight dates, paying entity, etc.) without changing its state. The brief text is preserved.",
    inputSchema: {
      task_id: z.string(),
      brief: z.string().optional().describe("Replace the human-readable brief."),
      ...metaShape,
    },
    handler: async (input, ctx) => {
      const { task_id, brief, ...patch } = input;
      const view = await readDeliverable(ctx.credentials, task_id);
      const { mergeMeta, upsertMeta } = await import("../workflow/kitchen-map.js");
      const { callKitchen } = await import("../kitchen/client.js");
      const nextMeta = mergeMeta(view.meta, patch);
      const nextBrief = brief ?? view.brief;
      await callKitchen(ctx.credentials, {
        method: "PUT",
        path: `/api/tasks/${encodeURIComponent(task_id)}`,
        body: { description: upsertMeta(nextBrief, nextMeta) },
      });
      return { task_id, meta: nextMeta };
    },
  });

  /* ---------------- gates ---------------- */

  reg.add({
    name: "workflow_sign_gate",
    description:
      "Record a gate sign-off against a deliverable as an attributed, timestamped comment. This is the audit trail — a deliverable cannot advance past a gate without one. Pass the outcome of each check; any check you omit is recorded as not satisfied.",
    inputSchema: {
      task_id: z.string(),
      gate_id: gateEnum,
      by: z.string().describe("Who is signing. Use a real name, not a role."),
      version: z.string().optional().describe("Version being signed off, e.g. 'v3'."),
      checks: z
        .array(
          z.object({
            id: z.string().describe("Check id from workflow_describe."),
            passed: z.boolean(),
            note: z.string().optional(),
          }),
        )
        .describe("Outcome per check."),
    },
    handler: async (input, ctx) =>
      signGate(ctx.credentials, {
        taskId: input.task_id,
        gateId: input.gate_id,
        by: input.by,
        checks: input.checks,
        version: input.version,
      }),
  });

  reg.add({
    name: "workflow_advance",
    description:
      "Move a deliverable to a new state. Enforces the state machine and refuses to cross a gate that has not been signed off, and refuses to reach 'approved' without a recorded client approval. Use force:true only deliberately — it is recorded in the audit trail.",
    inputSchema: {
      task_id: z.string(),
      to: stateEnum,
      by: z.string().describe("Who is making the move."),
      reason: z.string().optional(),
      force: z
        .boolean()
        .optional()
        .describe("Override a missing gate sign-off. Recorded permanently as a forced move."),
    },
    handler: async (input, ctx) =>
      advanceDeliverable(ctx.credentials, {
        taskId: input.task_id,
        to: input.to,
        by: input.by,
        reason: input.reason,
        force: input.force,
      }),
  });

  /* ---------------- compliance ---------------- */

  reg.add({
    name: "workflow_compliance_check",
    description:
      "Run the political-advertising compliance engine against a deliverable and post the report as a comment. Checks authorisation/disclaimer form, paying entity, platform permission and advertiser verification, special ad category, evidence on negative claims, AI-media disclosure, targeting legality, blackout/freeze timing and record retention. Warn-only: it never blocks, it reports.",
    inputSchema: {
      task_id: z.string(),
      post_comment: z
        .boolean()
        .optional()
        .describe("Post the report to the task. Default true."),
      override: z
        .object({
          paid: z.boolean().optional(),
          electoralMatter: z.boolean().optional(),
          platforms: z.array(platformEnum).optional(),
          negativeClaims: z
            .array(z.object({ claim: z.string(), evidence: z.array(z.string()).optional() }))
            .optional(),
          targeting: z
            .object({
              countries: z.array(z.string()).optional(),
              interests: z.array(z.string()).optional(),
              ageMin: z.number().optional(),
              ageMax: z.number().optional(),
            })
            .optional(),
        })
        .optional()
        .describe("Values to override the deliverable's stored metadata for this check."),
    },
    handler: async (input, ctx) =>
      runComplianceCheck(ctx.credentials, {
        taskId: input.task_id,
        post: input.post_comment,
        overrides: input.override as Partial<ComplianceInput> | undefined,
      }),
  });

  reg.add({
    name: "workflow_compliance_preview",
    description:
      "Run the compliance engine against ad-hoc values without touching Kitchen. Use while drafting, before a deliverable exists.",
    readOnly: true,
    inputSchema: {
      deliverable_type: typeEnum,
      jurisdiction: jurisdictionEnum,
      region: z.string().optional(),
      platforms: z.array(platformEnum),
      paid: z.boolean(),
      electoral_matter: z.boolean(),
      authorisation_text: z.string().optional(),
      paying_entity: z.string().optional(),
      verified_platforms: z.array(platformEnum).optional(),
      special_category_declared: z.boolean().optional(),
      ai_generated_media: z.boolean().optional(),
      ai_disclosed: z.boolean().optional(),
      negative_claims: z
        .array(z.object({ claim: z.string(), evidence: z.array(z.string()).optional() }))
        .optional(),
      countries: z.array(z.string()).optional(),
      interests: z.array(z.string()).optional(),
      flight_start: z.string().optional(),
      flight_end: z.string().optional(),
      election_date: z.string().optional(),
      record_retained: z.boolean().optional(),
    },
    handler: async (i) =>
      evaluateCompliance({
        deliverableType: i.deliverable_type,
        jurisdiction: i.jurisdiction,
        region: i.region,
        platforms: i.platforms,
        paid: i.paid,
        electoralMatter: i.electoral_matter,
        authorisationText: i.authorisation_text ?? null,
        payingEntity: i.paying_entity ?? null,
        verifiedPlatforms: i.verified_platforms ?? [],
        specialCategoryDeclared: i.special_category_declared ?? false,
        aiGeneratedMedia: i.ai_generated_media ?? false,
        aiDisclosed: i.ai_disclosed ?? false,
        negativeClaims: i.negative_claims ?? [],
        targeting: { countries: i.countries, interests: i.interests },
        flightStart: i.flight_start,
        flightEnd: i.flight_end,
        electionDate: i.election_date,
        recordRetained: i.record_retained ?? false,
      }),
  });

  /* ---------------- approvals ---------------- */

  reg.add({
    name: "workflow_record_approval",
    description:
      "Record a client's explicit sign-off against a deliverable. Fixes who approved, which version, and what the approval covers (creative, placement, spend, dates). Required before a deliverable can reach 'approved'. Quote the client's actual words in quoted_from so the record is checkable.",
    inputSchema: {
      task_id: z.string(),
      approver: z.string().describe("Name of the person with authority to bind the client."),
      version: z.string().describe("Exact version approved, e.g. 'v3'."),
      scope: z
        .string()
        .describe("What the approval covers — creative only, or creative + placement + spend + flight dates."),
      conditions: z.string().optional().describe("Any conditions attached."),
      quoted_from: z
        .string()
        .optional()
        .describe("Where the approval came from and ideally the client's exact words."),
    },
    handler: async (input, ctx) =>
      recordApproval(ctx.credentials, {
        taskId: input.task_id,
        approver: input.approver,
        version: input.version,
        scope: input.scope,
        conditions: input.conditions,
        quotedFrom: input.quoted_from,
      }),
  });

  /* ---------------- board status ---------------- */

  reg.add({
    name: "workflow_board_status",
    description:
      "Portfolio view of a workflow board: how many deliverables sit in each state, what is overdue, what is waiting on the client, what is waiting on compliance, and what is blocked. Use for a standup or a client status update.",
    readOnly: true,
    inputSchema: { board_id: z.string() },
    handler: async ({ board_id }, ctx) => boardStatus(ctx.credentials, { boardId: board_id }),
  });
}
