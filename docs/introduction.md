# Introduction

Aniki-SDK is a TypeScript, provider-agnostic AI Agent SDK for building production-ready AI agents
on Node.js.

## Overview

Most agent frameworks make the simple demo easy and the production path painful: hidden control
flow, untyped model output, and retry logic you can't see into. Aniki-SDK is built around a
different idea — a single `Runner` orchestrates the entire execution lifecycle (history,
middleware, the provider call, tool execution, output validation), and every layer along that path
is an interface you can inspect, replace, or test in isolation.

The SDK never trusts raw model output. Tool arguments are validated against a schema before your
code sees them, and structured output is extracted, parsed, and validated before it reaches
`result.output`. Nothing is global — configuration is explicit, and every component that logs or
calls a provider does so through an injected interface, not a hidden singleton.

## Problems it solves

- **Untyped model output.** Give an `Agent` a Zod schema and `result.output` is typed and
  validated, not a string you parse yourself.
- **Invisible retry/caching logic.** Middleware wraps each provider round trip explicitly, so you
  can see (and test) exactly what happens on a retry or a cache hit.
- **Provider lock-in.** Code depends on the `IProvider` contract, not a vendor SDK. Swapping models
  or vendors doesn't mean rewriting your application.
- **Untestable agents.** `Tool.run` validates and executes with zero LLM or network involvement,
  and `aniki-sdk/testing` ships `MockProvider`/`MockLogger` so an entire agent can be exercised
  without a real API key.

## Main features

- **Agents and a Runner** — `Agent` is a pure configuration container; `Runner` is the only
  component that talks to a provider, executes tools, and validates output.
- **Tool calling** — typed, self-describing tools with input/output validation, timeouts, and
  retries, executed automatically in a loop until the model returns a final answer.
- **Structured output** — a Zod schema on an agent flows through generics, so `result.output` is
  typed and validated. See [Generating Text](./generate-text.md) for how this actually works
  end-to-end.
- **Streaming** — `Runner.stream` returns a handle you can consume as typed events, delta text, or
  a single awaited result. See [Streaming](./streaming.md) for its current limitations.
- **Middleware** — an Express-style pipeline around each provider round trip, with built-in retry,
  cache, and logging middleware.
- **Pluggable logging and lifecycle events** — nothing logs unless you opt in, and every run emits
  a canonical set of events you can pipe into your own observability stack.
- **A typed error taxonomy** — every error the SDK throws extends `AnikiError` and carries a stable
  `code`, so you can handle failures by `instanceof` or by code without guessing.

## Design philosophy

- **The Runner owns execution.** No other module is allowed to call a provider directly — not
  `Agent`, not `Tool`.
- **Never trust raw model output.** Tool arguments and structured output are always validated
  against a schema before your code sees them.
- **Composition over inheritance.** Providers, middleware, and output processors are all
  interfaces you implement and inject, not base classes you extend and hope not to break.
- **Nothing is global by default.** Logging defaults to a no-op; middleware defaults to an empty
  pipeline. You opt into behavior explicitly.
- **Fail fast, with an actionable message.** Configuration and construction-time errors throw
  immediately, with a message describing what went wrong, why, and how to fix it.

## Supported providers

Today, [OpenAI](./providers.md#openai) and OpenRouter (an OpenAI-wire-compatible gateway) are
registered and ready to use out of the box. Four more provider names are declared in the SDK's
types but not yet implemented — see [Providers](./providers.md) for the full picture, including how
to register your own provider for any vendor the SDK doesn't cover yet.

## Key capabilities at a glance

| Capability | Status |
| --- | --- |
| Text generation via `Runner.run` | Fully supported |
| Structured output (Zod schema → typed result) | Fully supported, prompt-driven — see [Generating Text](./generate-text.md) |
| Streaming | Supported, but not combined with tool calls — see [Streaming](./streaming.md) |
| Tool calling | Fully implemented in `Runner`, but not wired through the OpenAI provider yet — see [Tools](./tools.md) |
| Generation parameters (temperature, max tokens) | Supported by the provider layer, but not yet reachable through `Agent`/`Runner` — see [Generating Text](./generate-text.md) |
| Session/memory persistence across process restarts | Not yet — only an in-memory session ships today, see [Memory](./memory.md) |

Ready to try it? Continue to the [Quick Start](./quick-start.md).
