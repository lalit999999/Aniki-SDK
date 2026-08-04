// Mirrors docs/installation.md — "Verifying the install"
//
// Run: npx tsx examples/01-installation.ts
import { Agent, Runner } from "aniki-sdk";

console.log(typeof Agent, typeof Runner);
// "function" "function"

console.log("aniki-sdk resolved successfully — install verified.");
