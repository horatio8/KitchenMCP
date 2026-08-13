# Gate checklists

The exact assertions for each gate, for use with `workflow_sign_gate`. Pass the honest outcome of each check by its `id`. A check you omit is recorded as not satisfied.

Items marked *(advisory)* do not block the gate.

---

## G1_scope — Scope gate
**intake → scoped · Producer**

| id | Assertion |
|---|---|
| `brief` | A written brief exists and names the audience, message and the one action it should drive. |
| `type` | Deliverable type and workstream are set. |
| `due` | A due date exists and is achievable. |
| `owner` | A named producer is assigned. |
| `commercial` | *(advisory)* Work is inside an accepted quote/retainer, or a quote has been raised. |
| `jurisdiction` | Jurisdiction is recorded. |

---

## G2_production_ready — Production-ready gate
**scoped → in_production · Producer**

| id | Assertion |
|---|---|
| `inputs` | All inputs are on hand: copy direction, assets, data, brand profile. |
| `evidence` | Any factual/negative claim has a cited, checkable source attached. |
| `accounts` | *(advisory)* Destination accounts/pages exist and are accessible. |

Start advertiser verification here, not at G4.

---

## G3_internal_qa — Internal QA gate
**internal_review → compliance_review · Reviewer**

| id | Assertion |
|---|---|
| `brief_met` | Output answers the brief — message, audience, action. |
| `spec` | Platform spec met: character counts counted, aspect ratios, file types, durations. |
| `brand` | Brand profile respected: palette, type hierarchy, logo treatment. |
| `proof` | Copy proofread; names, dates, times, venues and URLs verified against source. |
| `links` | Every link resolves and carries correct tracking parameters. |
| `reviewer_not_producer` | Reviewer is not the same person as the producer. |

---

## G4_compliance — Compliance gate
**compliance_review → client_review · Compliance**
*Skipped for `research`, `strategy-doc`, `internal`.*

| id | Assertion |
|---|---|
| `authorisation` | Authorisation / disclaimer / promoter statement present, correct and prominent for the jurisdiction. |
| `paying_entity` | Paying entity confirmed and matches the platform-verified funding entity. |
| `platform_allowed` | Political advertising is permitted on every destination platform. |
| `verification` | Advertiser verification / political authorisation is complete on each platform. |
| `special_category` | Special ad category declared where the platform requires it. |
| `evidence_refs` | Every negative or comparative claim carries an evidence reference. |
| `ai_disclosure` | AI-generated or AI-altered media depicting real people/places/events is disclosed. |
| `targeting` | Targeting is legal for the category and geographically fits the district. |
| `timing` | Flight dates clear any blackout, freeze or pre-poll restriction. |
| `record` | A copy of the final creative is retained for the statutory record-keeping period. |

---

## G5_client_signoff — Client sign-off gate
**client_review → approved · Client approver**
*Skipped for `internal`.*

| id | Assertion |
|---|---|
| `named_approver` | The approver is the person with authority to bind the client. |
| `explicit` | Approval is explicit and in writing — not inferred from silence. |
| `version` | The approval names the exact version being approved. |
| `scope` | Approval covers placement, spend and flight dates, not just creative. |
| `conditions` | Any conditions attached to the approval are recorded and actioned. |

---

## G6_deploy — Deployment gate
**approved → deployed · Deployer**

| id | Assertion |
|---|---|
| `matches_approved` | What is being deployed is byte-identical to what was approved. |
| `media_real` | Media is a real hosted file the platform can fetch — not a share link or preview page. |
| `budget` | Budget, bid strategy and schedule match the approved spend. |
| `tracking` | Pixel/conversion tracking is live and firing. |
| `rollback` | A named person can pause or pull this within minutes if needed. |

---

## G7_verify — Post-deployment verification
**deployed → verified · Deployer**

| id | Assertion |
|---|---|
| `live_check` | Asset confirmed live and rendering correctly on each destination. |
| `disclaimer_visible` | Authorisation/disclaimer is visible on the live placement. |
| `delivery` | Delivery has begun — impressions/sends registering as expected. |
| `archive_copy` | Live screenshot/permalink captured into the deliverable record. |
