import type { DecryptedChallengeRequestMessageTypeWithCommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";

export type FiveChanFlagKind = "country" | "pol" | "pony";

export type RequestedFlag = {
  profile: "5chan";
  type: FiveChanFlagKind;
  code: string;
  text: string;
  label: string;
};

export type VerifiedFlag = RequestedFlag & {
  issuer: string;
  issuedAt: number;
  signature: Record<string, unknown>;
};

export type FlagAssertion = {
  flag: {
    type: FiveChanFlagKind;
    code: string;
    text: string;
    label: string;
  };
  issuer: string;
  issuedAt: number;
  signature: Record<string, unknown>;
  country?: string;
  memeflag?: string;
  pony?: string;
};

export type RequestedFlagResult =
  | { status: "none" }
  | { status: "invalid"; value: unknown }
  | { status: "flag"; flag: RequestedFlag };

const POLITICAL_FLAG_ENTRIES = [
  ["AC", "Anarcho-Capitalist"],
  ["AN", "Anarchist"],
  ["BL", "Black Nationalist"],
  ["CF", "Confederate"],
  ["CM", "Communist"],
  ["CT", "Catalonia"],
  ["DM", "Democrat"],
  ["EU", "European"],
  ["FC", "Fascist"],
  ["GN", "Gadsden"],
  ["GY", "Gay"],
  ["JH", "Jihadi"],
  ["KN", "Kekistani"],
  ["MF", "Muslim"],
  ["NB", "National Bolshevik"],
  ["NT", "NATO"],
  ["NZ", "Nazi"],
  ["PC", "Hippie"],
  ["PR", "Pirate"],
  ["RE", "Republican"],
  ["TM", "Templar"],
  ["MZ", "Task Force Z"],
  ["TR", "Tree Hugger"],
  ["UN", "United Nations"],
  ["WP", "White Supremacist"],
] as const;

const PONY_FLAG_ENTRIES = [
  ["4CC", "4cc /mlp/"],
  ["ADA", "Adagio Dazzle"],
  ["AN", "Anon"],
  ["ANF", "Anonfilly"],
  ["APB", "Apple Bloom"],
  ["AJ", "Applejack"],
  ["AB", "Aria Blaze"],
  ["AU", "Autumn Blaze"],
  ["BB", "Bon Bon"],
  ["BM", "Big Mac"],
  ["BP", "Berry Punch"],
  ["BS", "Babs Seed"],
  ["CL", "Changeling"],
  ["CO", "Coco Pommel"],
  ["CG", "Cozy Glow"],
  ["CHE", "Cheerilee"],
  ["CB", "Cherry Berry"],
  ["DAY", "Daybreaker"],
  ["DD", "Daring Do"],
  ["DER", "Derpy Hooves"],
  ["DT", "Diamond Tiara"],
  ["DIS", "Discord"],
  ["EQA", "EqG Applejack"],
  ["EQF", "EqG Fluttershy"],
  ["EQP", "EqG Pinkie Pie"],
  ["EQR", "EqG Rainbow Dash"],
  ["EQT", "EqG Trixie"],
  ["EQI", "EqG Twilight Sparkle"],
  ["EQS", "EqG Sunset Shimmer"],
  ["ERA", "EqG Rarity"],
  ["FAU", "Fausticorn"],
  ["FLE", "Fleur de lis"],
  ["FL", "Fluttershy"],
  ["GI", "Gilda"],
  ["HT", "Hitch Trailblazer"],
  ["IZ", "Izzy Moonbow"],
  ["LI", "Limestone"],
  ["LT", "Lord Tirek"],
  ["LY", "Lyra Heartstrings"],
  ["MA", "Marble"],
  ["MAU", "Maud"],
  ["MIN", "Minuette"],
  ["NI", "Nightmare Moon"],
  ["NUR", "Nurse Redheart"],
  ["OCT", "Octavia"],
  ["PAR", "Parasprite"],
  ["PC", "Princess Cadance"],
  ["PCE", "Princess Celestia"],
  ["PI", "Pinkie Pie"],
  ["PLU", "Princess Luna"],
  ["PM", "Pinkamena"],
  ["PP", "Pipp Petals"],
  ["QC", "Queen Chrysalis"],
  ["RAR", "Rarity"],
  ["RD", "Rainbow Dash"],
  ["RLU", "Roseluck"],
  ["S1L", "S1 Luna"],
  ["SCO", "Scootaloo"],
  ["SHI", "Shining Armor"],
  ["SIL", "Silver Spoon"],
  ["SON", "Sonata Dusk"],
  ["SP", "Spike"],
  ["SPI", "Spitfire"],
  ["SS", "Sunny Starscout"],
  ["STA", "Star Dancer"],
  ["STL", "Starlight Glimmer"],
  ["SPT", "Sprout"],
  ["SUN", "Sunburst"],
  ["SUS", "Sunset Shimmer"],
  ["SWB", "Sweetie Belle"],
  ["TFA", "TFH Arizona"],
  ["TFO", "TFH Oleander"],
  ["TFP", "TFH Paprika"],
  ["TFS", "TFH Shanty"],
  ["TFT", "TFH Tianhuo"],
  ["TFV", "TFH Velvet"],
  ["TP", "TFH Pom"],
  ["TS", "Tempest Shadow"],
  ["TWI", "Twilight Sparkle"],
  ["TX", "Trixie"],
  ["VS", "Vinyl Scratch"],
  ["ZE", "Zecora"],
  ["ZS", "Zipp Storm"],
] as const;

const POLITICAL_FLAGS = new Map<string, string>(POLITICAL_FLAG_ENTRIES);
const PONY_FLAGS = new Map<string, string>(PONY_FLAG_ENTRIES);
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const FLAG_TEXT_PATTERN =
  /^(?:flag:)?(country|geo|pol|political|meme|memeflag|memeflags|pony|mlp):([a-z0-9-]+)$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizeKind = (
  value: string | undefined,
): FiveChanFlagKind | undefined => {
  const kind = value?.trim().toLowerCase();
  if (kind === "country" || kind === "geo") return "country";
  if (
    kind === "pol" ||
    kind === "political" ||
    kind === "meme" ||
    kind === "memeflag" ||
    kind === "memeflags"
  ) {
    return "pol";
  }
  if (kind === "pony" || kind === "mlp") return "pony";
  return undefined;
};

const normalizeCode = (kind: FiveChanFlagKind, value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return kind === "country" ? trimmed.toUpperCase() : trimmed.toUpperCase();
};

const countryLabel = (code: string) =>
  code === "AUTO" ? "Geographic Location" : code;

const getBoardFlagLabel = (kind: FiveChanFlagKind, code: string) => {
  if (kind === "pol") return POLITICAL_FLAGS.get(code);
  if (kind === "pony") return PONY_FLAGS.get(code);
  return undefined;
};

export const createCountryAutoFlag = (): RequestedFlag => ({
  profile: "5chan",
  type: "country",
  code: "AUTO",
  text: "flag:country:auto",
  label: "Geographic Location",
});

export const getFiveChanFlag = (
  kindValue: string | undefined,
  codeValue: string | undefined,
): RequestedFlag | undefined => {
  const kind = normalizeKind(kindValue);
  if (!kind) return undefined;

  const code = normalizeCode(kind, codeValue);
  if (!code) return undefined;

  if (kind === "country") {
    if (code !== "AUTO" && !COUNTRY_CODE_PATTERN.test(code)) return undefined;
    return {
      profile: "5chan",
      type: "country",
      code,
      text: `flag:country:${code.toLowerCase()}`,
      label: countryLabel(code),
    };
  }

  const label = getBoardFlagLabel(kind, code);
  return label
    ? {
        profile: "5chan",
        type: kind,
        code,
        text: `flag:${kind}:${code}`,
        label,
      }
    : undefined;
};

export const parseFiveChanFlagSelection = (
  value: unknown,
): RequestedFlag | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "none") return undefined;
    const match = trimmed.match(FLAG_TEXT_PATTERN);
    return match ? getFiveChanFlag(match[1], match[2]) : undefined;
  }

  if (!isRecord(value)) return undefined;

  const textFlag = parseFiveChanFlagSelection(stringValue(value.text));
  if (textFlag) return textFlag;

  return getFiveChanFlag(
    stringValue(value.type) ?? stringValue(value.kind),
    stringValue(value.code) ?? stringValue(value.country),
  );
};

