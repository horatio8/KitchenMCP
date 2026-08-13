# Authorisation regimes

What must appear in the artwork, by jurisdiction. Policy state mid-2026 — re-verify before a policy-sensitive launch.

Never invent an authorising person or entity. If the paying entity is unconfirmed, ship `[DISCLAIMER REQUIRED]` and flag it; the deliverable does not go live until a real one exists.

---

## Commonwealth (AEC) — authorisation statement

```
Authorised by {name}, {entity}, {town}
```

Required where electoral matter is communicated as paid advertising, or by/on behalf of a disclosure entity. Must be prominent, legible and easily found.

- **Entity:** name of the entity plus the town or city it is based in
- **Natural person, printed matter** (stickers, flyers, posters): name plus **full street address**
- **Natural person, other communications:** name plus town or city
- Paid creator/influencer content carrying electoral matter must also be authorised
- The AEC actively requests takedowns of unauthorised material

---

## Australian states and territories

State elections are governed by their own Acts and commissions. **A valid Commonwealth authorisation is not automatically valid at state level** — this is the most common failure.

| Region | Act | PO Box? | Notes |
|---|---|---|---|
| **SA** | Electoral Act 1985 s112 (ECSA) | **Prohibited** | Name + **street address**. Party name or registered abbreviation for endorsed candidates; third party's name for a relevant third party. Independents may use a PO Box only with the Commissioner's approval, plus their suburb at the end of the ad. Small items (stickers, badges, pens, balloons) exempt. Penalty to $5,000 individual / $10,000 body corporate. |
| **NSW** | Electoral Act 2017 (NSWEC) | **Prohibited** | Name + street address. Must not appear to be an official NSWEC communication. Election-day material must be registered with the NSWEC. |
| **VIC** | Electoral Act 2002 s83 (VEC) | **Allowed** | Name + address, clearly displayed on its face. Street address or PO Box — but **never an email address**. Authoriser must be 18+. Obligation is **ongoing**, not only during the election period. |
| **QLD** | Electoral Act 1992 (ECQ) | **Allowed** | Name + address; residential, business or PO Box. Authoriser must be contactable at that address. How-to-vote cards need ECQ approval before election-day distribution. |
| **WA** | Electoral Act 1907 (WAEC) | *Unverified* | Required once writs are issued, for material likely to affect voting; printed and electronic alike. Newspaper ads merely announcing a meeting are excepted. Act substantially amended Nov 2023 — confirm the current provision. |
| **TAS** | Electoral Act 2004 (TEC) | *Unverified* | Confirm with the TEC. |
| **ACT** | Electoral Act 1992 (Elections ACT) | *Unverified* | Confirm with Elections ACT. |
| **NT** | Electoral Act 2004 (NTEC) | *Unverified* | Confirm with the NTEC. |

Where a region is marked *unverified*, say so and point at the commission. Do not assume the Commonwealth form is sufficient, and do not guess the rule.

---

## United States — disclaimer

```
Paid for by {entity}
```

- Must **match the platform-verified funding entity**. For client work it names the client's committee, not the agency.
- Meta: page must pass political-advertiser authorisation before the first ad; ads retained in the public Ad Library for 7 years.
- **Final-week freeze:** new political ads are blocked in the last week before election day; only ads with at least one prior impression keep serving. Pre-load closing creative before the window opens.
- Google/YouTube: account-level election-ads verification; targeting capped at age, gender and postal-code-level location.
- FEC and state disclosure rules layer on top and vary by state — committee IDs on creative, state registration.

---

## New Zealand — promoter statement

```
Promoted by {name}, {address}
```

- Required **at all times**, not only during the regulated period.
- For paid social, the statement goes in the ad itself. For a website that is itself an election advertisement, the home page or advertising page suffices.
- Must be clearly displayed — statements set too small draw complaints.
- Running without one risks a fine up to **NZ$40,000**.

---

## Platform permission matrix

| Platform | Paid political | Verification | Notes |
|---|---|---|---|
| Meta (FB/IG/CTWA) | Allowed | Required | Ad Library 7yr; US final-week freeze; AI-media labels |
| Google / YouTube | Allowed | Required | Targeting limited to age, gender, postal code |
| X | Allowed | Required | Geo-restricted to registered jurisdictions |
| Snapchat | Conditional | Required | Useful under-35 GOTV reach |
| **TikTok** | **Banned** | — | Organic only; paid creator political content also prohibited |
| **LinkedIn** | **Banned** | — | Not permitted |
| Email · SMS · print · web · radio · TV | Allowed | — | Electoral law still applies |

Meta special ad category `ISSUES_ELECTIONS_POLITICS` is mandatory for political content and **disables detailed interest targeting** while narrowing age and geo controls. Build audiences on geography, age, custom and lookalike audiences instead — and keep Advantage Audience expansion off when district precision matters, which is nearly always.
