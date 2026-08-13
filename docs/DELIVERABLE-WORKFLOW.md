# The Deliverable Workflow

**How Teller runs every client deliverable from inception to deployment, with Kitchen as the backbone.**

This document is the operating manual. It defines what a deliverable is, the states it moves through, the gates it must pass, who signs what, and how all of that is recorded in Kitchen so the record survives a dispute, an audit, or a takedown request.

---

## 1. Why this exists

Agency work fails in a small number of expensive, repeatable ways:

| Failure | What it costs |
|---|---|
| Work starts before the brief is agreed | Rework, scope disputes, unbillable hours |
| Nobody knows what state something is in | Status meetings that produce no decisions |
| "Approval" was a nod in a phone call | The client says they never approved it |
| An ad ships without an authorisation statement | AEC takedown mid-flight, or an NZ$40,000 fine |
| An attack claim ships without a source | The claim becomes the story |
| Verification wasn't started until launch week | The flight slips by a week |
| The approved version and the deployed version differ | Nobody can prove which one the client saw |
| No retained copy of what ran | You cannot answer a complaint or a disclosure return |

Every one of those is a **process** failure, not a talent failure. This workflow closes each of them with a gate, and Kitchen holds the evidence.

The rule underneath everything:

> **Rework is cheap. A bad approval is not.**
> Sending work backwards is always allowed and never gated. Moving it forwards is gated.

---

## 2. What a deliverable is

A deliverable is a discrete unit of work the agency produces for a client. If it can be reviewed, approved and shipped on its own, it is one deliverable.

**Twelve types**, because the type decides which gates are mandatory:

| Type | Example | Compliance gate | Client sign-off |
|---|---|---|---|
| `paid-ad` | Meta ad set, Google search campaign | Required | Required |
| `organic-social` | Facebook post, Reel, tweet | Required | Required |
| `email` | Broadcast to the supporter list | Required | Required |
| `sms` | GOTV text blast | Required | Required |
| `print` | Flyer, corflute, DL card | Required | Required |
| `video` | Cut interview clip, TVC | Required | Required |
| `press` | Media release, op-ed, statement | Required | Required |
| `web` | Landing page, donation page change | Required | Required |
| `event` | Rally, doorknock, webinar, fundraiser | Required | Required |
| `research` | Polling, oppo file, list build | Skipped | Required |
| `strategy-doc` | Campaign plan, messaging memo | Skipped | Required |
| `internal` | Agency-internal work | Skipped | Skipped |

**Nine workstreams**, mirroring the taxonomy already in the Campaign TEMPLATE board:

`strategy` · `comms` · `paid-media` · `fundraising` · `data-research` · `field` · `volunteers` · `candidate` · `operations`

Every deliverable carries exactly one type and one workstream. Together they answer "what is this and whose job is it".

---

## 3. Roles

Six roles. One person often wears several — but **never producer and reviewer on the same deliverable**. That single rule catches more errors than any other.

| Role | Owns | Accountable for |
|---|---|---|
| **Requester** | The ask | That the need is real and the deadline is honest |
| **Producer** | The making | That it answers the brief and meets spec |
| **Reviewer** | Internal QA | That it is correct, on-brand, and proofread |
| **Compliance** | The regulatory gate | That it is legal to publish in this jurisdiction |
| **Client approver** | The binding yes | That the client is committed to it |
| **Deployer** | Going live | That what ships is what was approved |

---

## 4. The lifecycle

Eleven live states plus three side states.

```
intake → scoped → in_production → internal_review → compliance_review
   → client_review → approved → scheduled → deployed → verified → archived

                    ↘ changes_requested ↗        ⛔ blocked      ✕ cancelled
```

| State | Means | Exit is via |
|---|---|---|
| `intake` | Captured, not yet scoped | G1 Scope |
| `scoped` | Brief agreed, estimated, owned | G2 Production-ready |
| `in_production` | Being made | Producer submits |
| `internal_review` | With the reviewer | G3 Internal QA |
| `compliance_review` | With compliance | G4 Compliance |
| `client_review` | With the client | G5 Client sign-off |
| `changes_requested` | Rework needed | Producer picks it up |
| `approved` | Signed off and locked | G6 Deploy |
| `scheduled` | Booked into the queue | G6 Deploy |
| `deployed` | Live | G7 Verify |
| `verified` | Confirmed live and delivering | Close |
| `archived` | Record retained | Terminal |
| `blocked` | Waiting on an external dependency | Unblock |
| `cancelled` | Will not ship | Terminal |

**Backwards is always open.** Any of `internal_review`, `compliance_review`, `client_review`, `approved`, `scheduled`, `deployed` can drop to `changes_requested`. A deployed item going backwards is an incident — treat it as one.

