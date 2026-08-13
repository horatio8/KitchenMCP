/**
 * Offline test of the workflow logic — state machine, metadata codec and
 * compliance engine. No network, no Kitchen. Run: node scripts/test-workflow.mjs
 */
import { checkTransition, happyPath, allowedTransitions } from "../dist/workflow/states.js";
import { evaluateCompliance } from "../dist/workflow/compliance.js";
import {
  parseMeta, renderMeta, upsertMeta, stripMeta, mergeMeta,
  stateForList, buildStateIndex, hasGatePass, renderGatePass, extractGateId,
} from "../dist/workflow/kitchen-map.js";

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const eq = (a, b, m) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${m ?? ""} expected ${B} got ${A}`);
};
const ok = (c, m) => { if (!c) throw new Error(m ?? "expected truthy"); };

console.log("\n== state machine ==");
t("legal forward move is allowed and reports its gate", () => {
  const r = checkTransition("internal_review", "compliance_review", "paid-ad");
  ok(r.allowed); eq(r.gate.id, "G3_internal_qa");
});
t("illegal skip is refused with the legal options listed", () => {
  const r = checkTransition("intake", "deployed", "paid-ad");
  ok(!r.allowed); ok(r.reason.includes("illegal_transition"));
  ok(r.reason.includes("scoped"), "should list legal targets");
});
t("rework is always allowed and ungated", () => {
  const r = checkTransition("client_review", "changes_requested", "paid-ad");
  ok(r.allowed); ok(!r.gate);
});
t("compliance gate is skippable for internal work", () => {
  const r = checkTransition("compliance_review", "client_review", "internal");
  ok(r.allowed); ok(r.gateSkippable, "G4 should be skippable for internal");
});
t("compliance gate is NOT skippable for a paid ad", () => {
  const r = checkTransition("compliance_review", "client_review", "paid-ad");
  ok(r.allowed); ok(!r.gateSkippable);
});
t("same-state move refused", () => {
  ok(!checkTransition("scoped", "scoped", "paid-ad").allowed);
});
t("archived is terminal", () => {
  eq(allowedTransitions("archived").length, 0);
});
t("happy path drops client review for internal deliverables", () => {
  ok(!happyPath("internal").includes("client_review"));
  ok(happyPath("paid-ad").includes("client_review"));
});
t("blocked reachable from live states, not from archived", () => {
  ok(checkTransition("in_production", "blocked", "paid-ad").allowed);
  ok(!checkTransition("archived", "blocked", "paid-ad").allowed);
});

console.log("\n== metadata codec ==");
t("round-trips scalars, lists and booleans", () => {
  const meta = {
    type: "paid-ad", jurisdiction: "AU", platforms: ["meta", "google"],
    paid: true, electoralMatter: true, recordRetained: false,
    authorisationText: "Authorised by J Flynn, Teller, Sydney",
  };
  const back = parseMeta(renderMeta(meta));
  eq(back.platforms, ["meta", "google"]);
  eq(back.paid, true);
  eq(back.recordRetained, false);
  eq(back.authorisationText, "Authorised by J Flynn, Teller, Sydney");
});
t("upsert preserves the human brief and replaces the block", () => {
  const d1 = upsertMeta("## Brief\nMake an ad.", { type: "paid-ad", version: "v1" });
  ok(d1.includes("## Brief"));
  const d2 = upsertMeta(stripMeta(d1), mergeMeta(parseMeta(d1), { version: "v2" }));
  ok(d2.includes("## Brief"), "brief survives");
  eq(parseMeta(d2).version, "v2");
  eq((d2.match(/```deliverable/g) || []).length, 1, "exactly one block");
});
t("parse of a description with no block is empty, not an error", () => {
  eq(parseMeta("just a description"), {});
  eq(parseMeta(null), {});
});
t("stripMeta returns the brief unchanged when there is no block", () => {
  eq(stripMeta("hello"), "hello");
});

console.log("\n== list ↔ state mapping ==");
t("maps James's existing SANDBOX column names", () => {
  eq(stateForList({ id: "1", title: "01 Drafting" }), "in_production");
  eq(stateForList({ id: "2", title: "02 Client Review" }), "client_review");
  eq(stateForList({ id: "3", title: "03 Changes Requested" }), "changes_requested");
  eq(stateForList({ id: "4", title: "04 Approved" }), "approved");
  eq(stateForList({ id: "5", title: "05 Deployed" }), "deployed");
});
t("maps the canonical column titles", () => {
  eq(stateForList({ id: "a", title: "5 · Compliance" }), "compliance_review");
  eq(stateForList({ id: "b", title: "11 · Verified" }), "verified");
});
t("unknown columns map to nothing rather than guessing", () => {
  eq(stateForList({ id: "z", title: "Random Column" }), undefined);
  eq(stateForList({ id: "z", title: null }), undefined);
});
t("index takes the first match per state", () => {
  const idx = buildStateIndex([
    { id: "l1", title: "Doing" }, { id: "l2", title: "01 Drafting" },
  ]);
  eq(idx.get("in_production"), "l1");
});

console.log("\n== gate audit trail ==");
t("gate pass comment is detectable and carries its gate id", () => {
  const c = renderGatePass({
    gateId: "G4_compliance", gateTitle: "Compliance gate", by: "James Flynn",
    checks: [{ id: "authorisation", assertion: "Auth present", passed: true }],
  });
  eq(extractGateId(c), "G4_compliance");
  ok(hasGatePass([c], "G4_compliance"));
  ok(!hasGatePass([c], "G5_client_signoff"));
});
t("unsatisfied checks are visible in the record", () => {
  const c = renderGatePass({
    gateId: "G3_internal_qa", gateTitle: "Internal QA", by: "K",
    checks: [{ id: "spec", assertion: "Spec met", passed: false }],
  });
  ok(c.includes("- [ ]"), "unchecked box rendered");
  ok(c.includes("1 check(s) not satisfied"));
});

