/**
 * Deliverable workflow — core domain model.
 *
 * A "deliverable" is any discrete unit of work an agency produces for a
 * client: an ad set, a press release, a fundraising email, a video cut,
 * a policy doc, an event run-sheet. The lifecycle below is the same for
 * all of them; what changes per type is which gates are *mandatory*.
 */

/* ------------------------------------------------------------------ */
/* Workstreams — mirrors the agency's existing campaign taxonomy       */
/* ------------------------------------------------------------------ */

export const WORKSTREAMS = [
  "strategy",
  "comms",
  "paid-media",
  "fundraising",
  "data-research",
  "field",
  "volunteers",
  "candidate",
  "operations",
] as const;
export type Workstream = (typeof WORKSTREAMS)[number];

export const WORKSTREAM_LABELS: Record<Workstream, string> = {
  strategy: "Strategy & Management",
  comms: "Communications & Messaging",
  "paid-media": "Paid Media & Digital Advertising",
  fundraising: "Fundraising & Finance",
  "data-research": "Data, Research & Targeting",
  field: "Voter Contact / Field Operations",
  volunteers: "Volunteer Management",
  candidate: "Candidate Logistics",
  operations: "Operations, HR & Technology",
};

/* ------------------------------------------------------------------ */
/* Deliverable types — decides which gates are mandatory               */
/* ------------------------------------------------------------------ */

export const DELIVERABLE_TYPES = [
  "paid-ad",          // Meta/Google/X/Snap paid placement — full compliance gate
  "organic-social",   // unpaid post — authorisation may still apply
  "email",            // broadcast email to a list
  "sms",              // broadcast SMS
  "print",            // flyer, poster, DL, corflute
  "video",            // cut/edited video asset
  "press",            // media release, statement, op-ed
  "web",              // landing page, website change
  "event",            // rally, doorknock, fundraiser, webinar
  "research",         // polling, oppo, list build
  "strategy-doc",     // plan, memo, briefing
  "internal",         // agency-internal, no client sign-off
] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Lifecycle states                                                    */
/* ------------------------------------------------------------------ */

export const STATES = [
  "intake",
  "scoped",
  "in_production",
  "internal_review",
  "compliance_review",
  "client_review",
  "approved",
  "scheduled",
  "deployed",
  "verified",
  "archived",
  // side states
  "changes_requested",
  "blocked",
  "cancelled",
] as const;
export type State = (typeof STATES)[number];

export const TERMINAL_STATES: State[] = ["archived", "cancelled"];

/** Human-readable board column titles, in board order. */
export const STATE_COLUMN_TITLES: Record<State, string> = {
  intake: "1 · Intake",
  scoped: "2 · Scoped",
  in_production: "3 · In Production",
  internal_review: "4 · Internal Review",
  compliance_review: "5 · Compliance",
  client_review: "6 · Client Review",
  changes_requested: "7 · Changes Requested",
  approved: "8 · Approved",
  scheduled: "9 · Scheduled",
  deployed: "10 · Deployed",
  verified: "11 · Verified",
  blocked: "⛔ Blocked",
  cancelled: "✕ Cancelled",
  archived: "✓ Archived",
};

/** The order lists should be created on a Kitchen board. */
export const BOARD_COLUMN_ORDER: State[] = [
  "intake",
  "scoped",
  "in_production",
  "internal_review",
  "compliance_review",
  "client_review",
  "changes_requested",
  "approved",
  "scheduled",
  "deployed",
  "verified",
  "blocked",
  "archived",
];

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export const ROLES = [
  "requester",       // who asked for it (client or internal)
  "producer",        // who makes it
  "reviewer",        // internal QA
  "compliance",      // authorisation / regulatory officer
  "client_approver", // the person whose yes is binding
  "deployer",        // who pushes it live
] as const;
export type Role = (typeof ROLES)[number];

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

export type GateId =
  | "G1_scope"
  | "G2_production_ready"
  | "G3_internal_qa"
  | "G4_compliance"
  | "G5_client_signoff"
  | "G6_deploy"
  | "G7_verify";

export interface GateCheck {
  id: string;
  /** What the check asserts. Written so a human can verify it by eye. */
  assertion: string;
  /** If false, the gate cannot be passed (hard). If true, it only warns. */
  advisory?: boolean;
}

export interface Gate {
  id: GateId;
  title: string;
  /** Transition this gate guards: from → to. */
  from: State;
  to: State;
  /** Who signs this gate off. */
  owner: Role;
  /** Deliverable types for which this gate may be skipped entirely. */
  skipFor?: DeliverableType[];
  checks: GateCheck[];
}

