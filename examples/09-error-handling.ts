// Mirrors docs/error-handling.md
//
// Run: npx tsx examples/09-error-handling.ts
import {
  Agent,
  ConsoleLogger,
  OutputParseError,
  OutputValidationError,
  RateLimitError,
  RetryMiddleware,
  Runner,
  ValidationError,
  isAnikiError,
  isRetryableError,
} from "aniki-sdk";

function narrowingWithIsAnikiError(): void {
  try {
    throw new ValidationError("Agent.name must be a non-empty string.", { subject: "Agent.name" });
  } catch (error) {
    if (isAnikiError(error)) {
      console.error(error.code, error.message, error.context);
    } else {
      throw error; // not an SDK error — don't swallow it
    }
  }
}

function validationErrorShape(): void {
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
      console.error(error.context);
    }
  }
}

function handleProviderError(error: unknown): void {
  if (error instanceof RateLimitError) {
    console.log("retry after (seconds):", error.retryAfterSeconds);
  }
}

function handleOutputError(error: unknown): void {
  if (error instanceof OutputParseError) {
    console.error("no JSON found:", error.raw);
  } else if (error instanceof OutputValidationError) {
    console.error("schema mismatch:", error.issues, error.raw);
  }
}

function retryMiddlewareSetup(): void {
  const retry = new RetryMiddleware({ maxAttempts: 3 });
  const runner = new Runner(undefined, undefined, { middleware: [retry] });
  console.log("runner configured with retry middleware:", typeof runner.run);
}

function shouldRetry(error: unknown): boolean {
  return isRetryableError(error);
}

async function runAndLog(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (isAnikiError(error)) {
      const logger = new ConsoleLogger();
      logger.error("run failed", error.toJSON());
    } else {
      throw error;
    }
  }
}

async function main(): Promise<void> {
  narrowingWithIsAnikiError();
  validationErrorShape();
  handleProviderError(new RateLimitError("Rate limit exceeded.", "openai", { retryAfterSeconds: 5 }));
  handleOutputError(new OutputParseError("No JSON payload found in model response.", "not json"));
  retryMiddlewareSetup();
  console.log(
    "shouldRetry(new RateLimitError(...)):",
    shouldRetry(new RateLimitError("Rate limit exceeded.", "openai")),
  );

  await runAndLog(async () => {
    throw new ValidationError("demo: logging example", { subject: "demo" });
  });
}

void main();
