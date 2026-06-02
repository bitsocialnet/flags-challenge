import { randomUUID } from "node:crypto";
import { format } from "node:util";
import * as cborg from "cborg";
import Logger from "@pkcprotocol/pkc-logger";
import type {
  ChallengeFileInput,
  ChallengeInput,
  ChallengeResultInput,
  GetChallengeArgs,
} from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import { z } from "zod";
import {
  createFiveChanAssertion,
  getRequestedFlag,
  getRequestedFlagResult,
  normalizeVerifiedFlag,
  parseFiveChanFlagSelection,
  type RequestedFlag,
  type VerifiedFlag,
} from "./flags.js";
import {
  DEFAULT_ERROR,
  optionInputs,
  parseOptions,
  type ParsedOptions,
} from "./schema.js";
import { signBufferEd25519 } from "./pkc-js-signer.js";

const log = Logger("bitsocial:community:challenge:flags");
const LOGGER_NAMESPACE = "bitsocial:community:challenge:flags";
const FLAG_CHALLENGE_ANSWER_PREFIX = "bitsocial-flags:5chan:";
const LEGACY_RUNTIME_COMMUNITY_KEY = String.fromCharCode(
  115,
  117,
  98,
  112,
  108,
  101,
  98,
  98,
  105,
  116,
);

const type: ChallengeInput["type"] = "url/iframe";
const description = "Add verified flag assertions to Bitsocial comments.";

type RuntimeCommunity = {
  address?: string;
  title?: string;
  signer?: {
    privateKey?: string;
    publicKey?: string;
    type?: string;
  };
};

const VerifyResponseSchema = z.union([
  z
    .object({
      success: z.literal(true),
      flag: z.unknown().optional(),
      country: z.string().optional(),
      issuer: z.string().optional(),
      issuedAt: z.number().int().nonnegative().optional(),
      signature: z.record(z.string(), z.unknown()).optional(),
    })
    .loose(),
  z
    .object({
      success: z.literal(false),
      error: z.string().optional(),
    })
    .loose(),
]);

type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const shouldWriteConsoleLogs = () =>
  process.env.NODE_ENV !== "test" && !process.env.VITEST;

const writeConsoleLog = (
  level: "info" | "error",
  formatter: string,
  ...args: unknown[]
) => {
  if (!shouldWriteConsoleLogs()) return;
  console[level](`${LOGGER_NAMESPACE} ${format(formatter, ...args)}`);
};

const logInfo = (formatter: string, ...args: unknown[]) => {
  log(formatter, ...args);
  writeConsoleLog("info", formatter, ...args);
};