const hasExplicitFlagSelection = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 && trimmed !== "none";
  }

  return value !== undefined && value !== null;
};

const getPublication = (
  request: DecryptedChallengeRequestMessageTypeWithCommunityAuthor,
) => {
  if (isRecord(request.comment)) return request.comment;
  if (isRecord(request.commentEdit)) return request.commentEdit;
  return undefined;
};

export const getRequestedFlagResult = (
  request: DecryptedChallengeRequestMessageTypeWithCommunityAuthor,
): RequestedFlagResult => {
  const publication = getPublication(request);
  if (!publication) return { status: "none" };

  for (const candidate of [publication.flag, publication.flair]) {
    const flag = parseFiveChanFlagSelection(candidate);
    if (flag) return { status: "flag", flag };
    if (hasExplicitFlagSelection(candidate)) {
      return { status: "invalid", value: candidate };
    }
  }

  if (Array.isArray(publication.flairs)) {
    for (const flair of publication.flairs) {
      const flag = parseFiveChanFlagSelection(flair);
      if (flag) return { status: "flag", flag };
      if (hasExplicitFlagSelection(flair)) {
        return { status: "invalid", value: flair };
      }
    }
  }

  return { status: "none" };
};

export const getRequestedFlag = (
  request: DecryptedChallengeRequestMessageTypeWithCommunityAuthor,
): RequestedFlag | undefined => {
  const result = getRequestedFlagResult(request);
  return result.status === "flag" ? result.flag : undefined;
};

export const normalizeVerifiedFlag = (
  requested: RequestedFlag,
  value: unknown,
): RequestedFlag | undefined => {
  const flag = parseFiveChanFlagSelection(value);
  if (!flag) return undefined;

  if (requested.type === "country" && requested.code === "AUTO") {
    return flag.type === "country" && flag.code !== "AUTO" ? flag : undefined;
  }

  return flag.type === requested.type && flag.code === requested.code
    ? flag
    : undefined;
};

export const createFiveChanAssertion = (flag: VerifiedFlag): FlagAssertion => ({
  flag: {
    type: flag.type,
    code: flag.code,
    text: flag.text,
    label: flag.label,
  },
  issuer: flag.issuer,
  issuedAt: flag.issuedAt,
  signature: flag.signature,
  ...(flag.type === "country" ? { country: flag.code } : {}),
  ...(flag.type === "pol" ? { memeflag: flag.code } : {}),
  ...(flag.type === "pony" ? { pony: flag.code } : {}),
});
