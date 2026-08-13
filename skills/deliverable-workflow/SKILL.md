---
name: deliverable-workflow
description: Run client deliverables through the agency's gated workflow in Kitchen — from brief to sign-off to deployment — with the political compliance and approval trail attached. Use this skill whenever the user wants to start, track, review, approve, deploy or report on a client deliverable; says things like "add this to the pipeline", "what's waiting on the client", "is this ready to run", "check this ad for compliance", "the client approved it", "what's the status on [client]", "set up a board for [client]", "did we ever get sign-off on that", or "pull the record for that ad". Also trigger when the user mentions authorisation statements, "Authorised by", "Paid for by", promoter statements, AEC or a state electoral commission, advertiser verification, special ad category, evidence for an attack claim, a client approval, a gate, or a deliverable's state. Reach for this even if the user only says "new ad for [client], cost of living, Meta" — that is an intake, and this is the pipeline it feeds.
---

# Deliverable Workflow

The agency's production line for client work. One brief in, one deployed and documented deliverable out — with a record that survives a dispute, an audit or a takedown request.

The rule underneath everything:

> **Rework is cheap. A bad approval is not.** Backwards is always allowed and never gated. Forwards is gated.

Full spec: `docs/DELIVERABLE-WORKFLOW.md` in the KitchenMCP repo.

## The shape of it

Eleven live states, seven gates, all held in Kitchen. Board = client engagement. Column = state. Task = deliverable. Gate passes, approvals and compliance reports are append-only task comments.

```
intake → scoped → in_production → internal_review → compliance_review
   → client_review → approved → scheduled → deployed → verified → archived
                  ↘ changes_requested ↗     ⛔ blocked   ✕ cancelled
```

| Gate | Guards | Owner |
|---|---|---|
| G1 Scope | intake → scoped | Producer |
| G2 Production-ready | scoped → in_production | Producer |
| G3 Internal QA | internal_review → compliance_review | Reviewer |
| G4 Compliance | compliance_review → client_review | Compliance |
| G5 Client sign-off | client_review → approved | Client approver |
| G6 Deploy | approved → deployed | Deployer |
| G7 Verify | deployed → verified | Deployer |

## Starting work

When the user describes a new piece of work, treat it as an intake — don't ask twenty questions first.

1. Call `workflow_recipe` for the deliverable type. It tells you what the brief must answer, what assets are needed and what traps kill this type. Use `as_brief_scaffold: true` to get a ready-to-fill brief.
2. Fill what you can infer from what they said. Ask **once**, in one consolidated pass, for what is genuinely missing — never a barrage.
3. `workflow_create_deliverable` with the brief and metadata. It lands in Intake.

Set **jurisdiction at intake, always**. It decides what text must appear in the artwork, and discovering it at the compliance gate means a redesign. If it is a state election, set `region` too — the state rules are stricter than the Commonwealth ones and differ from each other.

If the board does not exist yet, `workflow_provision_board` creates a column per state. It reuses columns that already map, so it is safe on a live board and safe to re-run.

## Moving work forward

`workflow_advance` enforces the state machine. It refuses to cross a gate that has not been signed, and refuses to reach `approved` without a recorded client approval. That is the point — do not reach for `force` to get past a refusal. A forced move is written permanently into the audit trail as a forced move.

Before advancing, sign the gate with `workflow_sign_gate`, passing the honest outcome of each check. A check you omit is recorded as not satisfied, which is correct: silence is not a pass.

`workflow_get_deliverable` answers "where is this and what's left" — current state, gates signed, whether the client has approved, the evidence register, missing metadata and the remaining path.

## Compliance

`workflow_compliance_check` runs when a card enters the Compliance column, or on demand. It is **warn-only** — it returns a verdict, it never refuses. `LIKELY_REJECTED` means "this will be taken down or rejected", not "the tool said no".

Before a deliverable exists, `workflow_compliance_preview` runs the same engine on ad-hoc values while drafting.

Things it will catch, and that you should never paper over:

- **A missing or placeholder authorisation.** Never invent an authorising person or entity. If the paying entity is unconfirmed, ship `[DISCLAIMER REQUIRED]` and say so — the deliverable does not go live until a real one exists.
- **A federal-form authorisation reused on a state ad.** `Authorised by X, Entity, Town` is valid federally and too thin for SA. Call `workflow_au_state_rules` when a state election is in play. SA and NSW prohibit a PO Box; VIC and QLD allow one; VIC rejects an email address. WA, TAS, ACT and NT are unverified in the engine — confirm with the commission rather than assuming.
- **Advertiser verification not started.** It gates launch, not drafting, and takes days. Raise it at G2, not G4.
- **Paid political on a platform that bans it.** TikTok and LinkedIn do not permit it at all.
- **An unsourced negative claim.** See below.

## Evidence

Every negative or comparative claim about an opponent needs a source someone can check. Keep it on the deliverable with `workflow_set_evidence`; read it with `workflow_get_evidence`.

The compliance check draws its claims from this register, so the two can never disagree.

Three rules:

- **Never fabricate a source.** If a claim cannot be backed, downgrade the ad to a softer type or drop the claim. Never launder an unbacked claim into a question — "why won't he say whether…" is the same claim wearing a hat.
- **Attaching a URL is not verification.** `verified` means a named person checked the source actually says what the claim says.
- **Archive it.** The page that disappears is always the one you needed. A live URL with no archived copy is flagged.

## Approvals

An approval that isn't written down isn't an approval. Record it with `workflow_record_approval`, capturing:

- the **named person** with authority to bind the client
- the **exact version** approved
- whether the approval covers **placement, spend and flight dates** or only creative
- any **conditions** attached
- ideally the client's **own words**, quoted

The single most expensive mistake in this workflow is treating "looks good" in a group thread as an approval. It names no version, binds nobody and covers no spend. If that is all you have, say so and go get a real one.

When automation flags a client comment that reads like an approval, it has only flagged it. Formalising it is a human decision.

## Deployment

At G6, what deploys must be byte-identical to what was approved. Two things break this repeatedly:

- **Media that is not a real file.** A Descript share link is an HTML page; every platform rejects it. If a clip has no exported MP4, it has no post — say so early rather than building a draft that fails at publish.
- **A file the platform cannot fetch.** A private Drive file returns a login page. Check sharing, and use `confirm=t` on direct-download URLs so large files don't return the virus-scan interstitial.

## Reporting and records

- `workflow_board_status` — counts per state, what's overdue, what's waiting on the client, what's waiting on compliance, what's blocked. Use it for a standup or a client update. Chase the named approver, not the group thread.
- `workflow_record_pack` — the retention artefact for one deliverable: what ran, who authorised it, who paid, who approved it, on what evidence, plus every gate signature and the compliance history. This is what you produce when a regulator, a journalist or a client's lawyer asks. It also lists the gaps in its own record.

## Operating principles

1. **The gates are the product.** Anyone can make an ad. The reason a client pays an agency is that the ad is correct, legal, approved and documented. Do not treat the gates as paperwork around the real work.
2. **Warn loudly, never block silently.** Surface the risk with its remedy and let the user decide. Verdicts are recommendations.
3. **Never invent a legal fact.** Not an authorisation, not an entity, not a source, not a state rule. Where the engine says "unverified", say "unverified" and point at the commission.
4. **Automation observes; humans transition.** The machine posts reports and warnings. It never moves a deliverable.
5. **Record it while people still remember.** A record assembled six weeks later from a chat thread is how agencies lose arguments.

This is operational guidance encoded as software, not legal advice. Jurisdiction-specific filing questions go to counsel.
