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
import {
  parseEvidence, renderEvidence, upsertEvidence, stripEvidence,
  auditEvidence, nextEvidenceId, renderEvidenceReport,
} from "../dist/workflow/evidence.js";
import { recipeFor, allRecipes, missingMeta, renderBriefScaffold } from "../dist/workflow/recipes.js";
import { auRegime, analyseAuthorisationAddress } from "../dist/workflow/au-states.js";

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

console.log("\n== AU state overlay ==");
const auBase = {
  deliverableType:"paid-ad", jurisdiction:"AU", platforms:["meta"], paid:true, electoralMatter:true,
  payingEntity:"X", verifiedPlatforms:["meta"], specialCategoryDeclared:true,
  targeting:{countries:["AU"]}, recordRetained:true,
};
const codes = (r) => r.findings.map((f) => f.code);
t("SA rejects a PO Box in the authorisation", () => {
  const r = evaluateCompliance({...auBase, region:"SA", authorisationText:"Authorised by J Flynn, PO Box 123, Adelaide"});
  ok(codes(r).includes("AU_STATE_POBOX"));
  eq(r.verdict, "LIKELY_REJECTED");
});
t("SA accepts a street address", () => {
  const r = evaluateCompliance({...auBase, region:"SA", authorisationText:"Authorised by J Flynn, 14 Station Rd, Adelaide"});
  eq(r.verdict, "READY");
});
t("a valid COMMONWEALTH authorisation is flagged as too thin for SA", () => {
  const r = evaluateCompliance({...auBase, region:"SA", authorisationText:"Authorised by J Flynn, Teller Consulting, Adelaide"});
  ok(codes(r).includes("AU_STATE_ADDRESS_THIN"), "town-only should warn in SA");
});
t("NSW also rejects a PO Box", () => {
  const r = evaluateCompliance({...auBase, region:"NSW", authorisationText:"Authorised by J Flynn, PO Box 9, Sydney"});
  ok(codes(r).includes("AU_STATE_POBOX"));
});
t("VIC allows a PO Box", () => {
  const r = evaluateCompliance({...auBase, region:"VIC", authorisationText:"Authorised by J Flynn, PO Box 9, Melbourne"});
  ok(!codes(r).includes("AU_STATE_POBOX"));
  eq(r.verdict, "READY");
});
t("VIC rejects an email address", () => {
  const r = evaluateCompliance({...auBase, region:"VIC", authorisationText:"Authorised by J Flynn, james@teller.consulting"});
  ok(codes(r).includes("AU_STATE_EMAIL_ADDRESS"));
  eq(r.verdict, "LIKELY_REJECTED");
});
t("QLD allows a PO Box", () => {
  const r = evaluateCompliance({...auBase, region:"QLD", authorisationText:"Authorised by J Flynn, PO Box 9, Brisbane"});
  ok(!codes(r).includes("AU_STATE_POBOX"));
});
t("unverified states warn rather than silently passing", () => {
  const r = evaluateCompliance({...auBase, region:"WA", authorisationText:"Authorised by J Flynn, Perth"});
  ok(codes(r).includes("AU_STATE_UNVERIFIED"), "must admit the gap");
});
t("an unrecognised region is caught, not ignored", () => {
  const r = evaluateCompliance({...auBase, region:"Queensland", authorisationText:"Authorised by J Flynn, 1 A St, Brisbane"});
  ok(codes(r).includes("AU_REGION_UNKNOWN"));
});
t("no region means no state overlay at all", () => {
  const r = evaluateCompliance({...auBase, authorisationText:"Authorised by J Flynn, Teller, Sydney"});
  ok(!codes(r).some((c) => c.startsWith("AU_STATE")));
});

console.log("\n== evidence register ==");
t("round-trips a multi-entry register", () => {
  const entries = [
    { id:"E1", claim:"Missed 22% of votes", source:"Hansard 2025", url:"https://x.test/a", archived:"https://web.archive.org/x", status:"verified", verifiedBy:"James" },
    { id:"E2", claim:"Voted against the levy", status:"unsourced" },
  ];
  const back = parseEvidence(renderEvidence(entries));
  eq(back.length, 2);
  eq(back[0].claim, "Missed 22% of votes");
  eq(back[0].status, "verified");
  eq(back[1].status, "unsourced");
});
t("audit separates unsourced, unverified and unarchived", () => {
  const a = auditEvidence([
    { id:"E1", claim:"a", status:"unsourced" },
    { id:"E2", claim:"b", source:"S", status:"sourced" },
    { id:"E3", claim:"c", source:"S", archived:"arch", status:"verified" },
    { id:"E4", claim:"d", status:"withdrawn" },
  ]);
  eq(a.unsourced.length, 1);
  eq(a.verified.length, 1);
  eq(a.withdrawn.length, 1);
  eq(a.noArchive.length, 1, "E2 has a source but no archive");
  ok(!a.clean);
});
t("a register with every claim sourced is clean", () => {
  ok(auditEvidence([{ id:"E1", claim:"a", source:"S", status:"sourced" }]).clean);
});
t("withdrawn claims do not block", () => {
  ok(auditEvidence([{ id:"E1", claim:"a", status:"withdrawn" }]).clean);
});
t("nextEvidenceId does not collide", () => {
  eq(nextEvidenceId([{id:"E1",claim:"a",status:"unsourced"},{id:"E7",claim:"b",status:"unsourced"}]), "E8");
  eq(nextEvidenceId([]), "E1");
});
t("report names the unsourced count", () => {
  const r = renderEvidenceReport([{ id:"E1", claim:"x", status:"unsourced" }]);
  ok(r.includes("EVIDENCE-REGISTER"));
  ok(r.includes("cannot ship"));
});
t("empty register renders guidance rather than nothing", () => {
  ok(renderEvidenceReport([]).includes("No claims registered"));
});

