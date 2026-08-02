/**
 * Root-level smoke harness — runs Aniki-SDK from local `./dist`, the same
 * artifact `npm publish` ships, so a bug caught here is provably a source
 * bug rather than a packaging bug. Never published (see `files` in
 * package.json); lives outside `src/` so it is free to use `console`.
 *
 * Offline mode (default) exercises Agent -> Runner -> Session -> MockProvider
 * end to end with zero network calls. Live mode additionally runs one real
 * request through OpenAIProvider when OPENAI_API_KEY is set.
 *
 * Usage:
 *   npm run smoke:offline   # offline only
 *   npm run smoke           # builds, then offline + live (if OPENAI_API_KEY is set)
 */

let sdk;
let testing;
try {
  [sdk, testing] = await Promise.all([import("./dist/index.js"), import("./dist/testing/index.js")]);
} catch (error) {
  if (error?.code === "ERR_MODULE_NOT_FOUND") {
    console.error("dist/ not found. Run `npm run build` first, or use `npm run smoke`.");
    process.exit(1);
  }
  throw error;
}

const { Aniki, Agent, Runner } = sdk;
const { MockProvider } = testing;

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

function skip(label) {
  skipped++;
  console.log(`  ⊘ skipped — ${label}`);
}

function printError(error) {
  const name = error?.constructor?.name ?? typeof error;
  console.error(`  ${name}: ${error?.message ?? error}`);
  if (error && typeof error === "object") {
    if (error.code !== undefined) console.error(`  code: ${error.code}`);
    if (error.statusCode !== undefined) console.error(`  statusCode: ${error.statusCode}`);
    if (typeof error.toJSON === "function") {
      console.error(`  toJSON(): ${JSON.stringify(error.toJSON(), null, 2)}`);
    }
  }
}

console.log("▸ Offline (MockProvider)");
try {
  const scriptedReply = "Hello from the mock!";
  const mockProvider = new MockProvider();
  mockProvider.enqueueResponse({ content: scriptedReply });

  const agent = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "mock-model",
    provider: mockProvider,
  });

  const runner = new Runner();
  const result = await runner.run(agent, { message: "Hello" });

  assert(result.content === scriptedReply, "content matches scripted reply");
  assert(result.iterations === 1, "iterations === 1");
  assert(typeof result.runId === "string" && result.runId.length > 0, "runId is a non-empty string");
  const roles = result.messages.map((message) => message.role).join(", ");
  assert(roles === "user, assistant", `message roles: ${roles}`);
  assert(result.metadata.provider === "mock", 'metadata.provider === "mock"');
} catch (error) {
  failed++;
  console.log("  ✗ offline smoke run threw unexpectedly");
  printError(error);
}

console.log("\n▸ Live (OpenAI-compatible endpoint)");
if (!process.env.OPENAI_API_KEY) {
  skip("OPENAI_API_KEY not set");
} else {
  try {
    const baseURL = process.env.ANIKI_BASE_URL;
    const model = process.env.ANIKI_MODEL ?? "gpt-4o-mini";

    Aniki.configure({
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      defaultModel: model,
      timeout: 30_000,
      ...(baseURL ? { baseURL } : {}),
    });

    const agent = new Agent({
      name: "Assistant",
      instructions: "You are a helpful assistant.",
      model,
      provider: "openai",
    });

    const runner = new Runner();
    const result = await runner.run(agent, { message: "Hello" });

    console.log(`  content: ${result.content}`);
    console.log(`  metadata: ${JSON.stringify(result.metadata)}`);
    console.log(`  usage: ${JSON.stringify(result.metadata.usage)}`);
    assert(typeof result.content === "string" && result.content.length > 0, "content is a non-empty string");
  } catch (error) {
    failed++;
    console.log("  ✗ live request failed");
    printError(error);
  }
}

console.log(`\n${passed} passed · ${failed} failed · ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
