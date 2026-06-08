import type { CommunityChallengeSetting } from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import type { DecryptedChallengeRequestMessageTypeWithCommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";
import type { LocalCommunity } from "@pkcprotocol/pkc-js/dist/node/runtime/node/community/local-community.js";
import * as cborg from "cborg";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ChallengeFileFactory, {
  getRequestedFlag,
  getRequestedFlagResult,
  parseFiveChanFlagSelection,
} from "../src/index.js";
import { createCountryAutoFlag, normalizeVerifiedFlag } from "../src/flags.js";
import { getPublicKeyFromPrivateKey } from "../src/pkc-js-signer.js";
import { parseOptions } from "../src/schema.js";

type MockResponseOptions = {
  ok?: boolean;
  status?: number;
  jsonThrows?: boolean;
};

const createResponse = (body: unknown, options: MockResponseOptions = {}) => {
  const { ok = true, status = 200, jsonThrows = false } = options;
  return {
    ok,
    status,
    json: jsonThrows
      ? vi.fn().mockRejectedValue(new Error("bad json"))
      : vi.fn().mockResolvedValue(body),
  };
};

const stubFetch = (...responses: Array<ReturnType<typeof createResponse>>) => {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const decodeBase64Url = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(base64, "base64");
};

const getLazyChallengeParts = (challengeUrl: string) => {
  const url = new URL(challengeUrl);
  const pathMatch = url.pathname.match(/\/iframe\/([^/]+)\/lazy$/);
  const payload = new URLSearchParams(url.hash.slice(1)).get("payload");
  if (!pathMatch?.[1] || !payload) {
    throw new Error(`Invalid lazy challenge URL: ${challengeUrl}`);
  }

  return {
    sessionId: decodeURIComponent(pathMatch[1]),
    payload: cborg.decode(decodeBase64Url(payload)) as Record<string, unknown>,
  };
};

const settings = (options: Record<string, unknown> = {}) =>
  ({
    options,
  }) as CommunityChallengeSetting;

const createCommentRequest = (flair?: unknown) =>
  ({
    comment: {
      content: "flag test",
      ...(flair !== undefined ? { flair } : {}),
      signature: {
        publicKey: "author-public-key-1",
        signature: "comment-signature-1",
      },
    },
  }) as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;

const createReplyRequest = (flairs?: unknown[]) =>
  ({
    comment: {
      content: "flag reply",
      parentCid: "parent-cid",
      postCid: "post-cid",
      ...(flairs ? { flairs } : {}),
      signature: {
        publicKey: "author-public-key-1",
        signature: "comment-signature-1",
      },
    },
  }) as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;

const createChallengeAnswerRequest = (answer: string) =>
  ({
    challengeAnswers: [answer],
    comment: {
      content: "flag answer request",
      signature: {
        publicKey: "author-public-key-1",
        signature: "comment-signature-1",
      },
    },
  }) as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;

const testPrivateKey = Buffer.alloc(32, 7).toString("base64");
let community: LocalCommunity;

beforeAll(async () => {
  const publicKey = await getPublicKeyFromPrivateKey(testPrivateKey);
  community = {
    address: "politically-incorrect.bso",
    title: "/pol/ - Politically Incorrect",
    signer: {
      privateKey: testPrivateKey,
      publicKey,
      type: "ed25519",
    },
  } as LocalCommunity;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const runChallenge = (
  request: DecryptedChallengeRequestMessageTypeWithCommunityAuthor,
  optionOverrides: Record<string, unknown> = {},
  runtimeCommunity: unknown = community,
) => {
  const challengeSettings = settings(optionOverrides);
  const challengeFile = ChallengeFileFactory(challengeSettings);
  return challengeFile.getChallenge({
    challengeSettings,
    challengeRequestMessage: request,
    challengeIndex: 0,
    community: runtimeCommunity,
  });
};

describe("5chan flag selection parsing", () => {
  it("parses country, political, and pony request formats", () => {
    expect(
      parseFiveChanFlagSelection({
        type: "country",
        code: "auto",
        text: "flag:country:auto",
      }),
    ).toMatchObject({ type: "country", code: "AUTO" });
    expect(parseFiveChanFlagSelection("pol:AC")).toMatchObject({
      type: "pol",
      code: "AC",
      label: "Anarcho-Capitalist",
    });
    expect(parseFiveChanFlagSelection("flag:pony:AJ")).toMatchObject({
      type: "pony",
      code: "AJ",
      label: "Applejack",
    });
    expect(
      parseFiveChanFlagSelection("bitsocial-flags:5chan:flag:country:auto"),
    ).toMatchObject({ type: "country", code: "AUTO" });
  });

  it("extracts explicit flag requests from comment flair fields", () => {
    expect(getRequestedFlag(createCommentRequest("flag:pol:AN"))).toMatchObject(
      {
        type: "pol",
        code: "AN",
      },
    );
    expect(
      getRequestedFlag(createReplyRequest([{ text: "flag:pony:AJ" }])),
    ).toMatchObject({
      type: "pony",
      code: "AJ",
    });
    expect(
      getRequestedFlag(
        createChallengeAnswerRequest("bitsocial-flags:5chan:flag:country:auto"),
      ),
    ).toMatchObject({ type: "country", code: "AUTO" });
  });

  it("reports where requested flags were found", () => {
    expect(
      getRequestedFlagResult(createCommentRequest("flag:pol:AN")),
    ).toMatchObject({
      status: "flag",
      source: "comment.flair",
    });
    expect(
      getRequestedFlagResult(createReplyRequest([{ text: "flag:pony:AJ" }])),
    ).toMatchObject({
      status: "flag",
      source: "comment.flairs",
    });
    expect(
      getRequestedFlagResult(
        createChallengeAnswerRequest("bitsocial-flags:5chan:flag:country:auto"),
      ),
    ).toMatchObject({
      status: "flag",
      source: "challengeAnswers",
    });
  });

  it("skips unrelated challenge answers before parsing explicit flag answers", () => {
    expect(
      getRequestedFlagResult({
        challengeAnswers: [
          "captcha-answer",
          "bitsocial-flags:5chan:flag:country:auto",
        ],
        comment: {
          content: "mixed challenge answers",
        },
      } as DecryptedChallengeRequestMessageTypeWithCommunityAuthor),
    ).toMatchObject({
      status: "flag",
      source: "challengeAnswers",
      flag: {
        type: "country",
        code: "AUTO",
      },
    });
  });

  it("reports invalid explicit flag requests in comment flairs", () => {
    expect(
      getRequestedFlagResult(createReplyRequest([{ text: "flag:pony:NOPE" }])),
    ).toMatchObject({
      status: "invalid",
      source: "comment.flairs",
      value: { text: "flag:pony:NOPE" },
    });
  });

  it("normalizes only issuer flags that match the requested selection", () => {
    const requested = parseFiveChanFlagSelection("flag:pol:AC");
    if (!requested) throw new Error("Expected requested flag");

    expect(normalizeVerifiedFlag(requested, "flag:pol:AN")).toBeUndefined();
    expect(
      normalizeVerifiedFlag(createCountryAutoFlag(), "flag:country:auto"),
    ).toBeUndefined();
  });
});

describe("Bitsocial flags challenge package", () => {
  it("exposes URL challenge metadata and option inputs", () => {
    const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);
    const options = challengeFile.optionInputs?.map((input) => input.option);

    expect(challengeFile.type).toBe("url/iframe");
    expect(challengeFile.description).toMatch(/flag/i);
    expect(options).toContain("serviceUrl");
    expect(options).toContain("issuer");
    expect(options).toContain("namespace");
    expect(options).toContain("allowedFlags");
  });

  it("accepts publications without a flag request", async () => {
    const result = await runChallenge(createCommentRequest());

    expect(result).toEqual({ success: true });
  });

  it("rejects malformed explicit flag requests", async () => {
    const result = await runChallenge(
      createCommentRequest({ type: "pol", code: "ZZ" }),
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Requested flag is not supported"),
    });
  });

  it("rejects flag families outside board configuration", async () => {
    const result = await runChallenge(createCommentRequest("flag:pony:AJ"), {
      allowedFlags: "country,pol",
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("pony is not allowed"),
    });
  });

  it("creates an issuer-backed iframe challenge for requested country flags", async () => {
    const result = await runChallenge(
      createCommentRequest({
        type: "country",
        code: "auto",
        text: "flag:country:auto",
      }),
    );

    if (!("challenge" in result)) throw new Error("Expected challenge result");

    const { payload } = getLazyChallengeParts(result.challenge);
    expect(result.type).toBe("url/iframe");
    expect(payload).toMatchObject({
      issuer: "flags.5chan.app",
      namespace: "5chan",
      profile: "5chan",
      requestedFlag: {
        type: "country",
        code: "AUTO",
        text: "flag:country:auto",
      },
      signature: {
        publicKey: expect.any(Uint8Array),
        signature: expect.any(Uint8Array),
      },
    });
  });

  it("emits immutable 5chan country data and mirrored author flairs after verification", async () => {
    const result = await runChallenge(
      createCommentRequest({
        type: "country",
        code: "auto",
        text: "flag:country:auto",
      }),
    );

    if (!("verify" in result)) throw new Error("Expected verify callback");

    const fetchMock = stubFetch(
      createResponse({
        success: true,
        country: "us",
        issuer: "flags.5chan.app",
        issuedAt: 1770000000,
        signature: {
          publicKey: "flag-service-public-key",
          signature: "flag-service-signature",
          type: "ed25519",
        },
      }),
    );

    const verified = await result.verify("");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://flags.5chan.app/api/v1/challenge/verify",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/cbor",
        }),
      }),
    );
    expect(verified).toEqual({
      success: true,
      comment: {
        "5chan": {
          country: "US",
          flag: {
            type: "country",
            code: "US",
            text: "flag:country:us",
            label: "US",
          },
          issuer: "flags.5chan.app",
          issuedAt: 1770000000,
          signature: {
            publicKey: "flag-service-public-key",
            signature: "flag-service-signature",
            type: "ed25519",
          },
        },
      },
      commentUpdate: {
        author: {
          community: {
            flairs: [
              {
                text: "flag:country:us",
                type: "country",
                code: "US",
              },
            ],
          },
        },
      },
    });
  });

  it("omits mirrored author flairs when emitFlair is disabled", async () => {
    const result = await runChallenge(
      createCommentRequest({
        type: "country",
        code: "auto",
        text: "flag:country:auto",
      }),
      { emitFlair: "off" },
    );

    if (!("verify" in result)) throw new Error("Expected verify callback");

    stubFetch(
      createResponse({
        success: true,
        country: "ca",
        issuer: "flags.5chan.app",
        signature: {
          publicKey: "flag-service-public-key",
          signature: "flag-service-signature",
          type: "ed25519",
        },
      }),
    );

    await expect(result.verify("")).resolves.toEqual({
      success: true,
      comment: {
        "5chan": {
          country: "CA",
          flag: {
            type: "country",
            code: "CA",
            text: "flag:country:ca",
            label: "CA",
          },
          issuer: "flags.5chan.app",
          issuedAt: expect.any(Number),
          signature: {
            publicKey: "flag-service-public-key",
            signature: "flag-service-signature",
            type: "ed25519",
          },
        },
      },
    });
  });

  it("accepts valid memeflags without an issuer iframe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runChallenge(createCommentRequest("flag:pol:AC"));

    expect(result).toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts valid pony flags without an issuer iframe or community signer", async () => {
    const result = await runChallenge(
      createReplyRequest([{ text: "flag:pony:AJ" }]),
      {},
      { address: "pony-posting.bso" },
    );

    expect(result).toEqual({ success: true });
  });

  it("rejects service responses that do not match a requested country flag", async () => {
    const result = await runChallenge(
      createCommentRequest({
        type: "country",
        code: "auto",
        text: "flag:country:auto",
      }),
    );

    if (!("verify" in result)) throw new Error("Expected verify callback");

    stubFetch(
      createResponse({
        success: true,
        flag: {
          type: "pol",
          code: "AC",
          issuer: "flags.5chan.app",
          signature: { signature: "signed-ac" },
        },
      }),
    );

    await expect(result.verify("")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("invalid flag assertion"),
    });
  });

  it("rejects country verification when the issuer reports failure", async () => {
    const result = await runChallenge(
      createCommentRequest({
        type: "country",
        code: "auto",
        text: "flag:country:auto",
      }),
    );

    if (!("verify" in result)) throw new Error("Expected verify callback");

    stubFetch(
      createResponse({ success: false, error: "Country unavailable." }),
    );

    await expect(result.verify("")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Country unavailable."),
    });
  });

  it("rejects country verification when the issuer request fails", async () => {
    const result = await runChallenge(
      createCommentRequest({
        type: "country",
        code: "auto",
        text: "flag:country:auto",
      }),
    );

    if (!("verify" in result)) throw new Error("Expected verify callback");

    stubFetch(
      createResponse(
        { error: "issuer offline" },
        {
          ok: false,
          status: 503,
        },
      ),
    );

    await expect(result.verify("")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Bitsocial Flags service error (503)"),
    });
  });

  it("accepts array flag-family options and rejects invalid option values", async () => {
    await expect(
      runChallenge(createCommentRequest("flag:pony:AJ"), {
        allowedFlags: ["country", "pol"],
      }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("pony is not allowed"),
    });

    expect(() => parseOptions(settings({ emitFlair: "sometimes" }))).toThrow(
      /Invalid challenge options/,
    );
  });
});