const logError = (formatter: string, ...args: unknown[]) => {
  log.error(formatter, ...args);
  writeConsoleLog("error", formatter, ...args);
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const nowSeconds = () => Math.floor(Date.now() / 1000);

const toBase64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64url");

const createLazyChallengeUrl = ({
  serviceUrl,
  sessionId,
  payload,
}: {
  serviceUrl: string;
  sessionId: string;
  payload: unknown;
}) =>
  `${trimTrailingSlash(serviceUrl)}/iframe/${encodeURIComponent(
    sessionId,
  )}/lazy#payload=${toBase64Url(cborg.encode(payload))}`;

const getRuntimeCommunity = (
  args: GetChallengeArgs,
): RuntimeCommunity | undefined => {
  if ("community" in args && isRecord(args.community)) {
    return args.community as RuntimeCommunity;
  }

  const legacyCommunity = (args as Record<string, unknown>)[
    LEGACY_RUNTIME_COMMUNITY_KEY
  ];
  return isRecord(legacyCommunity)
    ? (legacyCommunity as RuntimeCommunity)
    : undefined;
};

const getCommunityLabel = (community: RuntimeCommunity | undefined) =>
  stringValue(community?.address) ?? stringValue(community?.title) ?? "unknown";

const getRequestPublication = (
  request: unknown,
):
  | {
      publicationType: "comment" | "commentEdit";
      publication: Record<string, unknown>;
    }
  | undefined => {
  if (!isRecord(request)) return undefined;
  if (isRecord(request.comment)) {
    return { publicationType: "comment", publication: request.comment };
  }
  if (isRecord(request.commentEdit)) {
    return {
      publicationType: "commentEdit",
      publication: request.commentEdit,
    };
  }
  return undefined;
};

const getChallengeAnswers = (request: unknown): unknown[] =>
  isRecord(request) && Array.isArray(request.challengeAnswers)
    ? request.challengeAnswers
    : [];

const hasDefinedProperty = (
  record: Record<string, unknown> | undefined,
  key: string,
) =>
  record !== undefined &&
  Object.prototype.hasOwnProperty.call(record, key) &&
  record[key] !== undefined &&
  record[key] !== null;

const hasExplicitFlagAnswer = (answer: unknown) =>
  typeof answer === "string" &&
  answer.trim().toLowerCase().startsWith(FLAG_CHALLENGE_ANSWER_PREFIX);

const summarizeChallengeRequest = (request: unknown) => {
  const requestRecord = recordValue(request);
  const challengeAnswers = getChallengeAnswers(request);
  const publicationInfo = getRequestPublication(request);
  const publication = publicationInfo?.publication;
  const flairs = Array.isArray(publication?.flairs)
    ? publication.flairs
    : undefined;

  return {
    hasComment: Boolean(recordValue(requestRecord?.comment)),
    hasCommentEdit: Boolean(recordValue(requestRecord?.commentEdit)),
    challengeAnswerCount: challengeAnswers.length,
    explicitFlagAnswerCount: challengeAnswers.filter(hasExplicitFlagAnswer)
      .length,
    publicationType: publicationInfo?.publicationType,
    hasPublicationFlag: hasDefinedProperty(publication, "flag"),
    hasPublicationFlair: hasDefinedProperty(publication, "flair"),
    publicationFlairsCount: flairs?.length ?? 0,
    hasCommunityName: Boolean(stringValue(publication?.communityName)),
    hasCommunityPublicKey: Boolean(
      stringValue(publication?.communityPublicKey),
    ),
    parentCidPresent: Boolean(stringValue(publication?.parentCid)),
    postCidPresent: Boolean(stringValue(publication?.postCid)),
    signaturePresent: Boolean(recordValue(publication?.signature)),
  };
};

const summarizeFlag = (flag: RequestedFlag | VerifiedFlag) => ({
  type: flag.type,
  code: flag.code,
  text: flag.text,
  label: flag.label,
});

const summarizeInvalidFlagValue = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") {
    return {
      kind: "string",
      length: value.length,
      hasFlagPrefix: hasExplicitFlagAnswer(value),
    };
  }

  if (Array.isArray(value)) {
    return { kind: "array", length: value.length };
  }

  if (isRecord(value)) {
    return { kind: "object", keys: Object.keys(value).sort().slice(0, 10) };
  }

  return { kind: value === null ? "null" : typeof value };
};

const createRequestSignature = async (
  propsToSign: Record<string, unknown>,
  signer: NonNullable<RuntimeCommunity["signer"]>,
) => {
  if (!signer.privateKey || !signer.publicKey || !signer.type) {
    throw new Error("Community signer is missing required fields");
  }

  const encoded = cborg.encode(propsToSign);
  const signatureBuffer = await signBufferEd25519(encoded, signer.privateKey);
  return {
    signature: signatureBuffer,
    publicKey: uint8ArrayFromString(signer.publicKey, "base64"),
    type: signer.type,
    signedPropertyNames: Object.keys(propsToSign),
  };
};

const postCbor = async (url: string, body: unknown): Promise<unknown> => {
  const encoded = cborg.encode(body);
  log.trace("POST %s request body (CBOR, %d bytes)", url, encoded.length);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/cbor",
      "ngrok-skip-browser-warning": "true",
    },
    body: Buffer.from(encoded),
  });

  let responseBody: unknown;
  try {
    responseBody = (await response.json()) as unknown;
  } catch {
    responseBody = undefined;
  }

  log.trace(
    "POST %s response status=%d body=%o",
    url,
    response.status,
    responseBody,
  );

  if (!response.ok) {
    const details =
      responseBody !== undefined ? `: ${JSON.stringify(responseBody)}` : "";
    throw new Error(
      `Bitsocial Flags service error (${response.status})${details}`,
    );
  }

  if (responseBody === undefined) {
    throw new Error("Invalid JSON response from Bitsocial Flags service");
  }

  return responseBody;
};

