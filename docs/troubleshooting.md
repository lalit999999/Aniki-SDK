# Troubleshooting

Common problems, why they happen, and how to fix them.

## Invalid or missing API key

**Symptoms:** `ConfigurationError` thrown when constructing an `Agent` or a provider, before any
request is made — message includes `"Missing API key for provider"`.

**Cause:** No API key was found from any resolution source: not passed explicitly, not set via
`Aniki.configure`, and not present in the relevant environment variable
(`OPENAI_API_KEY`/`OPENROUTER_API_KEY`/etc.).

**Solution:** Set the environment variable for the provider you're using, or pass `apiKey`
explicitly to `Aniki.configure` or the provider's constructor. See
[Providers](./providers.md#configuration-resolution) for the exact resolution order.

## Authentication rejected by the provider

**Symptoms:** `AuthenticationError` thrown from `runner.run` or `provider.generate`, not at
construction time.

**Cause:** An API key was found and sent, but the provider rejected it (revoked, wrong account,
wrong key format).

**Solution:** Verify the key in your provider's dashboard. This is a runtime failure, not a
configuration-resolution failure — the SDK found *a* key, just not a valid one.

## Provider not responding / connection errors

**Symptoms:** `ProviderConnectionError` thrown, always `retryable: true`.

**Cause:** A transport-level failure — DNS resolution, connection refused, socket reset — before
any HTTP response was received.

**Solution:** Check network connectivity and any configured `baseURL`. If you're behind a proxy or
using a custom gateway, verify the URL is reachable independently of the SDK (`curl` it). Consider
wrapping the run in `RetryMiddleware`, since this error is retryable.

## Timeout errors

**Symptoms:** `ProviderTimeoutError`, always `retryable: true`.

**Cause:** The request didn't complete within the configured timeout (`30000`ms by default, or
whatever you passed as `ProviderConfig.timeout`).

**Solution:** Raise the timeout if the model or request is legitimately slow (a long generation, a
large prompt), or investigate why the provider is slow to respond. This is also retryable — a
transient network blip produces the same error as a genuinely slow response.

## Streaming not working

**Symptoms:** `StreamingNotSupportedError` thrown synchronously from `runner.stream`, before any
request is sent.

**Cause:** One of two things — `agent.provider.capabilities.streaming` is `false`, or the agent has
one or more registered tools. `error.reason` tells you which.

**Solution:** If it's the tools case, remove the tools from the agent you intend to stream (this
SDK doesn't support streaming with tool calls in this release — see
[Streaming](./streaming.md#limitations)). If it's the capabilities case, confirm you're using a
provider whose `capabilities.streaming` is `true` (OpenAI and OpenRouter both are).

## A stream throws `StreamConsumedError`

**Symptoms:** `StreamConsumedError` thrown from a second attempt to iterate a `RunStream`, read
`textStream`, or await `result`.

**Cause:** The underlying provider stream can only be read once. Touching a second consumption
channel — or the same channel twice — after the first has started reading throws this.

**Solution:** Pick exactly one consumption channel per `runner.stream(...)` call. If you need the
same content in two places, capture it from whichever channel you used (e.g. accumulate
`stream.textStream` yourself) rather than re-consuming the stream.

## Unknown provider name

**Symptoms:** `ConfigurationError` with a message like `Unknown provider "anthropic". Available
providers: openai, openrouter`.

**Cause:** `"anthropic"`, `"gemini"`, `"ollama"`, and `"groq"` are valid `ProviderName` values at
the type level, but none of them has a registered factory — only `"openai"` and `"openrouter"` are.
See [Providers](./providers.md#declared-but-not-implemented).

**Solution:** Use `"openai"` or `"openrouter"`, or register your own provider under that name via
`defaultProviderRegistry.register(name, factory)` — see
[Providers](./providers.md#writing-and-registering-a-custom-provider).

## My tool is never called

**Symptoms:** An agent with tools attached returns a plain-text response and `result.toolResults`
is empty — no error, no warning.

**Cause:** If the agent's provider is OpenAI (or OpenRouter, which reuses the same adapter), this
is expected — the OpenAI adapter drops tool definitions before they reach the wire, and never
populates `toolCalls` on the response. See [Tools](./tools.md#the-openai-limitation) for exactly
where this happens.

**Solution:** For now, tool calling works end-to-end only against `MockProvider` or a custom
`IProvider` you write yourself. If you need this to work against OpenAI, you're waiting on a wire-
format fix inside `OpenAIRequestBuilder`/`OpenAIResponseParser`, not the tool-calling architecture
itself.

## `MaxToolIterationsError`

**Symptoms:** `Runner.run` throws `MaxToolIterationsError` after several tool calls.

**Cause:** The model kept requesting tools without ever returning a final plain-text answer, and
`agent.maxToolIterations` (default `5`) was exhausted.

**Solution:** Check whether your tools are returning results the model can actually use to finish
the task — a tool returning an error repeatedly can trap the model in a retry loop. If the task
genuinely needs more iterations, raise `maxToolIterations` when constructing the `Agent`.

## `OutputParseError` / `OutputValidationError`

**Symptoms:** `Runner.run` throws one of these when the agent has an `output` schema.

**Cause:** `OutputParseError` means the model's response had no extractable JSON payload at all.
`OutputValidationError` means a JSON payload was found and parsed, but it didn't match your Zod
schema. See [Generating Text](./generate-text.md#structured-output) — there's no repair/retry loop,
so either error is thrown immediately.

**Solution:** Inspect `error.raw` (truncated model text) to see what the model actually returned.
Simplifying the schema, or making your instructions more explicit about the expected shape, usually
helps more than retrying the exact same request.

## Import errors

**Symptoms:** `Cannot find module 'aniki-sdk'`, or a `require()` of an ES module error.

**Cause:** Usually a missing install, a monorepo hoisting issue, or a mismatch between how your
project resolves modules and the package's dual ESM/CJS `exports` map.

**Solution:** See [Installation](./installation.md#common-installation-issues) for the full
breakdown of this category.

## Environment variable not picked up

**Symptoms:** `Aniki.configure({ provider: "openai" })` (with no `apiKey`) still results in a
missing-API-key `ConfigurationError`, even though you set `OPENAI_API_KEY`.

**Cause:** Either the variable isn't actually set in the process the code runs in (a common issue
with `.env` files that need an explicit loader), or you're targeting a different provider than the
one whose variable you set.

**Solution:** Confirm the variable is visible to the running process (`console.log(process.env.OPENAI_API_KEY)`
right before the failing call). If you're using a `.env` file, make sure something actually loads it
— Node doesn't read `.env` files on its own.

## TypeScript errors in your own code using the SDK

**Symptoms:** A type error referencing `AgentOptions`, `ProviderName`, or similar SDK types.

**Cause:** Most commonly, passing a string provider name that isn't one of the six literal
`ProviderName` values, or omitting a required `Agent`/`Tool` field.

**Solution:** Check the exact option shape in [API Reference](./api-reference.md) — every
constructor's options are documented with a field table including which fields are required.

## Package installation errors

**Symptoms:** `npm install aniki-sdk` fails outright.

**Cause:** Usually unrelated to this package specifically — a registry connectivity issue, an
`engines.node` mismatch (this package requires Node 18+), or a lockfile conflict.

**Solution:** Confirm your Node version with `node --version`, and try the install with a different
package manager (see [Installation](./installation.md)) to isolate whether it's package-manager-
specific.

## Related Pages

- [Error Handling](./error-handling.md)
- [Providers](./providers.md)
- [Tools](./tools.md)
- [FAQ](./faq.md)
