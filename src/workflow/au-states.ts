/**
 * Australian state and territory electoral authorisation regimes.
 *
 * These layer ON TOP of the Commonwealth Electoral Act regime. A state
 * election is governed by its own Act and its own commission, and the
 * requirements genuinely differ — most importantly on whether a PO Box
 * is an acceptable address, which is the single most common way a
 * federal-form authorisation fails when reused on a state ad.
 *
 * Where a rule could not be verified from the commission's published
 * material, it is marked `verified: false` and the engine emits an
 * explicit "confirm with the commission" warning. Encoding a guess about
 * a legal requirement is worse than admitting the gap.
 *
 * Policy state: mid-2026. Re-verify before a policy-sensitive launch.
 */

export const AU_REGIONS = [
  "SA",
  "NSW",
  "VIC",
  "QLD",
  "WA",
  "TAS",
  "ACT",
  "NT",
] as const;
export type AuRegion = (typeof AU_REGIONS)[number];

export type PoBoxRule = "allowed" | "prohibited" | "unverified";

export interface AuStateRegime {
  region: AuRegion;
  commission: string;
  commissionAbbrev: string;
  act: string;
  /** Is a PO Box acceptable in place of a street address? */
  poBox: PoBoxRule;
  /** Extra particulars beyond name + address. */
  extraParticulars: string[];
  /** Notes surfaced to the operator. */
  notes: string[];
  /** Maximum penalty, where published. */
  penalty?: string;
  /** Does the obligation run outside the election period? */
  alwaysOn?: boolean;
  /** Have these details been verified against published material? */
  verified: boolean;
}

export const AU_STATE_REGIMES: Record<AuRegion, AuStateRegime> = {
  SA: {
    region: "SA",
    commission: "Electoral Commission South Australia",
    commissionAbbrev: "ECSA",
    act: "Electoral Act 1985 (SA) s 112",
    poBox: "prohibited",
    extraParticulars: [
      "name and street address of the authoriser",
      "for a registered party or endorsed candidate: the party's name or registered abbreviation",
      "for a relevant third party: the name of that third party",
    ],
    notes: [
      "A PO Box cannot be used. Independent candidates may use a PO Box only with the Electoral Commissioner's approval, and must add the suburb where the candidate lives at the end of the advertisement.",
      "Small items — stickers, badges, lapel buttons, pens, pencils, balloons — are exempt.",
      "Applies to advertisements whether printed or published online.",
    ],
    penalty: "Maximum $5,000 (individual) / $10,000 (body corporate)",
    verified: true,
  },
  NSW: {
    region: "NSW",
    commission: "NSW Electoral Commission",
    commissionAbbrev: "NSWEC",
    act: "Electoral Act 2017 (NSW)",
    poBox: "prohibited",
    extraParticulars: ["name and street address of the authoriser"],
    notes: [
      "A PO Box cannot be used.",
      "Electoral material must not appear to be an official communication from the NSWEC, or to have been authorised by it.",
      "Electoral material distributed on election day must be registered with the NSWEC.",
    ],
    verified: true,
  },
  VIC: {
    region: "VIC",
    commission: "Victorian Electoral Commission",
    commissionAbbrev: "VEC",
    act: "Electoral Act 2002 (Vic) s 83",
    poBox: "allowed",
    extraParticulars: [
      "name and address of the person who authorised the material, clearly displayed on its face",
    ],
    notes: [
      "The address may be a street address or a PO Box — but never an email address.",
      "The authoriser must be aged 18 or over.",
      "The obligation is ongoing: it applies outside the election period too, not only during a campaign.",
    ],
    alwaysOn: true,
    verified: true,
  },
  QLD: {
    region: "QLD",
    commission: "Electoral Commission of Queensland",
    commissionAbbrev: "ECQ",
    act: "Electoral Act 1992 (Qld)",
    poBox: "allowed",
    extraParticulars: ["name and address of the person authorising the material"],
    notes: [
      "The address may be a residential address, a business address or a PO Box — a recent amendment expressly permits PO Boxes.",
      "The authoriser must be contactable at the address listed.",
      "How-to-vote cards must be approved by the ECQ before a registered party or endorsed candidate may distribute them on election day.",
    ],
    verified: true,
  },
  WA: {
    region: "WA",
    commission: "Western Australian Electoral Commission",
    commissionAbbrev: "WAEC",
    act: "Electoral Act 1907 (WA)",
    poBox: "unverified",
    extraParticulars: [
      "name and address of the authoriser, at the end of the material",
    ],
    notes: [
      "Authorisation is required once the writs have been issued, for material intended, calculated or likely to affect voting.",
      "Applies regardless of who publishes it, and to printed and electronic form alike.",
      "A newspaper advertisement that only announces the holding of a meeting is excepted.",
      "The Act was substantially amended in November 2023 — confirm the current form of the authorisation provision before relying on it.",
    ],
    verified: false,
  },
  TAS: {
    region: "TAS",
    commission: "Tasmanian Electoral Commission",
    commissionAbbrev: "TEC",
    act: "Electoral Act 2004 (Tas)",
    poBox: "unverified",
    extraParticulars: ["name and address of the authoriser"],
    notes: [
      "Tasmania operates its own authorisation regime and separate rules on election advertising during the regulated period.",
      "Details not verified here — confirm with the TEC before publishing.",
    ],
    verified: false,
  },
  ACT: {
    region: "ACT",
    commission: "Elections ACT",
    commissionAbbrev: "Elections ACT",
    act: "Electoral Act 1992 (ACT)",
    poBox: "unverified",
    extraParticulars: ["name and address of the authoriser"],
    notes: [
      "The ACT runs its own authorisation regime, and has additional rules on electoral expenditure and campaign material.",
      "Details not verified here — confirm with Elections ACT before publishing.",
    ],
    verified: false,
  },
  NT: {
    region: "NT",
    commission: "Northern Territory Electoral Commission",
    commissionAbbrev: "NTEC",
    act: "Electoral Act 2004 (NT)",
    poBox: "unverified",
    extraParticulars: ["name and address of the authoriser"],
    notes: [
      "The NT runs its own authorisation regime.",
      "Details not verified here — confirm with the NTEC before publishing.",
    ],
    verified: false,
  },
};

export function auRegime(region: string | undefined | null): AuStateRegime | undefined {
  if (!region) return undefined;
  const key = region.trim().toUpperCase() as AuRegion;
  return AU_STATE_REGIMES[key];
}

/* ------------------------------------------------------------------ */
/* Address-form detection                                              */
/* ------------------------------------------------------------------ */

const PO_BOX = /\b(P\.?\s?O\.?\s*BOX|POST\s+OFFICE\s+BOX|G\.?P\.?O\.?\s*BOX|LOCKED\s+BAG|PRIVATE\s+BAG)\b/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
/** A street address needs a number followed by a word — "14 Station Road". */
const STREET_NUMBER = /\b\d+[a-z]?\s*[/-]?\s*\d*\s+[A-Za-z]/;

export interface AddressAnalysis {
  hasPoBox: boolean;
  hasEmail: boolean;
  looksLikeStreetAddress: boolean;
}

export function analyseAuthorisationAddress(text: string): AddressAnalysis {
  return {
    hasPoBox: PO_BOX.test(text),
    hasEmail: EMAIL.test(text),
    looksLikeStreetAddress: STREET_NUMBER.test(text),
  };
}

/** Render the region matrix for reference tooling. */
export function auStateMatrix(): AuStateRegime[] {
  return AU_REGIONS.map((r) => AU_STATE_REGIMES[r]);
}
