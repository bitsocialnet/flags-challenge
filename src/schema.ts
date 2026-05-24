import type { ChallengeFileInput } from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import { z } from "zod";
import type { FiveChanFlagKind } from "./flags.js";

export const DEFAULT_SERVICE_URL = "https://flags.5chan.app/api/v1";
export const DEFAULT_ISSUER = "flags.5chan.app";
export const DEFAULT_NAMESPACE = "5chan";
export const DEFAULT_PROFILE = "5chan";
export const DEFAULT_ERROR = "Flag verification failed.";

export type ParsedOptions = {
  serviceUrl: string;
  issuer: string;
  namespace: string;
  profile: "5chan";
  allowedFlags: FiveChanFlagKind[];
  emitFlair: boolean;
  error: string;
};

type OptionName = keyof ParsedOptions;

type OptionInput = NonNullable<ChallengeFileInput["optionInputs"]>[number] & {
  option: OptionName;
};

export const optionInputs = [
  {
    option: "serviceUrl",
    label: "Service URL",
    default: DEFAULT_SERVICE_URL,
    description: "Base URL for the flag issuer service.",
    placeholder: DEFAULT_SERVICE_URL,
  },
  {
    option: "issuer",
    label: "Issuer",
    default: DEFAULT_ISSUER,
    description: "Expected issuer name in signed flag assertions.",
    placeholder: DEFAULT_ISSUER,
  },
  {
    option: "namespace",
    label: "Comment namespace",
    default: DEFAULT_NAMESPACE,
    description: "Top-level comment object key for immutable assertions.",
    placeholder: DEFAULT_NAMESPACE,
  },
  {
    option: "profile",
    label: "Flag profile",
    default: DEFAULT_PROFILE,
    description: "Flag profile to validate. This release supports 5chan.",
    placeholder: DEFAULT_PROFILE,
  },
  {
    option: "allowedFlags",
    label: "Allowed flags",
    default: "country,pol,pony",
    description: "Comma-separated flag families accepted by this board.",
    placeholder: "country,pol,pony",
  },
  {
    option: "emitFlair",
    label: "Emit flair",
    default: "true",
    description:
      "Also mirror the signed flag into commentUpdate.author.community.flairs.",
    placeholder: "true",
  },
  {
    option: "error",
    label: "Error",
    default: DEFAULT_ERROR,
    description: "Error shown when flag verification fails.",
    placeholder: DEFAULT_ERROR,
  },
] as const satisfies OptionInput[];

const optionDefaults = optionInputs.reduce(
  (acc, input) => {
    acc[input.option] = input.default;
    return acc;
  },
  {} as Record<OptionName, string>,
);

const allowedFlagValues = ["country", "pol", "pony"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getOptionDefault = (option: OptionName) => optionDefaults[option];

const resolveOptionString = (value: unknown, option: OptionName) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : getOptionDefault(option);
  }
  if (value === undefined || value === null) {
    return getOptionDefault(option);
  }
  return value;
};

const resolveOptionBoolean = (value: unknown, option: OptionName) => {
  const resolved = resolveOptionString(value, option);
  if (typeof resolved !== "string") return resolved;

  const normalized = resolved.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return resolved;
};

const resolveAllowedFlags = (value: unknown) => {
  const resolved = resolveOptionString(value, "allowedFlags");
  if (Array.isArray(resolved)) return resolved;
  if (typeof resolved !== "string") return resolved;

  return resolved
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
};

const OptionsSchema: z.ZodType<ParsedOptions> = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      serviceUrl: z.preprocess(
        (value) => resolveOptionString(value, "serviceUrl"),
        z.string().url(),
      ),
      issuer: z.preprocess(
        (value) => resolveOptionString(value, "issuer"),
        z.string().min(1),
      ),
      namespace: z.preprocess(
        (value) => resolveOptionString(value, "namespace"),
        z.string().regex(/^[A-Za-z0-9_-]+$/),
      ),
      profile: z.preprocess(
        (value) => resolveOptionString(value, "profile"),
        z.literal("5chan"),
      ),
      allowedFlags: z.preprocess(
        resolveAllowedFlags,
        z.array(z.enum(allowedFlagValues)).min(1),
      ),
      emitFlair: z.preprocess(
        (value) => resolveOptionBoolean(value, "emitFlair"),
        z.boolean(),
      ),
      error: z.preprocess(
        (value) => resolveOptionString(value, "error"),
        z.string().min(1),
      ),
    })
    .strict(),
);

export const parseOptions = (challengeSettings: unknown): ParsedOptions => {
  const options =
    isRecord(challengeSettings) && isRecord(challengeSettings.options)
      ? challengeSettings.options
      : {};
  const parsed = OptionsSchema.safeParse(options);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join("; ");
    throw new Error(`Invalid challenge options: ${message}`);
  }
  return parsed.data;
};
