# Contributing

Repository conventions for anyone contributing to Aniki-SDK.

## Repository setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/lalit999999/Aniki-SDK.git
cd Aniki-SDK
npm install
```

## Development environment

- Node.js 18 or later (see [Installation](./installation.md)).
- No additional services or accounts are required to run the test suite — every provider request
  is mocked (see [Mocking provider requests](#mocking-provider-requests) below), so you don't need
  an API key to develop or run tests.

## Running tests

```bash
npm test               # vitest run
npm run test:watch     # vitest, watch mode
npm run test:coverage  # vitest run --coverage
```

Coverage thresholds are enforced: 97% statements/lines/functions, 93% branches.

## Code style

```bash
npm run lint          # eslint src
npm run lint:fix       # eslint src --fix
npm run format         # prettier --write src
npm run format:check   # prettier --check src
npm run typecheck      # tsc --noEmit
```

`format` and `lint` (and their `:check`/`:fix` variants) are scoped to `src` only — they don't
touch or check documentation Markdown.

Formatting conventions: double quotes, semicolons, trailing commas, 2-space indent, 100-column
print width — Prettier enforces these automatically, so just run `npm run format` rather than
hand-matching the style.

TypeScript conventions, per [`Claude.md`](https://github.com/lalit999999/Aniki-SDK/blob/main/Claude.md):
strict mode, no `any`, prefer interfaces over loose object types, use generics where they buy real
type safety, `readonly` by default. Classes are `PascalCase`, interfaces are prefixed `I` where
they describe a swappable contract (`IProvider`, `ISession`, `ILogger`), methods are `camelCase`,
constants are `UPPER_SNAKE_CASE`.

## Mocking provider requests

Every test that would otherwise make a network call uses `MockProvider` (or `MockLogger` for
logging assertions) from `aniki-sdk/testing` instead — see [Tools](./tools.md) and
[Streaming](./streaming.md) for it in use, and [API Reference](./api-reference.md#testing-aniki-sdktesting)
for its full surface. New tests should follow the same pattern: no real HTTP requests, no
dependency on a live API key.

## Documentation

Every exported class and method should carry JSDoc, with an example where practical — this is a
project convention (`Claude.md` requires it), and it's also where a large share of this SDK's own
in-editor documentation comes from. If you add a new exported symbol, add its JSDoc in the same
change, and add it to [API Reference](./api-reference.md) if you're also updating `docs/`.

## Branch naming

`feature/<short-description>` for new work — this documentation set itself was written on
`feature/documentation`, following the same convention.

## Commit conventions

[Conventional Commits](https://github.com/lalit999999/Aniki-SDK) style prefixes —
`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:` — describing the nature of the change, with
an optional scope (e.g. `feat(providers): ...`). Prefer one atomic, reviewable commit per logical
change rather than a single large commit bundling unrelated work.

## Before opening a pull request

```bash
npm run verify   # typecheck && lint && test, in that order
```

Run this locally before pushing — it's the same gate the project expects every change to pass, and
running it before you push catches most issues before review.

## Pull requests

Open a PR describing the behavior change — what changed and why, not just what files were touched.
Reference any related issue.

## Issue reporting and feature requests

Both go through [GitHub Issues](https://github.com/lalit999999/Aniki-SDK/issues) — bug reports and
feature requests aren't triaged differently at the repository level; describe what you're trying to
do and, for a bug, how to reproduce it.

## Documentation contributions

Documentation lives under `docs/` as plain Markdown, one file per topic, with relative links between
pages (no external links other than the GitHub repository itself). If you're adding or changing a
page, keep code examples accurate to the current source — an example that doesn't typecheck against
the current `src/` is worse than no example.

## Release process

The only release-related script in this repository is:

```bash
npm run build   # tsup → dist/ (ESM + CJS + .d.ts)
```

`prepublishOnly` runs `npm run build && npm run verify` automatically before a real `npm publish`.
Beyond that, this repository doesn't document a CI pipeline or a changelog process — if your
contribution needs either, raise it as a discussion point in your pull request rather than assuming
one exists.

## Community guidelines

Be specific and constructive in issues and pull request reviews. There's no separate code of
conduct document in this repository at present — general open-source courtesy applies: assume good
faith, keep discussion focused on the technical change, and prefer a reproducible example over a
description when reporting a bug.

## Related Pages

- [API Reference](./api-reference.md)
- [Error Handling](./error-handling.md)
- [Troubleshooting](./troubleshooting.md)
