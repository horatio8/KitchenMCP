import {
  GATES,
  TERMINAL_STATES,
  gateFor,
  type DeliverableType,
  type Gate,
  type State,
} from "./types.js";

/**
 * The deliverable state machine.
 *
 * Design rules:
 *  - Forward motion through the happy path is gated. Every forward edge
 *    that has a Gate must record a signed gate pass.
 *  - Backward motion (rework) is always allowed and never gated — you
 *    can always send something back. Rework is cheap; a bad approval is
 *    not.
 *  - `blocked` and `cancelled` are reachable from anywhere live.
 *  - `changes_requested` is the rework hub. It remembers where it came
 *    from so the item resumes at the right place.
 */

export interface Transition {
  from: State;
  to: State;
  /** Forward path edges carry a gate; rework edges do not. */
  gate?: Gate["id"];
  kind: "forward" | "rework" | "exception" | "close";
  description: string;
}

const forward = (from: State, to: State, description: string): Transition => ({
  from,
  to,
  gate: gateFor(from, to)?.id,
  kind: "forward",
  description,
});

export const TRANSITIONS: Transition[] = [
  // ---- happy path -------------------------------------------------
  forward("intake", "scoped", "Brief accepted and scoped."),
  forward("scoped", "in_production", "Inputs complete; production started."),
  {
    from: "in_production",
    to: "internal_review",
    kind: "forward",
    description: "Producer submits for internal QA.",
  },
  forward("internal_review", "compliance_review", "Internal QA passed."),
  forward("compliance_review", "client_review", "Compliance cleared; sent to client."),
  forward("client_review", "approved", "Client signed off."),
  {
    from: "approved",
    to: "scheduled",
    kind: "forward",
    description: "Booked into the calendar/queue ahead of its flight date.",
  },
  forward("approved", "deployed", "Pushed live."),
  {
    from: "scheduled",
    to: "deployed",
    gate: "G6_deploy",
    kind: "forward",
    description: "Scheduled item went live.",
  },
  forward("deployed", "verified", "Confirmed live and delivering."),
  {
    from: "verified",
    to: "archived",
    kind: "close",
    description: "Record closed and retained.",
  },

  // ---- rework ------------------------------------------------------
  {
    from: "internal_review",
    to: "changes_requested",
    kind: "rework",
    description: "Internal QA found issues.",
  },
  {
    from: "compliance_review",
    to: "changes_requested",
    kind: "rework",
    description: "Compliance found issues.",
  },
  {
    from: "client_review",
    to: "changes_requested",
    kind: "rework",
    description: "Client requested changes.",
  },
  {
    from: "changes_requested",
    to: "in_production",
    kind: "rework",
    description: "Producer picks the rework back up.",
  },
  {
    from: "approved",
    to: "changes_requested",
    kind: "rework",
    description: "Approval withdrawn before deployment.",
  },
  {
    from: "scheduled",
    to: "changes_requested",
    kind: "rework",
    description: "Pulled from the queue before going live.",
  },
  {
    from: "deployed",
    to: "changes_requested",
    kind: "rework",
    description: "Pulled down after going live — treat as an incident.",
  },

  // ---- exceptions --------------------------------------------------
  ...(
    [
      "intake",
      "scoped",
      "in_production",
      "internal_review",
      "compliance_review",
      "client_review",
      "changes_requested",
      "approved",
      "scheduled",
    ] as State[]
  ).map<Transition>((s) => ({
    from: s,
    to: "blocked",
    kind: "exception",
    description: "Blocked on an external dependency.",
  })),
  ...(
    [
      "intake",
      "scoped",
      "in_production",
      "internal_review",
      "compliance_review",
      "client_review",
      "changes_requested",
      "approved",
      "scheduled",
      "blocked",
    ] as State[]
  ).map<Transition>((s) => ({
    from: s,
    to: "cancelled",
    kind: "close",
    description: "Work stopped; will not ship.",
  })),
  // Unblocking returns to production by default; callers may override.
  {
    from: "blocked",
    to: "in_production",
    kind: "rework",
    description: "Dependency cleared; work resumes.",
  },
];

export function allowedTransitions(from: State): Transition[] {
  return TRANSITIONS.filter((t) => t.from === from);
}

export function findTransition(from: State, to: State): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function isTerminal(state: State): boolean {
  return TERMINAL_STATES.includes(state);
}

export interface TransitionCheck {
  allowed: boolean;
  transition?: Transition;
  gate?: Gate;
  /** True when the gate may be skipped for this deliverable type. */
  gateSkippable: boolean;
  reason?: string;
}

/**
 * Can this deliverable move from → to? Returns the gate that must be
 * satisfied, if any. Does not itself verify the gate was signed — that
 * is the caller's job (see approvals.ts), because gate evidence lives
 * in Kitchen, not in memory.
 */
export function checkTransition(
  from: State,
  to: State,
  type: DeliverableType,
): TransitionCheck {
  if (from === to) {
    return { allowed: false, gateSkippable: false, reason: "already_in_state" };
  }
  const transition = findTransition(from, to);
  if (!transition) {
    const options = allowedTransitions(from).map((t) => t.to);
    return {
      allowed: false,
      gateSkippable: false,
      reason: options.length
        ? `illegal_transition: ${from} → ${to}. Allowed from ${from}: ${options.join(", ")}`
        : `illegal_transition: ${from} is terminal`,
    };
  }
  const gate = transition.gate
    ? GATES.find((g) => g.id === transition.gate)
    : undefined;
  const gateSkippable = Boolean(gate?.skipFor?.includes(type));
  return { allowed: true, transition, gate, gateSkippable };
}

/**
 * The ordered happy path for a deliverable type, with skippable gates
 * removed. Useful for rendering "what's left" on a deliverable.
 */
export function happyPath(type: DeliverableType): State[] {
  const path: State[] = [
    "intake",
    "scoped",
    "in_production",
    "internal_review",
    "compliance_review",
    "client_review",
    "approved",
    "deployed",
    "verified",
    "archived",
  ];
  return path.filter((s) => {
    if (s === "compliance_review") {
      return !GATES.find((g) => g.id === "G4_compliance")?.skipFor?.includes(type);
    }
    if (s === "client_review") {
      return !GATES.find((g) => g.id === "G5_client_signoff")?.skipFor?.includes(type);
    }
    return true;
  });
}