export const GATES: Gate[] = [
  {
    id: "G1_scope",
    title: "Scope gate",
    from: "intake",
    to: "scoped",
    owner: "producer",
    checks: [
      { id: "brief", assertion: "A written brief exists and names the audience, message and the one action it should drive." },
      { id: "type", assertion: "Deliverable type and workstream are set." },
      { id: "due", assertion: "A due date exists and is achievable." },
      { id: "owner", assertion: "A named producer is assigned." },
      { id: "commercial", assertion: "Work is inside an accepted quote/retainer, or a quote has been raised.", advisory: true },
      { id: "jurisdiction", assertion: "Jurisdiction is recorded (decides the authorisation regime from minute one)." },
    ],
  },
  {
    id: "G2_production_ready",
    title: "Production-ready gate",
    from: "scoped",
    to: "in_production",
    owner: "producer",
    checks: [
      { id: "inputs", assertion: "All inputs are on hand: copy direction, assets, data, brand profile." },
      { id: "evidence", assertion: "Any factual/negative claim has a cited, checkable source attached." },
      { id: "accounts", assertion: "Destination accounts/pages exist and are accessible.", advisory: true },
    ],
  },
  {
    id: "G3_internal_qa",
    title: "Internal QA gate",
    from: "internal_review",
    to: "compliance_review",
    owner: "reviewer",
    checks: [
      { id: "brief_met", assertion: "Output answers the brief — message, audience, action." },
      { id: "spec", assertion: "Platform spec met: character counts counted (not estimated), aspect ratios, file types, durations." },
      { id: "brand", assertion: "Brand profile respected: palette, type hierarchy, logo treatment." },
      { id: "proof", assertion: "Copy proofread; names, dates, times, venues and URLs verified against source." },
      { id: "links", assertion: "Every link resolves and carries correct tracking parameters." },
      { id: "reviewer_not_producer", assertion: "Reviewer is not the same person as the producer." },
    ],
  },
  {
    id: "G4_compliance",
    title: "Compliance gate",
    from: "compliance_review",
    to: "client_review",
    owner: "compliance",
    skipFor: ["internal", "research", "strategy-doc"],
    checks: [
      { id: "authorisation", assertion: "Authorisation / disclaimer / promoter statement present, correct and prominent for the jurisdiction." },
      { id: "paying_entity", assertion: "Paying entity confirmed and matches the platform-verified funding entity." },
      { id: "platform_allowed", assertion: "Political advertising is permitted on every destination platform." },
      { id: "verification", assertion: "Advertiser verification / political authorisation is complete on each platform." },
      { id: "special_category", assertion: "Special ad category declared where the platform requires it." },
      { id: "evidence_refs", assertion: "Every negative or comparative claim carries an evidence reference." },
      { id: "ai_disclosure", assertion: "AI-generated or AI-altered media depicting real people/places/events is disclosed." },
      { id: "targeting", assertion: "Targeting is legal for the category and geographically fits the district." },
      { id: "timing", assertion: "Flight dates clear any blackout, freeze or pre-poll restriction." },
      { id: "record", assertion: "A copy of the final creative is retained for the statutory record-keeping period." },
    ],
  },
  {
    id: "G5_client_signoff",
    title: "Client sign-off gate",
    from: "client_review",
    to: "approved",
    owner: "client_approver",
    skipFor: ["internal"],
    checks: [
      { id: "named_approver", assertion: "The approver is the person with authority to bind the client." },
      { id: "explicit", assertion: "Approval is explicit and in writing — not inferred from silence." },
      { id: "version", assertion: "The approval names the exact version being approved." },
      { id: "scope", assertion: "Approval covers placement, spend and flight dates, not just creative." },
      { id: "conditions", assertion: "Any conditions attached to the approval are recorded and actioned." },
    ],
  },
  {
    id: "G6_deploy",
    title: "Deployment gate",
    from: "approved",
    to: "deployed",
    owner: "deployer",
    checks: [
      { id: "matches_approved", assertion: "What is being deployed is byte-identical to what was approved." },
      { id: "media_real", assertion: "Media is a real hosted file the platform can fetch — not a share link or preview page." },
      { id: "budget", assertion: "Budget, bid strategy and schedule match the approved spend." },
      { id: "tracking", assertion: "Pixel/conversion tracking is live and firing." },
      { id: "rollback", assertion: "A named person can pause or pull this within minutes if needed." },
    ],
  },
  {
    id: "G7_verify",
    title: "Post-deployment verification",
    from: "deployed",
    to: "verified",
    owner: "deployer",
    checks: [
      { id: "live_check", assertion: "Asset confirmed live and rendering correctly on each destination." },
      { id: "disclaimer_visible", assertion: "Authorisation/disclaimer is visible on the live placement." },
      { id: "delivery", assertion: "Delivery has begun — impressions/sends registering as expected." },
      { id: "archive_copy", assertion: "Live screenshot/permalink captured into the deliverable record." },
    ],
  },
];

export function gateFor(from: State, to: State): Gate | undefined {
  return GATES.find((g) => g.from === from && g.to === to);
}

export function gateById(id: GateId): Gate | undefined {
  return GATES.find((g) => g.id === id);
}

/** Gates that are mandatory for a given deliverable type. */
export function requiredGates(type: DeliverableType): Gate[] {
  return GATES.filter((g) => !g.skipFor?.includes(type));
}
