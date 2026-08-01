# CLAUDE.md

# Aniki-SDK Development Guide

## Project Overview

Aniki-SDK is a TypeScript-based AI Agent SDK for Node.js that enables developers to build production-ready AI agents using a simple, extensible, and provider-agnostic API.

The SDK is inspired by modern AI agent frameworks but is designed with a strong focus on:

* Clean Object-Oriented Architecture
* Extensibility
* Type Safety
* Multi-Provider Support
* Excellent Developer Experience
* Minimal Configuration

The SDK will be published on npm and should feel like a native TypeScript library.

---

# Primary Goal

Developers should be able to create an AI agent with only a few lines of code.

Example:

```ts
import { Agent, Runner, Tool } from "aniki-sdk";

const weatherTool = new Tool({
    ...
});

const agent = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-5.5",
    provider: "openai",
    tools: [weatherTool],
    output: UserSchema,
});

const runner = new Runner();

const response = await runner.run(agent, {
    message: "Hello"
});
```

The internal architecture should remain hidden from developers while providing maximum flexibility.

---

# Core Design Principles

* TypeScript First
* Object-Oriented Design
* Modular Architecture
* Single Responsibility Principle
* Open/Closed Principle
* Composition over Inheritance
* Strong Typing
* Minimal Boilerplate
* Developer Friendly API
* Extensible Provider System

---

# Project Structure

```
src/
│
├── core/
├── providers/
├── middleware/
├── tools/
├── parser/
├── logger/
├── config/
├── utils/
├── types/
└── index.ts
```

Every module must have a single responsibility.

Business logic should never be mixed across modules.

---

# Core Modules

## Agent

Represents an AI Agent configuration.

Responsibilities:

* Store agent metadata
* Store instructions
* Store tools
* Store output schema
* Store model information
* Store middleware
* Store session
* Store provider

The Agent should never directly communicate with any provider.

---

## Runner

Runner is the execution engine of the SDK.

Responsibilities:

* Receive user input
* Load conversation history
* Execute middleware
* Call the provider
* Execute tools
* Validate structured output
* Return final response

Runner is responsible for orchestrating the complete execution lifecycle.

---

## Session

Session manages conversation history.

Initially implement:

* InMemory Session

Future implementations:

* Redis
* SQLite
* File Storage

The Session API should be storage-independent.

---

## Tool

A Tool represents executable functionality available to the AI.

Each Tool should contain:

* name
* description
* input schema
* output schema
* execute()

The Runner should be responsible for executing tools.

Tools should never call the provider directly.

---

## Provider

Providers connect the SDK to different LLM vendors.

Each provider must implement a common interface.

Supported providers:

* OpenAI
* Gemini
* Anthropic
* Ollama
* Groq
* OpenRouter

Adding a new provider should not require changing existing code.

---

## Middleware

Middleware executes before or after the Runner.

Examples:

* Logging
* Retry
* Cache
* Analytics
* Authentication
* Rate Limiting

Middleware should follow a pipeline architecture similar to Express.

---

## Structured Output

Use Zod for validation.

Responsibilities:

* Parse JSON
* Validate output
* Throw validation errors
* Return strongly typed objects

Never trust raw LLM output.

Always validate.

---

## Logger

Logger records important events.

Log:

* Agent Started
* Agent Finished
* LLM Request
* LLM Response
* Tool Started
* Tool Finished
* Errors
* Execution Time

The logger should be pluggable.

---

# Configuration

The SDK must expose a global configuration API.

Example:

```ts
Aniki.configure({
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "...",
    timeout: 30000
});
```

Configuration should support:

* API Key
* Base URL
* Timeout
* Retry Count
* Default Model
* Default Provider

Configuration should be reusable across agents.

---

# Coding Standards

## TypeScript

* Strict mode enabled
* No use of `any`
* Prefer interfaces over loose objects
* Use generics wherever appropriate
* Use readonly when possible

---

## OOP Guidelines

Use classes for:

* Agent
* Runner
* Session
* Tool
* Providers
* Logger

Avoid unnecessary inheritance.

Prefer composition.

---

## Error Handling

Every public API should throw meaningful custom errors.

Examples:

* ProviderError
* ToolExecutionError
* ValidationError
* ConfigurationError

Never expose raw provider errors.

---

## Naming Convention

Classes:

```
PascalCase
```

Interfaces:

```
IProvider
ISession
ILogger
```

Files:

```
Agent.ts
Runner.ts
Tool.ts
```

Methods:

```
camelCase
```

Constants:

```
UPPER_SNAKE_CASE
```

---

# Execution Pipeline

```
User Input
    ↓
Runner
    ↓
Session
    ↓
Middleware
    ↓
Provider
    ↓
Tool Execution (if needed)
    ↓
Provider
    ↓
Structured Output Validation
    ↓
Logging
    ↓
Final Response
```

Runner is the orchestrator.

No module should bypass the Runner.

---

# Future Features

Planned features include:

* Streaming Responses
* Multi-Agent Workflows
* Agent-to-Agent Communication
* Human Approval Steps
* Parallel Tool Execution
* Tool Result Caching
* Plugin System
* Event Hooks
* Memory Backends
* RAG Support
* MCP Integration
* Observability Dashboard
* CLI
* Template Generator

The architecture should remain open for future expansion without requiring breaking API changes.

---

# Testing Guidelines

Write unit tests for:

* Agent
* Runner
* Session
* Tool
* Provider
* Middleware
* Structured Output
* Logger

Mock all external provider requests.

Avoid network calls during unit testing.

---

# Documentation Standards

Every exported class and method should include JSDoc documentation.

Include examples for public APIs whenever practical.

Documentation should prioritize clarity, consistency, and developer usability.

---

# Performance Goals

* Lightweight dependency footprint
* Fast startup time
* Minimal memory usage
* Support concurrent agent execution
* Efficient conversation history management

---

# Development Philosophy

When adding new features:

1. Preserve backward compatibility whenever possible.
2. Prefer composition over inheritance.
3. Keep the public API simple and intuitive.
4. Keep internal modules loosely coupled.
5. Favor explicit, type-safe APIs over implicit behavior.
6. Avoid unnecessary abstractions.
7. Write maintainable, well-documented code.
8. Optimize for developer experience without sacrificing flexibility.

The primary objective is to make Aniki-SDK a clean, extensible, and production-ready AI Agent SDK that developers enjoy using.