---

## 5. The seven gates

A gate is a checklist plus a signature. The signature is a Kitchen comment: attributed, timestamped, and never edited. **A deliverable cannot move forward through a gate without one.**

### G1 · Scope gate — `intake → scoped`
**Owner: Producer.** Stops work starting on a brief nobody agreed.

- A written brief exists and names the audience, message and the one action it should drive
- Deliverable type and workstream are set
- A due date exists and is achievable
- A named producer is assigned
- *(advisory)* Work is inside an accepted quote/retainer, or a quote has been raised
- Jurisdiction is recorded — this decides the authorisation regime from minute one

> **Why jurisdiction here and not later:** it changes what text must appear in the artwork. Discovering it at compliance means a redesign.

### G2 · Production-ready gate — `scoped → in_production`
**Owner: Producer.** Stops production stalling halfway for a missing asset.

- All inputs on hand: copy direction, assets, data, brand profile
- Any factual or negative claim has a cited, checkable source attached
- *(advisory)* Destination accounts and pages exist and are accessible

> **Start advertiser verification here.** Meta political authorisation, Google election-ads verification and X verification all take days. They gate launch, not drafting. Starting them at G4 costs you a week.

### G3 · Internal QA gate — `internal_review → compliance_review`
**Owner: Reviewer.** Stops the client seeing anything embarrassing.

- Output answers the brief — message, audience, action
- Platform spec met: character counts **counted**, not estimated; aspect ratios; file types; durations
- Brand profile respected: palette, type hierarchy, logo treatment
- Copy proofread; names, dates, times, venues and URLs verified against source
- Every link resolves and carries correct tracking parameters
- **Reviewer is not the producer**

### G4 · Compliance gate — `compliance_review → client_review`
**Owner: Compliance.** The gate that protects the client's licence to campaign. *Skipped for `research`, `strategy-doc`, `internal`.*

- Authorisation / disclaimer / promoter statement present, correct and prominent for the jurisdiction
- Paying entity confirmed and matches the platform-verified funding entity
- Political advertising is permitted on every destination platform
- Advertiser verification complete on each platform
- Special ad category declared where the platform requires it
- Every negative or comparative claim carries an evidence reference
- AI-generated or AI-altered media depicting real people, places or events is disclosed
- Targeting is legal for the category and geographically fits the district
- Flight dates clear any blackout, freeze or pre-poll restriction
- A copy of the final creative is retained for the statutory record period

This gate is **automated** — see §8.

### G5 · Client sign-off gate — `client_review → approved`
**Owner: Client approver.** The gate that protects the agency. *Skipped for `internal`.*

- The approver is the person with authority to bind the client
- Approval is **explicit and in writing** — never inferred from silence
- The approval names the **exact version** being approved
- Approval covers **placement, spend and flight dates**, not just creative
- Any conditions attached to the approval are recorded and actioned

> **The most common and most expensive mistake in the whole workflow** is treating "looks good" in a group thread as an approval. It names no version, binds nobody, and covers no spend. Record it properly or it did not happen.

### G6 · Deployment gate — `approved → deployed`
**Owner: Deployer.** Stops the gap between what was approved and what shipped.

- What is being deployed is **byte-identical** to what was approved
- Media is a real hosted file the platform can fetch — **not a share link or preview page**
- Budget, bid strategy and schedule match the approved spend
- Pixel/conversion tracking is live and firing
- A named person can pause or pull this within minutes

> **The share-link trap:** a `share.descript.com/view/…` URL is an HTML page, not a video. Facebook says "problem with your video file", Instagram throws a container error, YouTube says "Media type 'text/html' is not supported". Every platform rejects it. If a clip has no exported MP4, it has no post.

### G7 · Post-deployment verification — `deployed → verified`
**Owner: Deployer.** The gate everyone skips and everyone regrets skipping.

- Asset confirmed live and rendering correctly on each destination
- Authorisation/disclaimer **visible on the live placement**
- Delivery has begun — impressions/sends registering as expected
- Live screenshot/permalink captured into the deliverable record

---

## 6. Jurisdiction rules

### Australia — authorisation statement
```
Authorised by {name}, {entity}, {town}
```
Required where electoral matter is communicated as paid advertising, or by/on behalf of a disclosure entity. Must be prominent, legible and easily found.

- **Entity:** name of the entity plus the town or city it is based in
- **Natural person, printed matter** (flyers, posters, stickers): name plus **full street address**
- **Natural person, other communications:** name plus town or city
- Paid creator/influencer content carrying electoral matter must also be authorised
- The AEC actively requests takedowns of unauthorised material — a missing authorisation kills a flight mid-air
- **State elections layer their own rules on top.** Check the relevant state commission at intake.

