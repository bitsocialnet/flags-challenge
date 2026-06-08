[![Coverage](https://img.shields.io/endpoint?url=https://bitsocialnet.github.io/flags-challenge/badges/coverage.json)](https://github.com/bitsocialnet/flags-challenge/blob/master/scripts/write-coverage-badge.mjs)

# @bitsocial/flags-challenge

Verified flag issuer challenge for Bitsocial communities and clients.

This package runs on a Bitsocial community owner node as a challenge. It is not specific to 5chan: any Bitsocial client can use the same challenge pattern with its own issuer service, namespace, and flag profile. The first bundled profile is the 5chan profile. Country flags are issued by `flags.5chan.app`; `/pol/` memeflags and `/mlp/` pony flags are validated as board-choice flairs without an issuer iframe.

For issuer-verified country flags, the challenge writes two pieces of data:

- immutable comment data under a client namespace such as `comment["5chan"]`;
- a compatibility mirror under `commentUpdate.author.community.flairs`, so clients that already render author flairs can show the same flag.

For `/pol/` memeflags and `/mlp/` pony flags, clients should publish the selected flag as normal comment flair data. The challenge validates that the requested family is allowed and that the code is known, then accepts the publication without contacting the issuer service.

The namespace is configurable. For example, a future Seedit profile could write to `comment["seedit"]` while using its own issuer and flag metadata.

## Installation

Run this on the Bitsocial node that owns the community:

```bash
bitsocial challenge install @bitsocial/flags-challenge
```

## Configuration

Add the challenge to the community's `settings.challenges`:

```js
[{ name: "@bitsocial/flags-challenge" }];
```

Default options use the first bundled profile and target the 5chan issuer:

| Option         | Default                          | Behavior                                              |
| -------------- | -------------------------------- | ----------------------------------------------------- |
| `serviceUrl`   | `https://flags.5chan.app/api/v1` | Flag issuer service endpoint                          |
| `issuer`       | `flags.5chan.app`                | Expected issuer name in signed assertions             |
| `namespace`    | `5chan`                          | Top-level comment object key for immutable data       |
| `profile`      | `5chan`                          | Flag profile to validate; this release supports 5chan |
| `allowedFlags` | `country,pol,pony`               | Comma-separated flag families accepted by the board   |
| `emitFlair`    | `true`                           | Mirrors the verified flag to author community flairs  |
| `error`        | `Flag verification failed.`      | Error prefix shown if verification fails              |

Boards can restrict flag families:

```js
[
  {
    name: "@bitsocial/flags-challenge",
    options: {
      allowedFlags: "country,pol",
    },
  },
];
```

For `/mlp/`, use:

```js
[
  {
    name: "@bitsocial/flags-challenge",
    options: {
      allowedFlags: "pony",
    },
  },
];
```

## 5chan Flag Requests

Clients request a flag by publishing a challenge-readable flag value on the comment, usually through `flair`:

```js
{
  flair: { type: "country", code: "auto", text: "flag:country:auto" }
}
```

Supported 5chan request strings:

- `flag:country:auto`
- `flag:pol:AC`
- `flag:pony:AJ`

Country flags use `auto` because the issuer service must derive the country from the challenge iframe request IP. The challenge does not trust a client-provided country code as proof of location. `/pol/` memeflags and `/mlp/` pony flags are free user choices, so they do not require the iframe flow.

## Verified Comment Shape

For a country flag, the challenge returns a result like:

```js
{
  success: true,
  comment: {
    "5chan": {
      country: "US",
      flag: {
        type: "country",
        code: "US",
        text: "flag:country:us",
        label: "US"
      },
      issuer: "flags.5chan.app",
      issuedAt: 1770000000,
      signature: {
        publicKey: "flag-service-public-key",
        signature: "flag-service-signature",
        type: "ed25519"
      }
    }
  },
  commentUpdate: {
    author: {
      community: {
        flairs: [{ text: "flag:country:us", type: "country", code: "US" }]
      }
    }
  }
}
```

For `/pol/` memeflags and `/mlp/` pony flags, clients render the selected flag from the comment flair fields they publish. The challenge does not add a signed `comment["5chan"]` assertion for those board-choice flags.

## Issuer Service Contract

The challenge creates a lazy iframe URL:

```text
https://flags.5chan.app/api/v1/iframe/<sessionId>/lazy#payload=<base64url-cbor>
```

The payload includes:

- the original challenge request;
- `requestedFlag`;
- `profile`, `namespace`, and `issuer`;
- a community-signed CBOR payload signature.

When the user completes the iframe flow, the challenge calls:

```text
POST https://flags.5chan.app/api/v1/challenge/verify
Content-Type: application/cbor
Accept: application/json
```

The issuer should return:

```js
{
  success: true,
  flag: {
    type: "country",
    code: "US",
    issuer: "flags.5chan.app",
    issuedAt: 1770000000,
    signature: {
      publicKey: "flag-service-public-key",
      signature: "flag-service-signature",
      type: "ed25519"
    }
  }
}
```

For country flags, the service can also return `{ success: true, country: "US", issuer, issuedAt, signature }`.

Issuer service deployment is intentionally outside this package. The challenge only defines the community-node integration and the issuer API contract.

## Development

```bash
corepack yarn install
corepack yarn type-check
corepack yarn test
corepack yarn test:coverage
corepack yarn build
```

## Publishing

Create the GitHub release and changelog with release-it:

```bash
corepack yarn release 0.1.0
```

The command expects the current branch to have an upstream and needs a GitHub token that can create releases. It writes `CHANGELOG.md`, creates a `v0.1.0` tag, and opens the GitHub release.

The first npm publish must create the package before trusted publishing can be configured:

```bash
npm publish --access public
```

After the package exists, configure npm trusted publishing:

- Publisher: GitHub Actions
- Organization: `bitsocialnet`
- Repository: `flags-challenge`
- Workflow filename: `publish.yml`
- Environment: leave blank

Equivalent npm CLI command:

```bash
npm trust github @bitsocial/flags-challenge --repo bitsocialnet/flags-challenge --file publish.yml
```

Future releases publish automatically when `package.json` version changes on `master`. The publish workflow skips versions that already exist on npm.
