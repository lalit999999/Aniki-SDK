# Installation

## Requirements

- **Node.js 18 or later.** The SDK's HTTP layer uses native `fetch` — there is no vendor SDK and
  no polyfill, so an older runtime without global `fetch` will not work.
- No other runtime is currently supported. The package is plain Node-targeted TypeScript compiled
  to ESM and CJS; it has not been tested against edge runtimes, Deno, or browsers.

## Installing the package

```bash
npm install aniki-sdk
```

Any package manager works the same way:

```bash
# pnpm
pnpm add aniki-sdk

# yarn
yarn add aniki-sdk

# bun
bun add aniki-sdk
```

The package ships a dual ESM + CJS build with bundled `.d.ts` type declarations, so you do not need
to install a separate `@types` package.

## Environment variables

The SDK reads a provider's API key from an environment variable when you don't pass one explicitly.
Set the variable for whichever provider you plan to use:

```bash
export OPENAI_API_KEY="sk-..."
```

The full set of variable names the SDK recognizes:

| Provider name | Environment variable |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |
| `ollama` | `OLLAMA_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |

Only `openai` and `openrouter` are actually wired up to a working provider today — see
[Providers](./providers.md) for what that means in practice. Setting an environment variable for
one of the other names does nothing yet.

## Verifying the install

Create a file that imports the package and checks that its exports resolve:

```ts
import { Agent, Runner } from "aniki-sdk";

console.log(typeof Agent, typeof Runner);
// "function" "function"
```

If this runs without a module-resolution error, the install succeeded. You do not need an API key
just to import the package — only to actually call a provider.

## Common installation issues

**`Cannot find module 'aniki-sdk'` or a type-resolution error in your editor**
Confirm `node_modules/aniki-sdk` exists and that your `package.json` lists it as a dependency. If
you're on a monorepo with hoisted dependencies, make sure the install ran from the correct
workspace root.

**A `require()` of an ES module error**
The package is `"type": "module"` at heart but ships a CJS build (`require("aniki-sdk")` works).
If you see this error, check that your bundler or Node version is resolving the `require` condition
in the package's `exports` map rather than trying to load the ESM build directly.

**TypeScript can't find types for `aniki-sdk`**
Type declarations are bundled — there is no separate `@types/aniki-sdk` package to install. If
types aren't resolving, check `moduleResolution` in your `tsconfig.json`; `"node16"`/`"nodenext"`
or `"bundler"` are the settings this package's own `exports` map is designed for.

**Nothing happens when you call a provider**
This isn't an installation problem — it means no API key was resolved. See
[Troubleshooting](./troubleshooting.md#invalid-or-missing-api-key) for how the SDK resolves
credentials and what error you should expect instead.

Next: [Quick Start](./quick-start.md).