console.log("\n== dual-block description ==");
t("meta and evidence blocks coexist without eating each other", () => {
  const brief = "## Brief\nMake an attack ad.";
  const meta = { type:"paid-ad", jurisdiction:"AU", version:"v1" };
  const ev = [{ id:"E1", claim:"Missed 22% of votes", source:"Hansard", status:"sourced" }];
  const desc = upsertEvidence(upsertMeta(brief, meta), ev);
  eq(parseMeta(desc).version, "v1");
  eq(parseEvidence(desc).length, 1);
  eq(stripEvidence(stripMeta(desc)).trim(), brief);
});
t("rewriting meta preserves the evidence block", () => {
  const brief = "## Brief";
  let desc = upsertEvidence(upsertMeta(brief, { version:"v1" }), [{ id:"E1", claim:"c", status:"sourced" }]);
  const cleanBrief = stripEvidence(stripMeta(desc));
  const ev = parseEvidence(desc);
  desc = upsertEvidence(upsertMeta(cleanBrief, { version:"v2" }), ev);
  eq(parseMeta(desc).version, "v2");
  eq(parseEvidence(desc).length, 1, "evidence must survive a metadata rewrite");
});
t("rewriting evidence preserves the metadata block", () => {
  let desc = upsertEvidence(upsertMeta("## B", { version:"v1" }), [{ id:"E1", claim:"c", status:"sourced" }]);
  const meta = parseMeta(desc);
  desc = upsertEvidence(upsertMeta(stripEvidence(stripMeta(desc)), meta), [
    { id:"E1", claim:"c", status:"verified" }, { id:"E2", claim:"d", status:"sourced" },
  ]);
  eq(parseMeta(desc).version, "v1", "metadata must survive an evidence rewrite");
  eq(parseEvidence(desc).length, 2);
});

console.log("\n== recipes ==");
t("every deliverable type has a recipe", () => {
  const types = ["paid-ad","organic-social","email","sms","print","video","press","web","event","research","strategy-doc","internal"];
  for (const ty of types) ok(recipeFor(ty), `missing recipe for ${ty}`);
  eq(allRecipes().length, types.length);
});
t("missingMeta finds unpopulated required fields", () => {
  const missing = missingMeta("paid-ad", { jurisdiction:"AU", platforms:["meta"] });
  ok(missing.some((m) => m.startsWith("authorisationText")));
  ok(!missing.some((m) => m.startsWith("jurisdiction")));
});
t("missingMeta treats an empty array as missing", () => {
  ok(missingMeta("paid-ad", { platforms: [] }).some((m) => m.startsWith("platforms")));
});
t("internal work requires no metadata", () => {
  eq(missingMeta("internal", {}), []);
});
t("brief scaffold names the traps", () => {
  const s = renderBriefScaffold("video");
  ok(s.includes("Watch for"));
  ok(/share\.descript/i.test(s), "should warn about the share-link trap");
});

console.log("\n== AU address analysis ==");
t("detects PO boxes in several forms", () => {
  ok(analyseAuthorisationAddress("PO Box 1").hasPoBox);
  ok(analyseAuthorisationAddress("P.O. Box 1").hasPoBox);
  ok(analyseAuthorisationAddress("GPO Box 22").hasPoBox);
  ok(analyseAuthorisationAddress("Locked Bag 5").hasPoBox);
  ok(!analyseAuthorisationAddress("14 Station Road, Adelaide").hasPoBox);
});
t("detects street addresses and emails", () => {
  ok(analyseAuthorisationAddress("14 Station Road").looksLikeStreetAddress);
  ok(!analyseAuthorisationAddress("Adelaide").looksLikeStreetAddress);
  ok(analyseAuthorisationAddress("a@b.com").hasEmail);
});
t("regime lookup is case-insensitive and rejects junk", () => {
  eq(auRegime("sa").region, "SA");
  eq(auRegime("Queensland"), undefined);
  eq(auRegime(null), undefined);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