### United States — disclaimer
```
Paid for by {entity}
```
- Must **match the platform-verified funding entity**. For client work it names the client's committee, not the agency.
- Meta: page must pass political-advertiser authorisation before the first ad; ads live in the public Ad Library for 7 years
- **Final-week freeze:** new political ads are blocked in the last week before election day; only ads with at least one prior impression keep serving. **Pre-load closing creative before the window.**
- Google/YouTube: account-level election-ads verification; targeting capped at age, gender and postal-code-level location
- FEC and state disclosure rules layer on top and vary by state

### New Zealand — promoter statement
```
Promoted by {name}, {address}
```
- Required **at all times**, not only during the regulated period
- For paid social, the statement goes in the ad itself
- Must be clearly displayed — statements that are too small draw complaints
- Running without one risks a fine up to **NZ$40,000**

### Australian states and territories

State elections are governed by their own Acts and their own commissions. **A valid Commonwealth authorisation is not automatically valid at state level** — this is the most common way an authorisation fails, because the federal form is the one everyone has in a template.

| Region | Act | PO Box? | Notes |
|---|---|---|---|
| **SA** | Electoral Act 1985 s112 (ECSA) | **Prohibited** | Name + **street address**. Party name or registered abbreviation for endorsed candidates. Independents may use a PO Box only with the Commissioner's approval, plus their suburb at the end of the ad. Small items exempt. Penalty to $5,000 / $10,000. |
| **NSW** | Electoral Act 2017 (NSWEC) | **Prohibited** | Name + street address. Must not appear to be an official NSWEC communication. Election-day material must be registered. |
| **VIC** | Electoral Act 2002 s83 (VEC) | **Allowed** | Street address or PO Box — but **never an email address**. Authoriser must be 18+. Obligation is **ongoing**, not only during the election period. |
| **QLD** | Electoral Act 1992 (ECQ) | **Allowed** | Residential, business or PO Box; must be contactable there. HTV cards need ECQ approval. |
| **WA** | Electoral Act 1907 (WAEC) | *Unverified* | Required once writs issue. Act substantially amended Nov 2023 — confirm the current provision. |
| **TAS · ACT · NT** | Own Acts | *Unverified* | Confirm with the commission. |

The engine checks the address form mechanically: a PO Box in an SA or NSW authorisation is a blocker, an email address in a Victorian one is a blocker, and a town-only authorisation in SA is flagged as too thin. Where a region is marked *unverified*, the engine says so rather than encoding a guess — a fabricated legal rule is worse than an admitted gap.

### Platform permission matrix

| Platform | Paid political | Verification | Notes |
|---|---|---|---|
| Meta (FB/IG/CTWA) | Allowed | Required | Ad Library 7yr; US final-week freeze; AI-media labels |
| Google / YouTube | Allowed | Required | Targeting limited to age/gender/postal |
| X | Allowed | Required | Geo-restricted to registered jurisdictions |
| Snapchat | Conditional | Required | Useful under-35 GOTV reach |
| **TikTok** | **Banned** | — | Organic only; paid creator political content also prohibited |
| **LinkedIn** | **Banned** | — | Political advertising not permitted |
| Email / SMS / print / web / radio / TV | Allowed | — | Electoral law still applies |

---

## 7. How this lives in Kitchen

Kitchen is the backbone. No second system, no spreadsheet.

| Workflow concept | Kitchen primitive |
|---|---|
| Client engagement | **Board** |
| Lifecycle state | **List** (board column) |
| Deliverable | **Task** |
| Structured metadata | Fenced block in the task **description** |
| Gate pass | Task **comment** (attributed, timestamped, append-only) |
| Client approval | Task **comment** |
| Compliance report | Task **comment** |
| State change | Task **comment** |
| Creative and assets | **Files** attached to the task/comment |
| Flight date, election day | **Milestone** |
| Client feedback thread | **Conversation** |
| Commercials | **Quote** → **Invoice** |
| Automation triggers | **Webhooks** |

### Board columns

```
1 · Intake            7 · Changes Requested
2 · Scoped            8 · Approved
3 · In Production     9 · Scheduled
4 · Internal Review  10 · Deployed
5 · Compliance       11 · Verified
6 · Client Review    ⛔ Blocked   ✓ Archived
```

Existing column names are recognised automatically — `Drafting`, `Doing`, `WIP` all map to `in_production`; `Client Review`, `With Client` map to `client_review`; and so on. The SANDBOX board's `01 Drafting / 02 Client Review / 03 Changes Requested / 04 Approved / 05 Deployed` maps without any renaming.

