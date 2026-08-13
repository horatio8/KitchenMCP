/**
 * Evidence register.
 *
 * Every negative or comparative claim in political creative needs a
 * source that someone can check. This module keeps that register on the
 * deliverable itself, so the claim and its backing travel together and
 * neither the compliance officer nor a journalist has to go looking.
 *
 * Design notes:
 *  - Stored as a second fenced block in the task description, because it
 *    is a mutable set rather than an append-only event. Gate passes are
 *    comments; the register is state.
 *  - An archived copy matters more than a link. Pages disappear, and the
 *    one that disappears is always the one you needed.
 *  - "Verified" means a named person checked the source says what the
 *    claim says. Attaching a URL is not verification.
 */

export const EVIDENCE_FENCE = "```evidence";
const FENCE_END = "```";

export type ClaimStatus = "unsourced" | "sourced" | "verified" | "withdrawn";

export interface EvidenceEntry {
  /** Short stable id, e.g. "E1". */
  id: string;
  /** The claim exactly as it will appear in the creative. */
  claim: string;
  /** Where it comes from — publication, document, date, page. */
  source?: string;
  /** Live URL. */
  url?: string;
  /** Archived copy — a web.archive.org URL or a Kitchen file id. */
  archived?: string;
  status: ClaimStatus;
  /** Who confirmed the source says what the claim says. */
  verifiedBy?: string;
  verifiedAt?: string;
  notes?: string;
}

const FIELD_ORDER: Array<keyof EvidenceEntry> = [
  "id",
  "claim",
  "source",
  "url",
  "archived",
  "status",
  "verifiedBy",
  "verifiedAt",
  "notes",
];

/** Serialise the register into its fenced block. */
export function renderEvidence(entries: EvidenceEntry[]): string {
  if (!entries.length) return "";
  const lines: string[] = [EVIDENCE_FENCE];
  for (const e of entries) {
    for (const key of FIELD_ORDER) {
      const v = e[key];
      if (v === undefined || v === null || v === "") continue;
      lines.push(`${key}: ${String(v).replace(/\n/g, " ")}`);
    }
    lines.push("--");
  }
  if (lines[lines.length - 1] === "--") lines.pop();
  lines.push(FENCE_END);
  return lines.join("\n");
}

/** Pull the register out of a description. */
export function parseEvidence(description: string | null | undefined): EvidenceEntry[] {
  if (!description) return [];
  const start = description.indexOf(EVIDENCE_FENCE);
  if (start < 0) return [];
  const rest = description.slice(start + EVIDENCE_FENCE.length);
  const end = rest.indexOf(FENCE_END);
  const body = end < 0 ? rest : rest.slice(0, end);

  const entries: EvidenceEntry[] = [];
  let current: Record<string, string> = {};
  const flush = () => {
    if (current.claim) {
      entries.push({
        id: current.id ?? `E${entries.length + 1}`,
        claim: current.claim,
        source: current.source,
        url: current.url,
        archived: current.archived,
        status: (current.status as ClaimStatus) ?? "unsourced",
        verifiedBy: current.verifiedBy,
        verifiedAt: current.verifiedAt,
        notes: current.notes,
      });
    }
    current = {};
  };

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "--") {
      flush();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value) current[key] = value;
  }
  flush();
  return entries;
}

/** Replace (or append) the evidence block in a description. */
export function upsertEvidence(
  description: string | null | undefined,
  entries: EvidenceEntry[],
): string {
  const body = stripEvidence(description);
  const block = renderEvidence(entries);
  if (!block) return body;
  return body ? `${body.trimEnd()}\n\n${block}` : block;
}

export function stripEvidence(description: string | null | undefined): string {
  if (!description) return "";
  const start = description.indexOf(EVIDENCE_FENCE);
  if (start < 0) return description;
  const rest = description.slice(start + EVIDENCE_FENCE.length);
  const end = rest.indexOf(FENCE_END);
  const after = end < 0 ? "" : rest.slice(end + FENCE_END.length);
  return (description.slice(0, start) + after).trim();
}

/** Next free id in the register. */
export function nextEvidenceId(entries: EvidenceEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = /^E(\d+)$/.exec(e.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `E${max + 1}`;
}

export interface EvidenceAudit {
  total: number;
  unsourced: EvidenceEntry[];
  sourcedNotVerified: EvidenceEntry[];
  verified: EvidenceEntry[];
  withdrawn: EvidenceEntry[];
  /** Sourced entries with a live URL but no archived copy. */
  noArchive: EvidenceEntry[];
  /** True when nothing blocks a compliance pass. */
  clean: boolean;
}

export function auditEvidence(entries: EvidenceEntry[]): EvidenceAudit {
  const live = entries.filter((e) => e.status !== "withdrawn");
  const unsourced = live.filter(
    (e) => e.status === "unsourced" || (!e.source && !e.url),
  );
  const verified = live.filter((e) => e.status === "verified");
  const sourcedNotVerified = live.filter(
    (e) => e.status === "sourced" && !unsourced.includes(e),
  );
  const noArchive = live.filter((e) => (e.url || e.source) && !e.archived);

  return {
    total: entries.length,
    unsourced,
    sourcedNotVerified,
    verified,
    withdrawn: entries.filter((e) => e.status === "withdrawn"),
    noArchive,
    clean: unsourced.length === 0,
  };
}

/** Human-readable register, suitable for posting as a comment. */
export function renderEvidenceReport(entries: EvidenceEntry[]): string {
  const a = auditEvidence(entries);
  const lines: string[] = ["**EVIDENCE-REGISTER**", ""];

  if (!entries.length) {
    lines.push(
      "No claims registered. If this deliverable makes no negative or comparative claim about anyone, that is correct — record that fact so the next reviewer does not have to guess.",
    );
    return lines.join("\n");
  }

  lines.push(
    `${a.total} claim(s): ${a.verified.length} verified, ${a.sourcedNotVerified.length} sourced but unverified, ` +
      `${a.unsourced.length} unsourced, ${a.withdrawn.length} withdrawn.`,
  );
  lines.push("");

  for (const e of entries) {
    const mark =
      e.status === "verified" ? "✓"
      : e.status === "sourced" ? "○"
      : e.status === "withdrawn" ? "—"
      : "✕";
    lines.push(`${mark} **${e.id}** ${e.claim}`);
    if (e.source) lines.push(`    Source: ${e.source}`);
    if (e.url) lines.push(`    URL: ${e.url}`);
    if (e.archived) lines.push(`    Archived: ${e.archived}`);
    else if (e.url) lines.push(`    Archived: — _no archived copy_`);
    if (e.verifiedBy) lines.push(`    Verified by ${e.verifiedBy}${e.verifiedAt ? ` on ${e.verifiedAt}` : ""}`);
    if (e.notes) lines.push(`    Note: ${e.notes}`);
    lines.push("");
  }

  if (a.unsourced.length) {
    lines.push(
      `⚠ ${a.unsourced.length} claim(s) have no source. These cannot ship. Attach a checkable source, ` +
        "downgrade the ad to a softer type, or withdraw the claim — never launder it into a question.",
    );
  }
  if (a.noArchive.length) {
    lines.push(
      `▲ ${a.noArchive.length} claim(s) cite a source with no archived copy. Archive them now; ` +
        "the page you need is always the one that disappears.",
    );
  }
  return lines.join("\n");
}