console.log("\n== compliance engine ==");
const baseAU = {
  deliverableType: "paid-ad", jurisdiction: "AU", platforms: ["meta"],
  paid: true, electoralMatter: true,
  authorisationText: "Authorised by J Flynn, Teller Consulting, Sydney",
  payingEntity: "Teller Consulting Pty Ltd",
  verifiedPlatforms: ["meta"], specialCategoryDeclared: true,
  targeting: { countries: ["AU"] }, recordRetained: true,
};
t("a fully-formed AU Meta ad passes clean", () => {
  const r = evaluateCompliance(baseAU);
  if (r.verdict !== "READY") throw new Error(`got ${r.verdict}: ${r.findings.map(f=>f.code).join(",")}`);
});
t("missing authorisation is a blocker", () => {
  const r = evaluateCompliance({ ...baseAU, authorisationText: null });
  eq(r.verdict, "LIKELY_REJECTED");
  ok(r.findings.some((f) => f.code === "AUTH_MISSING"));
});
t("placeholder authorisation is caught, not accepted", () => {
  const r = evaluateCompliance({ ...baseAU, authorisationText: "[DISCLAIMER REQUIRED]" });
  ok(r.findings.some((f) => f.code === "AUTH_PLACEHOLDER"));
  eq(r.verdict, "LIKELY_REJECTED");
});
t("US disclaimer form is enforced per jurisdiction", () => {
  const r = evaluateCompliance({
    ...baseAU, jurisdiction: "US", authorisationText: "Authorised by J Flynn, Sydney",
  });
  ok(r.findings.some((f) => f.code === "AUTH_FORM"), "AU wording in a US ad should warn");
});
t("TikTok paid political is a hard blocker", () => {
  const r = evaluateCompliance({ ...baseAU, platforms: ["tiktok"], verifiedPlatforms: [] });
  ok(r.findings.some((f) => f.code === "PLATFORM_BANNED_TIKTOK"));
  eq(r.verdict, "LIKELY_REJECTED");
});
t("unverified advertiser blocks launch", () => {
  const r = evaluateCompliance({ ...baseAU, verifiedPlatforms: [] });
  ok(r.findings.some((f) => f.code === "VERIFY_META"));
});
t("undeclared special ad category blocks on Meta", () => {
  const r = evaluateCompliance({ ...baseAU, specialCategoryDeclared: false });
  ok(r.findings.some((f) => f.code === "SPECIAL_CATEGORY"));
});
t("unsourced negative claim blocks", () => {
  const r = evaluateCompliance({
    ...baseAU, negativeClaims: [{ claim: "He missed 22% of votes" }],
  });
  ok(r.findings.some((f) => f.code === "CLAIM_UNSOURCED"));
});
t("sourced negative claim passes", () => {
  const r = evaluateCompliance({
    ...baseAU,
    negativeClaims: [{ claim: "Missed 22% of votes", evidence: ["Hansard 2025 session record"] }],
  });
  ok(!r.findings.some((f) => f.code === "CLAIM_UNSOURCED"));
});
t("undisclosed AI media blocks", () => {
  const r = evaluateCompliance({ ...baseAU, aiGeneratedMedia: true, aiDisclosed: false });
  ok(r.findings.some((f) => f.code === "AI_UNDISCLOSED"));
});
t("US final-week freeze is detected", () => {
  const r = evaluateCompliance({
    ...baseAU, jurisdiction: "US", authorisationText: "Paid for by Friends of X",
    flightStart: "2026-11-01", electionDate: "2026-11-03",
  });
  ok(r.findings.some((f) => f.code === "US_FINAL_WEEK_FREEZE"));
});
t("flight starting well before election day is fine", () => {
  const r = evaluateCompliance({
    ...baseAU, jurisdiction: "US", authorisationText: "Paid for by Friends of X",
    flightStart: "2026-09-01", electionDate: "2026-11-03",
  });
  ok(!r.findings.some((f) => f.code === "US_FINAL_WEEK_FREEZE"));
});
t("inverted flight dates are a blocker", () => {
  const r = evaluateCompliance({ ...baseAU, flightStart: "2026-10-10", flightEnd: "2026-10-01" });
  ok(r.findings.some((f) => f.code === "FLIGHT_INVERTED"));
});
t("EU targeting raises the DSA fields", () => {
  const r = evaluateCompliance({ ...baseAU, targeting: { countries: ["DE"] } });
  ok(r.findings.some((f) => f.code === "DSA_FIELDS"));
});
t("interest targeting warns under the political category", () => {
  const r = evaluateCompliance({ ...baseAU, targeting: { countries: ["AU"], interests: ["farming"] } });
  ok(r.findings.some((f) => f.code === "INTEREST_TARGETING"));
});
t("internal non-electoral work is not dragged through authorisation", () => {
  const r = evaluateCompliance({
    deliverableType: "internal", jurisdiction: "AU", platforms: [],
    paid: false, electoralMatter: false,
  });
  eq(r.verdict, "READY");
});
t("NZ promoter statement wording is accepted", () => {
  const r = evaluateCompliance({
    ...baseAU, jurisdiction: "NZ", authorisationText: "Promoted by A Person, 12 Queen St, Auckland",
  });
  ok(!r.findings.some((f) => f.code === "AUTH_FORM"));
});
t("report text is human-readable and names the verdict", () => {
  const r = evaluateCompliance({ ...baseAU, authorisationText: null });
  ok(r.text.includes("LIKELY REJECTED"));
  ok(r.text.includes("BLOCKER"));
  ok(r.text.length > 100);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
