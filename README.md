[![Coverage](https://img.shields.io/endpoint?url=https://bitsocialnet.github.io/flags-challenge/badges/coverage.json)](https://github.com/bitsocialnet/flags-challenge/blob/master/scripts/write-coverage-badge.mjs)

# @bitsocial/flags-challenge

Verified flag issuer challenge for Bitsocial communities.

This package runs on a Bitsocial community owner node as a challenge. It is not specific to 5chan: other Bitsocial clients can add their own issuer service, namespace, and flag profiles later. The first supported profile is the 5chan flag profile, issued by `flags.5chan.app`, for country flags, `/pol/` memeflags, and `/mlp/` pony flags.

The challenge writes two pieces of data when a flag is verified:

- immutable comment data under `comment["5chan"]`, such as `comment["5chan"].country`;
- a compatibility mirror under `commentUpdate.author.community.flairs`, so clients that already render author flairs can show the same flag.

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

Default options target the 5chan issuer:

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

Country flags use `auto` because the issuer service must derive the country from the challenge iframe request IP. The challenge does not trust a client-provided country code as proof of location.

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

For `/pol/` memeflags and `/mlp/` pony flags, `comment["5chan"].flag` carries the selected flag and `comment["5chan"].memeflag` or `comment["5chan"].pony` carries the short code.

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

## Cloudflare DNS

When the issuer service is ready, create a proxied DNS record for `flags.5chan.app` in Cloudflare:

1. Open the `5chan.app` zone.
2. Add a `CNAME` record named `flags`.
3. Point it to the deployment hostname for the flag issuer service.
4. Keep proxy status enabled.
5. Configure the service environment with `BASE_URL=https://flags.5chan.app/api/v1`.
6. Verify `https://flags.5chan.app/health` before installing the challenge on live boards.

If the issuer runs on a VPS instead of a platform hostname, use an `A` record pointing at the VPS IP.

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
