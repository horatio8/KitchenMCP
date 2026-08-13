/**
 * Deliverable recipes.
 *
 * A recipe is what "done" looks like for one type of deliverable: the
 * metadata it must carry, the assets it needs, the platform spec it
 * must meet, and the traps that specifically kill this type.
 *
 * The gates ask "has this been checked?". The recipe answers "checked
 * against what?". Without it, intake is a blank page and every producer
 * remembers a different subset.
 */

import type { DeliverableType, Workstream } from "./types.js";

export interface AssetRequirement {
  name: string;
  spec: string;
  optional?: boolean;
}

export interface Recipe {
  type: DeliverableType;
  label: string;
  defaultWorkstream: Workstream;
  /** One line: what this deliverable actually is. */
  definition: string;
  /** Metadata keys that must be populated before leaving Intake. */
  requiredMeta: string[];
  /** What the brief has to answer. */
  briefMustAnswer: string[];
  /** Physical artefacts that must exist. */
  assets: AssetRequirement[];
  /** Type-specific QA beyond the generic G3 checks. */
  qa: string[];
  /** The ways this specific type fails in production. */
  traps: string[];
  /** Typical turnaround, working days, from scoped to client review. */
  typicalDays: number;
}

const RECIPES: Recipe[] = [
  {
    type: "paid-ad",
    label: "Paid ad set",
    defaultWorkstream: "paid-media",
    definition:
      "A set of ad variants bought on a platform against one objective and one audience.",
    requiredMeta: [
      "jurisdiction",
      "region (if a state election)",
      "platforms",
      "paid = true",
      "electoralMatter",
      "authorisationText",
      "payingEntity",
      "verifiedPlatforms",
      "specialCategoryDeclared",
      "flightStart",
      "flightEnd",
    ],
    briefMustAnswer: [
      "Which strategic intent does this serve, and which Leesburg quadrant?",
      "Who is the audience, in targeting terms the platform can actually express?",
      "What is the one action — click, sign, donate, attend, turn out?",
      "What is the daily or lifetime budget, and who approved that spend?",
      "What is the objective: awareness, traffic, engagement, conversions, lead gen?",
    ],
    assets: [
      { name: "Primary text", spec: "Lead with the problem. First 125 characters decide everything." },
      { name: "Headline", spec: "Meta ≤255, Google ≤30, Pinterest ≤100. Count, do not estimate." },
      { name: "Static creative", spec: "1:1 and 4:5 at minimum; 1200×628 for link placements." },
      { name: "Vertical video", spec: "9:16, 15–30s, hook inside 3 seconds.", optional: true },
      { name: "Destination URL", spec: "Live, with tracking parameters attached." },
      { name: "Authorisation artwork", spec: "Burned into the creative, legible at feed size." },
    ],
    qa: [
      "Character counts counted per platform, not estimated",
      "CTA drawn from the platform's enum, not invented",
      "Every negative or comparative claim carries an evidence reference",
      "Authorisation is legible at the size it will actually be seen",
      "Audience is expressible under the political special ad category — no detailed interest targeting",
    ],
    traps: [
      "Advertiser verification not started early enough — it gates launch, not drafting, and takes days",
      "Interest targeting built into the plan, then stripped by the special ad category",
      "Authorisation added to the caption but not the creative, so it vanishes on crops",
      "Lifetime budget set with no end date",
    ],
    typicalDays: 3,
  },
  {
    type: "organic-social",
    label: "Organic social post",
    defaultWorkstream: "comms",
    definition: "An unpaid post to an owned channel.",
    requiredMeta: ["jurisdiction", "platforms", "paid = false", "electoralMatter"],
    briefMustAnswer: [
      "Which channel or channels, and one crosspost or separate posts?",
      "What is the hook in the first line?",
      "Is there a fixed CTA line, and does it go in the caption or the first comment?",
    ],
    assets: [
      { name: "Caption", spec: "Per-channel variants where the register differs." },
      { name: "Media", spec: "A real hosted file — never a share or preview link." },
      { name: "First comment", spec: "Pinned CTA, verbatim.", optional: true },
    ],
    qa: [
      "Media validates as the right content type for every destination",
      "File is publicly fetchable — a private file returns a login page, not a video",
      "Caption survives the platform's truncation point",
    ],
    traps: [
      "A Descript or Drive share link used as media — every platform rejects the HTML page",
      "Media over a platform size limit (Instagram 300MB) with no fallback",
      "Assuming organic content carrying electoral matter needs no authorisation — paid creator content does",
    ],
    typicalDays: 1,
  },
  {
    type: "email",
    label: "Broadcast email",
    defaultWorkstream: "comms",
    definition: "A one-to-many email to a segment of the supporter list.",
    requiredMeta: ["jurisdiction", "platforms = email", "electoralMatter"],
    briefMustAnswer: [
      "Which segment, and how many people is that?",
      "What is the subject line, and what is the preview text?",
      "What is the single action, and where does the button go?",
      "Who is the sender identity, and is it warmed?",
    ],
    assets: [
      { name: "Subject line", spec: "Plus at least one alternate for testing." },
      { name: "Preview text", spec: "Does not repeat the subject." },
      { name: "Body", spec: "Single clear action; scannable on a phone." },
      { name: "Authorisation footer", spec: "Present in the template, not just the web version." },
    ],
    qa: [
      "Test send opened on a phone before scheduling",
      "Every link resolves and carries tracking",
      "Unsubscribe present and working",
      "Merge fields render for a record with missing fields",
    ],
    traps: [
      "Merge tag renders as literal text for supporters with no first name",
      "Authorisation only on the web version, missing in the inbox",
      "Sending to the whole list when the brief said one segment",
    ],
    typicalDays: 2,
  },
  {
    type: "sms",
    label: "Broadcast SMS",
    defaultWorkstream: "field",
    definition: "A one-to-many text message, usually GOTV or event reminder.",
    requiredMeta: ["jurisdiction", "platforms = sms", "electoralMatter"],
    briefMustAnswer: [
      "Which segment, and what is the consent basis for texting them?",
      "What is the message, inside the segment limit?",
      "Is there an opt-out instruction?",
    ],
    assets: [
      { name: "Message body", spec: "Count segments — 160 GSM-7, 70 if any emoji or unicode." },
      { name: "Opt-out line", spec: "Required." },
      { name: "Authorisation", spec: "Required where the message is electoral matter." },
    ],
    qa: [
      "Segment count checked — an accidental unicode character triples the cost",
      "Link shortener resolves and is not flagged",
      "Send window respects decent hours in the recipient's timezone",
    ],
    traps: [
      "A curly apostrophe pushing the whole send from 1 segment to 2",
      "No documented consent basis for the segment",
      "Sending at 6am because the scheduler was set in UTC",
    ],
    typicalDays: 1,
  },
  {
    type: "print",
    label: "Print material",
    defaultWorkstream: "field",
    definition: "Anything physically printed: flyer, DL, poster, corflute, direct mail.",
    requiredMeta: ["jurisdiction", "region", "platforms = print", "electoralMatter"],
    briefMustAnswer: [
      "What quantity, what size, and what stock?",
      "What is the print deadline, working back from the distribution date?",
      "Is this hand-delivered, mailed or displayed?",
    ],
    assets: [
      { name: "Print-ready artwork", spec: "CMYK, 3mm bleed, outlined fonts, 300dpi." },
      { name: "Authorisation", spec: "On the artwork. For a natural person this needs a FULL STREET ADDRESS in most jurisdictions." },
      { name: "Printer quote", spec: "Accepted before the job goes to press." },
    ],
    qa: [
      "Authorisation legible at final printed size, not just on screen",
      "Bleed and trim correct — nothing important inside 5mm of the trim",
      "Proof signed off against the physical proof where the run is large",
    ],
    traps: [
      "Using the entity town-or-city authorisation form on printed matter authorised by a natural person, which needs a street address",
      "RGB artwork sent to press, colours shift",
      "Reprinting 20,000 flyers over a wrong phone number",
    ],
    typicalDays: 5,
  },
  {
    type: "video",
    label: "Video asset",
    defaultWorkstream: "comms",
    definition: "A cut and edited video: clip, testimonial, TVC, explainer.",
    requiredMeta: ["jurisdiction", "platforms", "electoralMatter", "aiGeneratedMedia"],
    briefMustAnswer: [
      "What is the duration, and what is the hook in the first three seconds?",
      "What aspect ratios are needed?",
      "Are captions burned in or supplied as a sidecar?",
    ],
    assets: [
      { name: "Exported MP4", spec: "H.264, real file, publicly fetchable. NOT a share link." },
      { name: "Aspect variants", spec: "9:16 and 1:1 at minimum for social." },
      { name: "Captions", spec: "Burned in — most viewing is sound-off." },
      { name: "Authorisation", spec: "On screen, held long enough to read." },
    ],
    qa: [
      "Media validates as video/mp4 and sits inside every destination's size limit",
      "File sharing set so the platform can actually fetch it",
      "Audio levels consistent; no clipping",
      "AI-generated or altered footage of real people disclosed",
    ],
    traps: [
      "A share.descript.com link used as the media — it is an HTML page and every platform rejects it",
      "A private Drive file, so the platform fetches a login page",
      "Authorisation on screen for under a second",
      "Missing the confirm=t parameter on a Drive direct-download URL, returning the virus-scan interstitial",
    ],
    typicalDays: 4,
  },
  {
    type: "press",
    label: "Press material",
    defaultWorkstream: "comms",
    definition: "A media release, statement, op-ed or backgrounder.",
    requiredMeta: ["jurisdiction", "electoralMatter"],
    briefMustAnswer: [
      "Who is the spokesperson, and is the quote approved by them?",
      "What is the embargo, if any?",
      "Which outlets and journalists, and who is making the call?",
    ],
    assets: [
      { name: "Release", spec: "Headline, dateline, two-paragraph lede, quotes, boilerplate, contact." },
      { name: "Approved quote", spec: "In the spokesperson's own register." },
      { name: "Media contact", spec: "A phone that will actually be answered." },
    ],
    qa: [
      "Every factual claim checkable against a cited source",
      "Quote approved by the person it is attributed to, in writing",
      "Embargo stated unambiguously or omitted entirely",
    ],
    traps: [
      "Attributing a quote nobody signed off",
      "An embargo that some outlets honour and others do not",
      "A contact number that goes to voicemail during the news cycle",
    ],
    typicalDays: 2,
  },
  {
    type: "web",
    label: "Web change",
    defaultWorkstream: "operations",
    definition: "A landing page, donation page, petition or site change.",
    requiredMeta: ["jurisdiction", "platforms = web", "electoralMatter"],
    briefMustAnswer: [
      "What is the single conversion on this page?",
      "Where does the traffic come from, and does the message match the ad?",
      "What happens after conversion — autoresponder, redirect, thank-you?",
    ],
    assets: [
      { name: "Page", spec: "Mobile-first; the action visible without scrolling." },
      { name: "Form", spec: "Fewest fields that still qualify the lead." },
      { name: "Authorisation", spec: "On the page where it is itself electoral matter." },
      { name: "Tracking", spec: "Pixel and conversion event firing." },
    ],
    qa: [
      "Tested on a real phone, not just a narrow browser window",
      "Form submits and the record lands in the CRM",
      "Autoresponder fires with correct merge fields",
      "Conversion event visible in the platform's events manager",
    ],
    traps: [
      "Ad promises one thing, the page says another, conversion collapses",
      "Pixel installed but the conversion event never configured",
      "Form writes to a list nobody is monitoring",
    ],
    typicalDays: 3,
  },
  {
    type: "event",
    label: "Event",
    defaultWorkstream: "volunteers",
    definition: "A rally, doorknock, fundraiser, webinar or supporter briefing.",
    requiredMeta: ["jurisdiction", "flightStart", "electoralMatter"],
    briefMustAnswer: [
      "What is the date, time, venue and capacity?",
      "What is the target attendance, and what is the RSVP-to-attendance ratio assumed?",
      "Who runs the room on the day?",
    ],
    assets: [
      { name: "RSVP page", spec: "Live before any promotion goes out." },
      { name: "Invite sequence", spec: "Email plus SMS reminder cadence." },
      { name: "Run sheet", spec: "Minute-by-minute, with names against each slot." },
      { name: "Day-of comms", spec: "Reminder and directions." },
    ],
    qa: [
      "RSVP page tested end to end before promotion",
      "Reminder cadence scheduled, not left manual",
      "Venue confirmed in writing with the capacity in the contract",
    ],
    traps: [
      "Promotion going out before the RSVP page is live",
      "Assuming RSVPs equal attendance — plan against a realistic ratio",
      "No named owner for the room on the day",
    ],
    typicalDays: 10,
  },
  {
    type: "research",
    label: "Research",
    defaultWorkstream: "data-research",
    definition: "Polling, opposition research, list building or analysis.",
    requiredMeta: ["jurisdiction"],
    briefMustAnswer: [
      "What decision will this research inform?",
      "What is the population, the sample and the margin of error?",
      "What is the field window?",
    ],
    assets: [
      { name: "Instrument", spec: "Questionnaire or research brief." },
      { name: "Findings", spec: "With methodology stated." },
      { name: "Source register", spec: "Every claim traceable to a document." },
    ],
    qa: [
      "Methodology stated alongside every headline number",
      "Sources archived, not just linked — pages disappear",
      "Findings separated from interpretation",
    ],
    traps: [
      "Oppo claims sourced to a link that later 404s, with no archived copy",
      "Reporting a subgroup number without its own margin of error",
    ],
    typicalDays: 10,
  },
  {
    type: "strategy-doc",
    label: "Strategy document",
    defaultWorkstream: "strategy",
    definition: "A campaign plan, messaging memo, budget or briefing.",
    requiredMeta: ["jurisdiction"],
    briefMustAnswer: [
      "Who reads this, and what do they decide after reading it?",
      "What is the time horizon?",
    ],
    assets: [
      { name: "Document", spec: "Recommendation first, reasoning after." },
      { name: "Numbers", spec: "Win number, vote goal, budget, all showing their working." },
    ],
    qa: [
      "The recommendation is on the first page",
      "Every number traceable to its source",
      "Assumptions stated explicitly",
    ],
    traps: [
      "Burying the recommendation on page nine",
      "Numbers that cannot be reproduced six weeks later",
    ],
    typicalDays: 5,
  },
  {
    type: "internal",
    label: "Internal work",
    defaultWorkstream: "operations",
    definition: "Agency-internal work with no client sign-off and no compliance gate.",
    requiredMeta: [],
    briefMustAnswer: ["What is done, and who decides that it is done?"],
    assets: [],
    qa: ["Meets the definition of done stated in the brief"],
    traps: ["Internal work quietly becoming client-facing without ever passing a gate"],
    typicalDays: 2,
  },
];