const reject = (
  options: ParsedOptions,
  message: string,
): ChallengeResultInput => ({
  success: false,
  error: `${options.error || DEFAULT_ERROR} ${message}`,
});

const allow = (): ChallengeResultInput => ({ success: true });

const isAllowed = (flag: RequestedFlag, options: ParsedOptions) =>
  options.allowedFlags.includes(flag.type);

const getVerifyResponseFlagInput = (
  response: Extract<VerifyResponse, { success: true }>,
) => {
  if (response.flag !== undefined) return response.flag;
  if (response.country) {
    return {
      type: "country",
      code: response.country,
      text: `flag:country:${response.country}`,
    };
  }
  return undefined;
};

const getVerifiedFlag = (
  requested: RequestedFlag,
  response: Extract<VerifyResponse, { success: true }>,
  options: ParsedOptions,
): VerifiedFlag | undefined => {
  const responseFlag = recordValue(response.flag);
  const normalized = normalizeVerifiedFlag(
    requested,
    getVerifyResponseFlagInput(response),
  );
  if (!normalized) return undefined;

  const issuer =
    stringValue(responseFlag?.issuer) ??
    stringValue(response.issuer) ??
    options.issuer;
  if (issuer !== options.issuer) return undefined;

  const issuedAt =
    numberValue(responseFlag?.issuedAt) ??
    numberValue(response.issuedAt) ??
    nowSeconds();
  const signature =
    recordValue(responseFlag?.signature) ?? recordValue(response.signature);
  if (!signature) return undefined;

  return {
    ...normalized,
    issuer,
    issuedAt,
    signature,
  };
};

const buildResult = (
  flag: VerifiedFlag,
  options: ParsedOptions,
): ChallengeResultInput => ({
  success: true,
  comment: {
    [options.namespace]: createFiveChanAssertion(flag),
  },
  ...(options.emitFlair
    ? {
        commentUpdate: {
          author: {
            community: {
              flairs: [
                {
                  text: flag.text,
                  type: flag.type,
                  code: flag.code,
                },
              ],
            },
          },
        },
      }
    : {}),
});

