# Error Handling

Every error the SDK throws extends a common base and carries a stable, machine-readable code, so
you can handle failures without guessing at string messages.

## The error taxonomy

Every error extends `AnikiError`, which carries an abstract `code: ErrorCode`, an optional `cause`
(the original error it wraps, when there is one), a `context` object with fields specific to that
failure, and a `toJSON()` method for structured logging. A single `instanceof AnikiError` check
catches anything the SDK raises; narrow further with `instanceof` on a specific subclass, or by
comparing `error.code`.

```ts
import { isAnikiError } from "aniki-sdk";

try {
  // ... something that might throw an AnikiError ...
} catch (error) {
  if (isAnikiError(error)) {
    console.error(error.code, error.message, error.context);
  } else {
    throw error; // not an SDK error — don't swallow it
  }
}
```

### Every error code

| Class | `code` | Thrown by |
| --- | --- | --- |
| `ConfigurationError` | `CONFIGURATION_ERROR` | `Aniki.configure`, provider construction/resolution |
| `ValidationError` | `VALIDATION_ERROR` | `Agent`, `Tool`, `Context`, `Memory`, `Runner` input validation |
| `ProviderError` | `PROVIDER_ERROR` | `Runner`, when an injected provider throws a non-`ProviderError` |
| `AuthenticationError`, `ModelNotFoundError`, `InvalidRequestError`, `RateLimitError`, `ProviderTimeoutError`, `ProviderConnectionError`, `ProviderResponseError` | `PROVIDER_ERROR` | The provider layer — see [Provider errors](#provider-errors) below |
| `DuplicateToolError` | `TOOL_DUPLICATE` | `ToolRegistry.register`/`registerAll`, `Agent` construction |
| `ToolNotFoundError` | `TOOL_NOT_FOUND` | `ToolExecutor`, when the model requests an unregistered tool |
| `ToolInputValidationError` | `TOOL_INPUT_VALIDATION` | `Tool.parseInput` / `Tool.run` |
| `ToolOutputValidationError` | `TOOL_OUTPUT_VALIDATION` | `Tool.parseOutput` / `Tool.run` |
| `ToolExecutionError` | `TOOL_EXECUTION_FAILED` | `ToolExecutor`, when a tool's `execute` throws |
| `ToolTimeoutError` | `TOOL_TIMEOUT` | `ToolExecutor`, when `execute` exceeds its `timeoutMs` |
| `MaxToolIterationsError` | `TOOL_MAX_ITERATIONS` | `Runner.run`, when `maxToolIterations` is exhausted without a final answer |
| `OutputParseError` | `OUTPUT_PARSE_ERROR` | `JsonExtractor` / `StructuredOutputParser`, when no JSON payload can be found or parsed |
| `OutputValidationError` | `OUTPUT_VALIDATION_ERROR` | `OutputValidator` / `StructuredOutputParser`, when parsed JSON fails the output schema |
| `OutputProcessingError` | `OUTPUT_PROCESSING_ERROR` | `OutputPipeline`, when a registered processor throws |
| `StreamError` | `STREAM_ERROR` | `StreamReader`/`RunStream`, for a wrapped transport or iteration failure |
| `StreamAbortedError` | `STREAM_ABORTED` | `RunStream.abort()`, or a caller-supplied `AbortSignal` firing |
| `StreamConsumedError` | `STREAM_ALREADY_CONSUMED` | `RunStream`, when a second consumption channel is touched |
| `StreamingNotSupportedError` | `STREAMING_NOT_SUPPORTED` | `Runner.stream`, for a non-streaming provider or an agent with tools |
| `MiddlewareExecutionError` | `MIDDLEWARE_EXECUTION_FAILED` | `MiddlewarePipeline`, when a middleware's `execute` throws |
| `MiddlewareContractError` | `MIDDLEWARE_CONTRACT_VIOLATION` | `MiddlewarePipeline`, when a middleware calls `next()` more than once or resolves without a response |
| `RetryExhaustedError` | `RETRY_EXHAUSTED` | `RetryMiddleware`, when every configured attempt fails |
| `CacheError` | `CACHE_ERROR` | `CacheMiddleware`, when its `ICacheStore` throws (caught and logged, not surfaced to the run) |

`ToolError`, `OutputError`, and `MiddlewareError` are abstract bases (`ToolNotFoundError extends
ToolError`, etc.) — never thrown directly, but useful for a broader `instanceof` check across a
whole category.

## Validation errors

`ValidationError` is thrown by every public constructor's fail-fast checks — before any network
call, before any provider is touched. Every SDK-generated `ValidationError` message follows a
what → why → fix shape:

```ts
import { Agent, ValidationError } from "aniki-sdk";

try {
  new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-4o-mini",
    provider: {} as never, // deliberately invalid, to demonstrate the error
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(error.message);
    // Agent.provider must implement IProvider: "generate" is not a function.
    // Pass a provider instance (e.g. new OpenAIProvider(...)) or a registered
    // provider name such as "openai".
    console.error(error.context); // { subject: "Agent.provider", received: {} }
  }
}
```

## Provider errors

Every provider failure is normalized into a `ProviderResponseError` subclass, so calling code never
has to parse a vendor-specific error shape:

| Class | HTTP status | Retryable |
| --- | --- | --- |
| `AuthenticationError` | 401 / 403 | No |
| `ModelNotFoundError` | — (model doesn't exist) | No |
| `InvalidRequestError` | 400 / 422 | No |
| `RateLimitError` | 429 | Yes — may carry `retryAfterSeconds` |
| `ProviderTimeoutError` | — (request exceeded its timeout) | Yes |
| `ProviderConnectionError` | — (DNS/socket/fetch-level failure) | Yes |
| `ProviderResponseError` | any other non-2xx, or a malformed 2xx body | Depends — 5xx is retryable, a malformed 2xx body is not |

Each carries `providerName`, an optional `statusCode`, an optional `providerCode` (the vendor's own
error code, when present), and `retryable`.

### Network and timeout errors

`ProviderTimeoutError` and `ProviderConnectionError` come from the transport layer
(`FetchHttpClient`), not from a parsed HTTP response — a timed-out `fetch` call becomes the former,
any other `fetch` rejection (DNS failure, connection reset, ...) becomes the latter. Both are always
retryable.

### Rate limit errors

```ts
import { RateLimitError } from "aniki-sdk";

function handleProviderError(error: unknown): void {
  if (error instanceof RateLimitError) {
    console.log("retry after (seconds):", error.retryAfterSeconds);
  }
}

void handleProviderError;
```

## Output errors

Covered in depth in [Generating Text](./generate-text.md#structured-output): `OutputParseError`
when the model's text has no extractable JSON payload, `OutputValidationError` when it parses but
fails the agent's schema. Both carry a truncated `raw` snippet of the model's text.

```ts
import { OutputParseError, OutputValidationError } from "aniki-sdk";

function handleOutputError(error: unknown): void {
  if (error instanceof OutputParseError) {
    console.error("no JSON found:", error.raw);
  } else if (error instanceof OutputValidationError) {
    console.error("schema mismatch:", error.issues, error.raw);
  }
}

void handleOutputError;
```

## Retry strategy

`RetryMiddleware` is the SDK's built-in retry mechanism — it wraps a single provider round trip
(see [Providers](./providers.md) and the middleware section of the API reference for how it
composes with the tool loop) and, by default, retries only a `ProviderResponseError` with
`retryable === true`. Everything else — a `ValidationError`, a `ToolError`, an `OutputError`, or a
non-retryable provider error like `AuthenticationError` — rethrows immediately on the first
attempt, since retrying a bad API key or malformed request just wastes time.

```ts
import { RetryMiddleware, Runner } from "aniki-sdk";

const retry = new RetryMiddleware({ maxAttempts: 3 });
const runner = new Runner(undefined, undefined, { middleware: [retry] });
void runner;
```

When a `RateLimitError` carries `retryAfterSeconds`, that value takes priority over the computed
exponential backoff (clamped by `maxDelayMs`). Exhausting every attempt throws
`RetryExhaustedError`, with the last failure attached as `cause`.

```ts
import { isRetryableError } from "aniki-sdk";

function shouldRetry(error: unknown): boolean {
  return isRetryableError(error);
}

void shouldRetry;
```

## Logging errors

Every `AnikiError` has `toJSON()`, which produces a structured-log-safe object — `context` passed
through the same redaction `ConsoleLogger` uses, and `cause` flattened to `{ name, message }` with
no stack trace:

```ts
import { ConsoleLogger, isAnikiError } from "aniki-sdk";

const logger = new ConsoleLogger();

async function runAndLog(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (isAnikiError(error)) {
      logger.error("run failed", error.toJSON());
    } else {
      throw error;
    }
  }
}

void runAndLog;
```

## Best Practices

- **Branch on `error.code` for exhaustive handling without importing every class.** It's a stable
  string, so a `switch` on it survives a class rename.
- **Use `isRetryableError` instead of hand-rolling a retryable check.** It already narrows to the
  right subclass and reads the `retryable` flag correctly.
- **Never log a raw `AnikiError` object.** Use `error.toJSON()` — it redacts credential-shaped
  context fields the raw error's `context` might otherwise expose.
- **Catch narrow, rethrow broad.** Handle the specific errors you have a recovery path for
  (`RateLimitError`, `OutputValidationError`, ...); let everything else propagate rather than
  swallowing errors you don't actually know how to handle.

## Common Mistakes

- **Assuming every provider failure is retryable.** Only a `ProviderResponseError` with
  `retryable: true` is — check `isRetryableError` rather than assuming `instanceof ProviderError`
  implies retryable.
- **Catching `Error` instead of `AnikiError`.** This also catches genuine programmer bugs (a `TypeError`
  from your own code) and treats them the same as an SDK-classified failure.
- **Expecting a tool failure to throw.** It doesn't — see
  [Tools](./tools.md#execution-validation-and-error-handling) for why `ToolExecutor` resolves with
  `{ ok: false }` instead.

## API Reference

See the [Errors](./api-reference.md#errors) section of the API Reference for every error class,
its fields, and what throws it.

## Related Pages

- [Generating Text](./generate-text.md)
- [Tools](./tools.md)
- [Troubleshooting](./troubleshooting.md)
- [FAQ](./faq.md)
