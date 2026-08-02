/**
 * Test doubles for exercising Aniki-SDK agents without network calls.
 *
 * Published as a separate `aniki-sdk/testing` entry point (see
 * `tsup.config.ts` / `package.json`) so these never ship as part of the
 * main SDK surface.
 */

export { MockProvider } from "./MockProvider.js";
export type { MockProviderOptions } from "./MockProvider.js";

export { MockLogger } from "./MockLogger.js";
export type { MockLogRecord } from "./MockLogger.js";
