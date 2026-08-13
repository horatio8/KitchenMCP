/**
 * Compliance rules engine for political deliverables.
 *
 * Encodes the authorisation regimes for AU / US / NZ and the platform
 * permission matrix, and renders a structured report.
 *
 * MANDATE: warn-loudly, never silently block. The report carries a
 * verdict; the human decides what ships. A BLOCKED verdict means "this
 * will be taken down or rejected", not "the tool refused".
 *
 * This is operational guidance encoded as software, not legal advice.
 * Jurisdiction-specific filing questions go to counsel.
 */

import { analyseAuthorisationAddress, auRegime } from "./au-states.js";
import type { DeliverableType } from "./types.js";

export const JURISDICTIONS = ["AU", "US", "NZ"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const PLATFORMS = [
  "meta",
  "google",
  "youtube",
  "x",
  "tiktok",
  "snapchat",
  "linkedin",
  "email",
  "sms",
  "print",
  "web",
  "radio",
  "tv",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export type Severity = "blocker" | "warning" | "info";
export type Verdict = "READY" | "READY_WITH_WARNINGS" | "LIKELY_REJECTED";

export interface Finding {
  code: string;
  severity: Severity;
  area: "authorisation" | "platform" | "creative" | "targeting" | "timing" | "record";
  message: string;
  remedy?: string;
}

/* ------------------------------------------------------------------ */
/* Platform permission matrix                                          */
/* ------------------------------------------------------------------ */

interface PlatformRule {
  /** Can paid political/electoral advertising run at all? */
  paidPolitical: "allowed" | "banned" | "conditional";
  /** Does the advertiser need platform-level verification first? */
  requiresVerification: boolean;
  /** Notes surfaced in the report. */
  note?: string;
  /** Jurisdictions where paid political is specifically unavailable. */
  bannedIn?: Jurisdiction[];
}

const PLATFORM_RULES: Record<Platform, PlatformRule> = {
  meta: {
    paidPolitical: "allowed",
    requiresVerification: true,
    note: "Page must pass political-advertiser authorisation before the first ad. Ads retained in the public Ad Library for 7 years.",
  },
  google: {
    paidPolitical: "allowed",
    requiresVerification: true,
    note: "Account-level election-ads verification. Targeting capped at age, gender and general location.",
  },
  youtube: {
    paidPolitical: "allowed",
    requiresVerification: true,
    note: "Inherits Google election-ads verification.",
  },
  x: {
    paidPolitical: "allowed",
    requiresVerification: true,
    note: "Verification regime; geo-restricted to jurisdictions where the advertiser is registered.",
  },
  tiktok: {
    paidPolitical: "banned",
    requiresVerification: false,
    note: "Paid political advertising is banned globally. Organic only — and paid creator content pushing electoral matter is also prohibited.",
  },
  snapchat: {
    paidPolitical: "conditional",
    requiresVerification: true,
    note: "Permitted with intake/review. Useful under-35 GOTV reach.",
  },
  linkedin: {
    paidPolitical: "banned",
    requiresVerification: false,
    note: "Political advertising is not permitted.",
  },
  email: { paidPolitical: "allowed", requiresVerification: false },
  sms: {
    paidPolitical: "allowed",
    requiresVerification: false,
    note: "Carrier and spam rules apply on top of electoral law; ensure consent basis is documented.",
  },
  print: { paidPolitical: "allowed", requiresVerification: false },
  web: { paidPolitical: "allowed", requiresVerification: false },
  radio: { paidPolitical: "allowed", requiresVerification: false },
  tv: { paidPolitical: "allowed", requiresVerification: false },
};

/* ------------------------------------------------------------------ */
/* Authorisation regimes                                               */
/* ------------------------------------------------------------------ */

export interface AuthorisationSpec {
  /** What the statement is called in this jurisdiction. */
  term: string;
  /** Canonical form to render. */
  template: string;
  /** Which particulars must appear. */
  particulars: string[];
  guidance: string;
}

export const AUTHORISATION: Record<Jurisdiction, AuthorisationSpec> = {
  AU: {
    term: "authorisation statement",
    template: "Authorised by {name}, {entity}, {town}",
    particulars: [
      "name of the authorising person or entity",
      "for an entity: the town or city in which it is based",
      "for a natural person on printed matter (flyers, posters, stickers): full street address",
      "for a natural person on other communications: name plus town or city",
    ],
    guidance:
      "Required where electoral matter is communicated as paid advertising, or by/on behalf of a disclosure entity. " +
      "Must be prominent, legible and easily found. Paid creator/influencer content carrying electoral matter must also be authorised. " +
      "State elections carry their own electoral-commission rules on top — check the relevant state commission at intake.",
  },
  US: {
    term: "disclaimer",
    template: "Paid for by {entity}",
    particulars: [
      "the entity paying for the communication",
      "committee ID where state law requires it",
    ],
    guidance:
      "Every paid electoral communication carries a 'Paid for by' disclaimer. The disclaimer must match the platform-verified funding entity — " +
      "if running for a client, it names the client's committee, not the agency. FEC and state disclosure rules layer on top and vary by state.",
  },
  NZ: {
    term: "promoter statement",
    template: "Promoted by {name}, {address}",
    particulars: ["promoter's name", "promoter's contact address"],
    guidance:
      "All election advertisements require a promoter statement at all times, not only during the regulated period. " +
      "For paid social, the statement goes in the ad itself. Must be clearly displayed — statements that are too small draw complaints. " +
      "Running without one risks a fine up to NZ$40,000.",
  },
};

/** Statutory/practical retention period for the creative record. */
export const RECORD_RETENTION: Record<Jurisdiction, string> = {
  AU: "Retain final creative, authorisation and placement record for at least 3 years (align with disclosure-return cycles).",
  US: "Meta retains political ads in the Ad Library for 7 years; retain your own copy for at least the same period.",
  NZ: "Retain for the statutory record period covering the regulated period and any subsequent complaint window.",
};

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface ComplianceInput {
  deliverableType: DeliverableType;
  jurisdiction: Jurisdiction;
  /** Sub-jurisdiction, e.g. "SA" for a South Australian state election. */
  region?: string;
  platforms: Platform[];
  /** Is this a paid placement? Drives whether authorisation is mandatory. */
  paid: boolean;
  /** Is this electoral matter (intended to influence a vote)? */
  electoralMatter: boolean;

  /** The authorisation/disclaimer string as it will actually appear. */
  authorisationText?: string | null;
  /** Legal entity paying. */
  payingEntity?: string | null;
  /** Platforms on which advertiser verification is confirmed complete. */
  verifiedPlatforms?: Platform[];
  /** Has the special ad category been declared where required? */
  specialCategoryDeclared?: boolean;

  /** Claims that are negative/comparative about an opponent. */
  negativeClaims?: Array<{ claim: string; evidence?: string[] }>;
  /** Does the creative contain AI-generated/altered depiction of real people/places/events? */
  aiGeneratedMedia?: boolean;
  aiDisclosed?: boolean;

  /** Targeting summary. */
  targeting?: {
    countries?: string[];
    interests?: string[];
    ageMin?: number;
    ageMax?: number;
  };

  /** Flight window. */
  flightStart?: string;
  flightEnd?: string;
  /** Election day, ISO date — drives blackout/freeze checks. */
  electionDate?: string;
  /** Has a copy of the final creative been retained? */
  recordRetained?: boolean;
}

export interface ComplianceReport {
  verdict: Verdict;
  jurisdiction: Jurisdiction;
  authorisationSpec: AuthorisationSpec;
  findings: Finding[];
  /** Convenience counts. */
  summary: { blockers: number; warnings: number; info: number };
  /** Rendered text report, ready to post as a Kitchen comment. */
  text: string;
  checkedAt: string;
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

const EU_COUNTRIES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT",
  "LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
]);

export function evaluateCompliance(input: ComplianceInput): ComplianceReport {
  const f: Finding[] = [];
  const spec = AUTHORISATION[input.jurisdiction];
  const verified = new Set(input.verifiedPlatforms ?? []);

  /* -------- authorisation ---------------------------------------- */
  const authorisationRequired =
    input.electoralMatter && (input.paid || input.deliverableType !== "internal");

  if (authorisationRequired) {
    const text = (input.authorisationText ?? "").trim();
    if (!text) {
      f.push({
        code: "AUTH_MISSING",
        severity: "blocker",
        area: "authorisation",
        message: `No ${spec.term} supplied. This is electoral matter and one is required.`,
        remedy: `Add: "${spec.template}". ${spec.guidance}`,
      });
    } else if (/\{[a-z_]+\}|\[.*REQUIRED.*\]|TBC|TBD|XXX/i.test(text)) {
      f.push({
        code: "AUTH_PLACEHOLDER",
        severity: "blocker",
        area: "authorisation",
        message: `The ${spec.term} still contains a placeholder: "${text}".`,
        remedy: "Replace with the real authorising person/entity before this ships. Never invent one.",
      });
    } else {
      const expectedLead =
        input.jurisdiction === "AU" ? /^authoris(ed|ed by)/i
          : input.jurisdiction === "US" ? /^paid for by/i
          : /^(promoted|authorised) by/i;
      if (!expectedLead.test(text)) {
        f.push({
          code: "AUTH_FORM",
          severity: "warning",
          area: "authorisation",
          message: `The ${spec.term} does not open with the expected wording for ${input.jurisdiction}.`,
          remedy: `Expected form: "${spec.template}".`,
        });
      }
      if (text.length < 12) {
        f.push({
          code: "AUTH_THIN",
          severity: "warning",
          area: "authorisation",
          message: `The ${spec.term} looks too short to carry the required particulars.`,
          remedy: `Must include: ${spec.particulars.join("; ")}.`,
        });
      }
    }

    if (!input.payingEntity?.trim()) {
      f.push({
        code: "PAYER_MISSING",
        severity: input.paid ? "blocker" : "warning",
        area: "authorisation",
        message: "No paying entity recorded.",
        remedy:
          "Confirm the legal entity funding this and make sure it matches the platform-verified funding entity. " +
          "For client work the disclaimer names the client's entity, not the agency.",
      });
    }
  }

  /* -------- AU state / territory overlay -------------------------- */
  if (input.jurisdiction === "AU" && input.region) {
    const regime = auRegime(input.region);
    if (!regime) {
      f.push({
        code: "AU_REGION_UNKNOWN",
        severity: "warning",
        area: "authorisation",
        message: `Region "${input.region}" is not a recognised Australian state or territory.`,
        remedy: "Use one of SA, NSW, VIC, QLD, WA, TAS, ACT, NT — or clear the field if this is a federal campaign.",
      });
    } else {
      f.push({
        code: "AU_STATE_REGIME",
        severity: "info",
        area: "authorisation",
        message:
          `${regime.region}: ${regime.act}, administered by ${regime.commission} (${regime.commissionAbbrev}). ` +
          regime.notes.join(" "),
        remedy: regime.penalty ? `Penalty: ${regime.penalty}.` : undefined,
      });

      if (!regime.verified) {
        f.push({
          code: "AU_STATE_UNVERIFIED",
          severity: "warning",
          area: "authorisation",
          message: `${regime.region} authorisation details are not verified in this engine.`,
          remedy: `Confirm the current requirements with ${regime.commissionAbbrev} before publishing. Do not assume the Commonwealth form is sufficient.`,
        });
      }

      // Concrete, mechanically checkable address-form rules.
      if (authorisationRequired && input.authorisationText?.trim()) {
        const addr = analyseAuthorisationAddress(input.authorisationText);

        if (regime.poBox === "prohibited" && addr.hasPoBox) {
          f.push({
            code: "AU_STATE_POBOX",
            severity: "blocker",
            area: "authorisation",
            message: `${regime.region} does not accept a PO Box in an authorisation, and this one contains a postal box.`,
            remedy:
              regime.region === "SA"
                ? "Use a street address. An independent candidate may use a PO Box only with the Electoral Commissioner's approval, and must add their suburb at the end of the ad."
                : "Use a street address.",
          });
        }

        if (regime.poBox === "allowed" && addr.hasEmail) {
          f.push({
            code: "AU_STATE_EMAIL_ADDRESS",
            severity: "blocker",
            area: "authorisation",
            message: `${regime.region} does not accept an email address as the authorisation address.`,
            remedy: "Use a street address or a PO Box.",
          });
        }

        if (
          regime.poBox === "prohibited" &&
          !addr.hasPoBox &&
          !addr.looksLikeStreetAddress
        ) {
          f.push({
            code: "AU_STATE_ADDRESS_THIN",
            severity: "warning",
            area: "authorisation",
            message:
              `${regime.region} requires a street address in the authorisation, and this one does not appear to contain one. ` +
              "A town or city alone — which satisfies the Commonwealth regime for an entity — is not enough here.",
            remedy: `Required particulars: ${regime.extraParticulars.join("; ")}.`,
          });
        }

        if (regime.poBox === "unverified" && !addr.looksLikeStreetAddress) {
          f.push({
            code: "AU_STATE_ADDRESS_CHECK",
            severity: "warning",
            area: "authorisation",
            message: `${regime.region}: the acceptable address form is not verified in this engine and the authorisation carries no street address.`,
            remedy: `Confirm with ${regime.commissionAbbrev} whether a PO Box or town/city is acceptable.`,
          });
        }
      }

      if (regime.alwaysOn && !input.electoralMatter) {
        f.push({
          code: "AU_STATE_ALWAYS_ON",
          severity: "info",
          area: "authorisation",
          message: `${regime.region} requires authorisation of electoral material outside the election period too, not only during a campaign.`,
        });
      }
    }
  }

  /* -------- platform --------------------------------------------- */
  for (const p of input.platforms) {
    const rule = PLATFORM_RULES[p];
    if (!rule) continue;

    if (input.paid && input.electoralMatter) {
      if (rule.paidPolitical === "banned") {
        f.push({
          code: `PLATFORM_BANNED_${p.toUpperCase()}`,
          severity: "blocker",
          area: "platform",
          message: `${p}: paid political advertising is not permitted. ${rule.note ?? ""}`.trim(),
          remedy: `Drop ${p} from the paid plan, or run organic only.`,
        });
      } else if (rule.paidPolitical === "conditional") {
        f.push({
          code: `PLATFORM_CONDITIONAL_${p.toUpperCase()}`,
          severity: "warning",
          area: "platform",
          message: `${p}: political advertising is conditional. ${rule.note ?? ""}`.trim(),
        });
      }

      if (rule.requiresVerification && !verified.has(p)) {
        f.push({
          code: `VERIFY_${p.toUpperCase()}`,
          severity: "blocker",
          area: "platform",
          message: `${p}: advertiser verification / political authorisation is not confirmed.`,
          remedy:
            "Verification queues take days and gate launch, not drafting. Start it now if it isn't already running. " +
            (rule.note ?? ""),
        });
      }
    }
  }

  if (input.paid && input.electoralMatter && !input.specialCategoryDeclared) {
    if (input.platforms.includes("meta")) {
      f.push({
        code: "SPECIAL_CATEGORY",
        severity: "blocker",
        area: "targeting",
        message:
          "Meta special ad category ISSUES_ELECTIONS_POLITICS has not been declared.",
        remedy:
          "Declare it. Note it disables detailed interest targeting and narrows age/geo controls — the media plan must adapt.",
      });
    }
  }

  /* -------- creative ---------------------------------------------- */
  for (const c of input.negativeClaims ?? []) {
    if (!c.evidence?.length) {
      f.push({
        code: "CLAIM_UNSOURCED",
        severity: "blocker",
        area: "creative",
        message: `Negative/comparative claim has no evidence reference: "${c.claim}".`,
        remedy:
          "Attach a checkable source, or downgrade the ad to a softer type. Never launder an unbacked claim into a question.",
      });
    }
  }

  if (input.aiGeneratedMedia && !input.aiDisclosed) {
    f.push({
      code: "AI_UNDISCLOSED",
      severity: "blocker",
      area: "creative",
      message:
        "Creative contains AI-generated or AI-altered media depicting real people, places or events, and is not disclosed.",
      remedy:
        "Disclose it. Platforms auto-detect and label AI media anyway — an undisclosed-then-labelled ad is a gift to the opponent.",
    });
  }

  /* -------- targeting --------------------------------------------- */
  const countries = input.targeting?.countries ?? [];
  if (countries.some((c) => EU_COUNTRIES.has(c.toUpperCase()))) {
    f.push({
      code: "DSA_FIELDS",
      severity: "warning",
      area: "targeting",
      message:
        "Targeting includes EU countries — the Digital Services Act requires dsa_beneficiary and dsa_payor on the ad.",
      remedy: "Supply both fields before issuing.",
    });
  }
  if (
    input.paid &&
    !countries.length &&
    input.platforms.some((p) => ["meta", "google", "x", "snapchat"].includes(p))
  ) {
    f.push({
      code: "TARGET_OPEN",
      severity: "warning",
      area: "targeting",
      message: "No country targeting specified — the buy is open-ended.",
      remedy: "Constrain geography to the district. Money outside the electorate is money burned.",
    });
  }
  if (
    input.electoralMatter &&
    input.paid &&
    (input.targeting?.interests?.length ?? 0) > 0 &&
    input.platforms.includes("meta")
  ) {
    f.push({
      code: "INTEREST_TARGETING",
      severity: "warning",
      area: "targeting",
      message:
        "Interest targeting is specified, but the political special ad category disables detailed interest targeting on Meta.",
      remedy: "Rebuild the audience on geography, age, gender, custom and lookalike audiences.",
    });
  }

  /* -------- timing ------------------------------------------------- */
  if (input.electionDate && input.flightStart) {
    const election = Date.parse(input.electionDate);
    const start = Date.parse(input.flightStart);
    if (!Number.isNaN(election) && !Number.isNaN(start)) {
      const daysBefore = Math.floor((election - start) / 86_400_000);
      if (input.jurisdiction === "US" && daysBefore <= 7 && daysBefore >= 0) {
        f.push({
          code: "US_FINAL_WEEK_FREEZE",
          severity: "blocker",
          area: "timing",
          message: `Flight starts ${daysBefore} day(s) before election day, inside the US final-week political ad freeze.`,
          remedy:
            "New political ads are blocked in the final week; only ads with at least one prior impression keep serving. Pre-load closing creative before the window opens.",
        });
      }
      if (daysBefore < 0) {
        f.push({
          code: "FLIGHT_AFTER_ELECTION",
          severity: "warning",
          area: "timing",
          message: "Flight starts after election day.",
          remedy: "Confirm this is deliberate (e.g. thank-you or recount messaging).",
        });
      }
      if (input.jurisdiction === "AU" && daysBefore <= 3 && daysBefore >= 0) {
        f.push({
          code: "AU_BLACKOUT",
          severity: "warning",
          area: "timing",
          message:
            "Flight starts inside the final days before an Australian election — the broadcast blackout applies to radio/TV from the Wednesday midnight before polling day.",
          remedy: "Digital is not covered by the broadcast blackout, but confirm any radio/TV element stops in time.",
        });
      }
    }
  }
  if (input.flightStart && input.flightEnd) {
    if (Date.parse(input.flightEnd) < Date.parse(input.flightStart)) {
      f.push({
        code: "FLIGHT_INVERTED",
        severity: "blocker",
        area: "timing",
        message: "Flight end date is before the start date.",
      });
    }
  }

  /* -------- record keeping ----------------------------------------- */
  if (authorisationRequired && !input.recordRetained) {
    f.push({
      code: "RECORD_NOT_RETAINED",
      severity: "warning",
      area: "record",
      message: "No retained copy of the final creative is recorded against this deliverable.",
      remedy: RECORD_RETENTION[input.jurisdiction],
    });
  }

  /* -------- verdict ------------------------------------------------ */
  const blockers = f.filter((x) => x.severity === "blocker").length;
  const warnings = f.filter((x) => x.severity === "warning").length;
  const info = f.filter((x) => x.severity === "info").length;
  const verdict: Verdict =
    blockers > 0 ? "LIKELY_REJECTED" : warnings > 0 ? "READY_WITH_WARNINGS" : "READY";

  const report: ComplianceReport = {
    verdict,
    jurisdiction: input.jurisdiction,
    authorisationSpec: spec,
    findings: f,
    summary: { blockers, warnings, info },
    text: "",
    checkedAt: new Date().toISOString(),
  };
  report.text = renderReport(input, report);
  return report;
}

const SEV_MARK: Record<Severity, string> = {
  blocker: "✕ BLOCKER",
  warning: "▲ WARNING",
  info: "· info",
};

export function renderReport(
  input: ComplianceInput,
  report: ComplianceReport,
): string {
  const lines: string[] = [];
  lines.push(`**Compliance check — ${report.verdict.replace(/_/g, " ")}**`);
  lines.push("");
  lines.push(
    `Jurisdiction ${input.jurisdiction}${input.region ? ` (${input.region})` : ""} · ` +
      `${input.paid ? "paid" : "organic"} · ` +
      `${input.electoralMatter ? "electoral matter" : "not electoral matter"} · ` +
      `platforms: ${input.platforms.join(", ") || "none"}`,
  );
  lines.push(
    `${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s), ${report.summary.info} note(s).`,
  );
  lines.push("");

  if (!report.findings.length) {
    lines.push("No findings. All encoded checks pass.");
  } else {
    const order: Severity[] = ["blocker", "warning", "info"];
    for (const sev of order) {
      const group = report.findings.filter((x) => x.severity === sev);
      if (!group.length) continue;
      for (const finding of group) {
        lines.push(`${SEV_MARK[sev]} [${finding.area}] ${finding.message}`);
        if (finding.remedy) lines.push(`    → ${finding.remedy}`);
      }
      lines.push("");
    }
  }

  lines.push("---");
  // Show the form that actually applies. Printing the Commonwealth
  // template under a state-election report would send the reader back
  // into the exact mistake the findings just flagged.
  const stateRegime =
    input.jurisdiction === "AU" ? auRegime(input.region) : undefined;
  if (stateRegime) {
    const addressForm =
      stateRegime.poBox === "prohibited"
        ? "street address (no PO Box)"
        : stateRegime.poBox === "allowed"
          ? "street address or PO Box (never an email address)"
          : "address form unverified — confirm with the commission";
    lines.push(
      `Required for ${stateRegime.region} (${stateRegime.act}): name + ${addressForm}.`,
    );
    if (stateRegime.extraParticulars.length > 1) {
      lines.push(`Particulars: ${stateRegime.extraParticulars.join("; ")}.`);
    }
    lines.push(
      `Commonwealth form, for reference: \`${report.authorisationSpec.template}\` — not sufficient on its own for a ${stateRegime.region} election.`,
    );
  } else {
    lines.push(
      `Required ${report.authorisationSpec.term}: \`${report.authorisationSpec.template}\``,
    );
  }
  lines.push(`Checked ${report.checkedAt}. Operational guidance, not legal advice.`);
  return lines.join("\n");
}

export function platformRule(p: Platform): PlatformRule | undefined {
  return PLATFORM_RULES[p];
}

export function platformMatrix(): Array<{ platform: Platform } & PlatformRule> {
  return (Object.keys(PLATFORM_RULES) as Platform[]).map((p) => ({
    platform: p,
    ...PLATFORM_RULES[p],
  }));
}