const parseVerifyResponse = (data: unknown): VerifyResponse => {
  const parsed = VerifyResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid verify response from Bitsocial Flags service: ${parsed.error.message}`,
    );
  }
  return parsed.data;
};

const getChallenge = async (
  args: GetChallengeArgs,
): Promise<ChallengeInput | ChallengeResultInput> => {
  const { challengeRequestMessage, challengeSettings } = args;
  const options = parseOptions(challengeSettings);
  const runtimeCommunity = getRuntimeCommunity(args);
  const communityLabel = getCommunityLabel(runtimeCommunity);
  const requestSummary = summarizeChallengeRequest(challengeRequestMessage);
  const requestedFlagResult = getRequestedFlagResult(challengeRequestMessage);
  logInfo(
    "getChallenge community=%s allowedFlags=%o request=%o",
    communityLabel,
    options.allowedFlags,
    requestSummary,
  );

  if (requestedFlagResult.status === "none") {
    logInfo(
      "No requested flag found; allowing without iframe. community=%s request=%o",
      communityLabel,
      requestSummary,
    );
    return allow();
  }

  if (requestedFlagResult.status === "invalid") {
    logError(
      "Invalid requested flag; rejecting. community=%s source=%s invalid=%o request=%o",
      communityLabel,
      requestedFlagResult.source,
      summarizeInvalidFlagValue(requestedFlagResult.value),
      requestSummary,
    );
    return reject(options, "Requested flag is not supported.");
  }

  const { flag: requestedFlag, source: requestedFlagSource } =
    requestedFlagResult;
  logInfo(
    "Requested flag found. community=%s source=%s flag=%o",
    communityLabel,
    requestedFlagSource,
    summarizeFlag(requestedFlag),
  );

  if (!isAllowed(requestedFlag, options)) {
    logError(
      "Requested flag family is not allowed; rejecting. community=%s source=%s flag=%o allowedFlags=%o",
      communityLabel,
      requestedFlagSource,
      summarizeFlag(requestedFlag),
      options.allowedFlags,
    );
    return reject(options, `Flag family ${requestedFlag.type} is not allowed.`);
  }

  const signer = runtimeCommunity?.signer;
  if (!signer) {
    logError(
      "Community signer missing; rejecting flag challenge. community=%s source=%s flag=%o",
      communityLabel,
      requestedFlagSource,
      summarizeFlag(requestedFlag),
    );
    return reject(options, "Community signer is required.");
  }

  const sessionId = randomUUID();
  const evaluateTimestamp = nowSeconds();
  const evaluatePropsToSign = {
    challengeRequest: challengeRequestMessage,
    issuer: options.issuer,
    namespace: options.namespace,
    profile: options.profile,
    requestedFlag,
    sessionId,
    timestamp: evaluateTimestamp,
  };
  const evaluateSignature = await createRequestSignature(
    evaluatePropsToSign,
    signer,
  );
  const challengeUrl = createLazyChallengeUrl({
    serviceUrl: options.serviceUrl,
    sessionId,
    payload: {
      ...evaluatePropsToSign,
      signature: evaluateSignature,
    },
  });
  logInfo(
    "Returning flag iframe challenge. community=%s sessionId=%s source=%s flag=%o",
    communityLabel,
    sessionId,
    requestedFlagSource,
    summarizeFlag(requestedFlag),
  );

  const verify = async (_answer: string): Promise<ChallengeResultInput> => {
    logInfo(
      "Verifying flag challenge. community=%s sessionId=%s requestedFlag=%o",
      communityLabel,
      sessionId,
      summarizeFlag(requestedFlag),
    );
    const verifyTimestamp = nowSeconds();
    const verifyPropsToSign = { sessionId, timestamp: verifyTimestamp };
    const signature = await createRequestSignature(verifyPropsToSign, signer);

    let verifyResponse: VerifyResponse;
    try {
      verifyResponse = parseVerifyResponse(
        await postCbor(
          `${trimTrailingSlash(options.serviceUrl)}/challenge/verify`,
          {
            ...verifyPropsToSign,
            signature,
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logError(
        "Failed to verify flag challenge. community=%s sessionId=%s error=%s",
        communityLabel,
        sessionId,
        message,
      );
      return reject(options, message);
    }

    if (!verifyResponse.success) {
      logError(
        "Flag issuer verification failed. community=%s sessionId=%s error=%s",
        communityLabel,
        sessionId,
        verifyResponse.error || "Challenge not completed.",
      );
      return reject(
        options,
        verifyResponse.error || "Challenge not completed.",
      );
    }

    const verifiedFlag = getVerifiedFlag(
      requestedFlag,
      verifyResponse,
      options,
    );
    if (!verifiedFlag) {
      logError(
        "Flag issuer returned invalid assertion. community=%s sessionId=%s requestedFlag=%o",
        communityLabel,
        sessionId,
        summarizeFlag(requestedFlag),
      );
      return reject(options, "Issuer returned an invalid flag assertion.");
    }

    logInfo(
      "Flag verification succeeded. community=%s sessionId=%s verifiedFlag=%o emitFlair=%s",
      communityLabel,
      sessionId,
      summarizeFlag(verifiedFlag),
      String(options.emitFlair),
    );
    return buildResult(verifiedFlag, options);
  };

  return { challenge: challengeUrl, verify, type };
};

function ChallengeFileFactory(
  _communityChallengeSettings: GetChallengeArgs["challengeSettings"],
): ChallengeFileInput {
  return { getChallenge, optionInputs, type, description };
}

export {
  createFiveChanAssertion,
  getRequestedFlag,
  getRequestedFlagResult,
  parseFiveChanFlagSelection,
} from "./flags.js";
export default ChallengeFileFactory;