const BY_TYPE = new Map<DeliverableType, Recipe>(RECIPES.map((r) => [r.type, r]));

export function recipeFor(type: DeliverableType): Recipe | undefined {
  return BY_TYPE.get(type);
}

export function allRecipes(): Recipe[] {
  return RECIPES;
}

/** Which required metadata keys are still empty on this deliverable? */
export function missingMeta(
  type: DeliverableType,
  meta: Record<string, unknown>,
): string[] {
  const recipe = BY_TYPE.get(type);
  if (!recipe) return [];
  return recipe.requiredMeta.filter((entry) => {
    // Entries read like "paid = true" or "region (if a state election)".
    const key = entry.split(/[\s(=]/)[0];
    const v = meta[key];
    if (v === undefined || v === null || v === "") return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  });
}

/** Render the recipe as a brief scaffold for a new deliverable. */
export function renderBriefScaffold(type: DeliverableType): string {
  const r = BY_TYPE.get(type);
  if (!r) return "";
  const lines: string[] = [];
  lines.push(`## Brief — ${r.label}`);
  lines.push("");
  lines.push(`_${r.definition}_`);
  lines.push("");
  lines.push("### The brief must answer");
  for (const q of r.briefMustAnswer) lines.push(`- ${q}`);
  if (r.assets.length) {
    lines.push("");
    lines.push("### Assets");
    for (const a of r.assets) {
      lines.push(`- **${a.name}**${a.optional ? " _(optional)_" : ""} — ${a.spec}`);
    }
  }
  lines.push("");
  lines.push("### Watch for");
  for (const trap of r.traps) lines.push(`- ${trap}`);
  return lines.join("\n");
}