### The metadata block

Kitchen has no custom fields, so structured data lives in a fenced block at the end of the task description. Machine-written, machine-parsed, human-readable:

````
## Brief

**Audience:** Swing voters 35–64, cost-of-living pressured.
**Message:** Grocery and power bills have outrun wages.
**One action:** Click through to the petition page.

```deliverable
type: paid-ad
workstream: paid-media
state: in_production
jurisdiction: AU
region: SA
platforms: meta, google
paid: true
electoralMatter: true
authorisationText: Authorised by J Flynn, Teller Consulting, Adelaide
payingEntity: Example Campaign Committee
verifiedPlatforms: meta
specialCategoryDeclared: true
flightStart: 2026-09-01
flightEnd: 2026-09-14
electionDate: 2026-11-03
recordRetained: true
producer: Kayla
reviewer: James
version: v3
```
````

The brief above the block is yours. The block is the system's. Editing the brief never disturbs the block, and vice versa.

### The evidence register

Every negative or comparative claim needs a source someone can check. The register lives in a **second** fenced block on the same task, so the claim and its backing travel together:

````
```evidence
id: E1
claim: Missed 22% of floor votes in the 2025 session
source: SA Hansard, 2025 session voting record, p.412
url: https://hansard.example.sa.gov.au/2025
archived: https://web.archive.org/web/2026/hansard
status: verified
verifiedBy: James Flynn
--
id: E2
claim: Has taken donations from developers
status: unsourced
```
````

The compliance check draws its claims from this register, so the two can never disagree. `E2` above is a blocker.

Three rules the register enforces:

- **Never fabricate a source.** If a claim cannot be backed, downgrade the ad or drop the claim. Never launder an unbacked claim into a question — *"why won't he say whether…"* is the same claim wearing a hat.
- **Attaching a URL is not verification.** `verified` means a named person checked the source actually says what the claim says.
- **Archive it.** A live URL with no archived copy is flagged. The page that disappears is always the one you needed.

> Because the description now carries two machine blocks, every write goes through a single compose step. Writing the metadata alone would silently drop the register — that failure is covered by round-trip tests in both directions.

### The audit trail

Four comment types, each machine-detectable by its marker:

- `GATE-PASS` — a gate signature, with every check ticked or not, and who signed
- `CLIENT-APPROVAL` — approver, version, scope, conditions, and ideally the client's exact words
- `COMPLIANCE-CHECK` — a full compliance report with verdict
- `STATE-CHANGE` — from, to, by, why

Nothing edits or deletes a comment. The history is the record.

---

## 8. The software layer

Built into the Kitchen MCP server. Eleven tools, all prefixed `workflow_`.

### Reference
| Tool | Does |
|---|---|
| `workflow_describe` | The whole model: states, gates and their checks, workstreams, types, platform matrix. Optionally filtered to one deliverable type. |
| `workflow_next_steps` | Given a state, the legal moves and which gate guards each |

### Setup
| Tool | Does |
|---|---|
| `workflow_provision_board` | Creates a column for every state. Reuses columns that already map. Idempotent — safe to re-run on a live board. |

### Running work
| Tool | Does |
|---|---|
| `workflow_create_deliverable` | New deliverable in Intake with its metadata block |
| `workflow_get_deliverable` | Full position: state, metadata, gates signed, approval status, audit trail, what remains |
| `workflow_update_deliverable` | Update metadata without changing state |
| `workflow_sign_gate` | Record a gate signature |
| `workflow_advance` | Move state — **refuses to cross an unsigned gate**, and refuses to reach `approved` with no recorded client approval |
| `workflow_record_approval` | Record a binding client sign-off |

### Compliance
| Tool | Does |
|---|---|
| `workflow_compliance_check` | Run the engine on a deliverable and post the report |
| `workflow_compliance_preview` | Run it on ad-hoc values while drafting, before a card exists |

### Recipes and reference
| Tool | Does |
|---|---|
| `workflow_recipe` | What "done" looks like for a type: required metadata, what the brief must answer, assets with specs, type-specific QA, and the traps that kill that type. `as_brief_scaffold: true` returns a ready-to-fill brief |
| `workflow_au_state_rules` | The AU state/territory authorisation matrix |

### Evidence
| Tool | Does |
|---|---|
| `workflow_get_evidence` | Read the claims register and its audit |
| `workflow_set_evidence` | Replace the register — a replace, not an append |
| `workflow_audit_evidence` | Audit a claim set without touching Kitchen |

### Oversight and records
| Tool | Does |
|---|---|
| `workflow_board_status` | Portfolio view: counts per state, overdue, awaiting client, awaiting compliance, blocked |
| `workflow_status_report` | Internal standup report and a client-facing update, from one board read |
| `workflow_record_pack` | The retention artefact for one deliverable — and the gaps in its own record |

### Enforcement, precisely

`workflow_advance` refuses when:
- the transition is not legal in the state machine (and tells you what is)
- the guarding gate has no recorded sign-off
- the target is `approved` and there is no `CLIENT-APPROVAL` record

`force: true` overrides — and writes **"FORCED past G4 without a recorded sign-off"** permanently into the audit trail. The escape hatch exists, and it leaves a mark.

### Automation

Opt-in via `WORKFLOW_AUTOMATION=true`. Driven by the Kitchen webhooks already receiving on `/webhooks/kitchen/<category>`:

| Event | Automation |
|---|---|
| Card enters **5 · Compliance** | Runs the compliance engine, posts the report |
| Card reaches **8 · Approved** with no approval record | Posts a warning |
| Card reaches **10 · Deployed** over a `LIKELY REJECTED` verdict | Posts a warning |
| Client comment reads like an approval | Flags it for formalisation, quotes it back, names the current version |
| Task falls due | Posts what state it is stuck in and what remains |

Automation **observes, checks and annotates. It never moves a deliverable.** Humans transition; the machine keeps the record honest.

---

## 8a. The skill

`skills/deliverable-workflow/` packages all of this so it triggers on natural phrasing — *"add this to the pipeline"*, *"what's waiting on the client"*, *"the client approved it"*, *"is this ready to run"*, *"pull the record for that ad"* — rather than requiring anyone to remember nineteen tool names.

Install it alongside the other synced skills. It carries the operating principles that matter most under pressure:

1. **The gates are the product.** Anyone can make an ad. The client pays for an ad that is correct, legal, approved and documented.
2. **Warn loudly, never block silently.** Verdicts are recommendations with remedies attached.
3. **Never invent a legal fact.** Not an authorisation, not an entity, not a source, not a state rule.
4. **Automation observes; humans transition.**
5. **Record it while people still remember.**

---

## 9. Runbook

### Standing up a new client
1. `workflow_provision_board` with the client name → 13 columns
2. Create milestones for election day and each flight window
3. Add the client's approver as a Kitchen client user on the board
4. Start advertiser verification on every platform in the plan — **before any creative exists**
5. Record the authorisation statement and paying entity once; reuse on every deliverable

### Running one deliverable
1. `workflow_create_deliverable` — brief, type, workstream, jurisdiction, due date
2. Sign **G1**, advance to `scoped`
3. Gather inputs and evidence; sign **G2**, advance to `in_production`
4. Produce. Advance to `internal_review`
5. Reviewer (not the producer) signs **G3** → `compliance_review`
6. Compliance report posts automatically. Clear the blockers, re-run, sign **G4** → `client_review`
7. Client approves in writing → `workflow_record_approval` → sign **G5** → `approved`
8. Sign **G6** → `deployed`
9. Confirm live, capture the permalink, sign **G7** → `verified` → `archived`

### Daily
- `workflow_board_status` on each active board
- Chase `awaiting_client` by named approver, not the group thread
- Clear `awaiting_compliance` — it is usually one missing field
- `blocked` items need an owner and a date, or they need cancelling

### Weekly
- Anything in `changes_requested` more than a week is a scoping failure — re-brief it
- Anything `deployed` but not `verified` is an unclosed loop
- Check verification status on every platform with a flight in the next fortnight

---

## 10. Setup

Environment variables on the Vercel deployment:

```
KITCHEN_API_KEY=...              # workspace API token
KITCHEN_WORKSPACE=teller
MCP_GATE_TOKEN=...               # OAuth login password + JWT signing key
KITCHEN_WEBHOOK_SECRETS_<CATEGORY>=...   # one per webhook category
WORKFLOW_AUTOMATION=true         # opt in to automated compliance + warnings
```

`GET /healthz` reports which webhook categories are armed and whether OAuth is ready.

---

## 11. Scope and limits

- **This is operational guidance encoded as software, not legal advice.** Jurisdiction-specific filing questions go to counsel.
- The compliance engine is **warn-only by mandate**. It returns a verdict; a human decides what ships. `LIKELY_REJECTED` means "this will be taken down or rejected", not "the tool refused".
- Policy state is mid-2026. Platform political-ad policy changes often — for policy-sensitive launches, re-verify against the platform's current published policy before relying on the matrix.
- The engine checks what it can see. It cannot tell you whether a claim is *true* — only whether a source is attached.
