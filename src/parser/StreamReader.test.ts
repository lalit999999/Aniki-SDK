import { describe, expect, it } from "vitest";
import { AuthenticationError } from "../providers/errors.js";
import { StreamAbortedError, StreamError } from "../core/errors.js";
import type { ProviderStreamChunk } from "../providers/AIProvider.js";
import { StreamReader } from "./StreamReader.js";

function makeSource(
  chunks: readonly ProviderStreamChunk[],
  onReturn: () => void,
): AsyncIterable<ProviderStreamChunk> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next(): Promise<IteratorResult<ProviderStreamChunk>> {
          if (index >= chunks.length) {
            return { done: true, value: undefined };
          }
          const value = chunks[index];
          index += 1;
          return { done: false, value: value as ProviderStreamChunk };
        },
        async return(): Promise<IteratorResult<ProviderStreamChunk>> {
          onReturn();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

describe("StreamReader", () => {
  it("passes chunks through in order", async () => {
    let returned = false;
    const chunks: ProviderStreamChunk[] = [{ delta: "a" }, { delta: "b" }];
    const source = makeSource(chunks, () => {
      returned = true;
    });
    const reader = new StreamReader(source);

    const result = await drain(reader.read());

    expect(result).toEqual(chunks);
    expect(returned).toBe(true);
  });

  it("calls the source iterator's return() on normal completion", async () => {
    let returned = false;
    const source = makeSource([{ delta: "a" }], () => {
      returned = true;
    });
    const reader = new StreamReader(source);

    await drain(reader.read());

    expect(returned).toBe(true);
  });

  it("calls the source iterator's return() when the consumer breaks out early", async () => {
    let returned = false;
    const source = makeSource([{ delta: "a" }, { delta: "b" }, { delta: "c" }], () => {
      returned = true;
    });
    const reader = new StreamReader(source);

    for await (const chunk of reader.read()) {
      if (chunk.delta === "a") {
        break;
      }
    }

    expect(returned).toBe(true);
  });

  it("calls the source iterator's return() when a foreign error is thrown", async () => {
    let returned = false;
    const source: AsyncIterable<ProviderStreamChunk> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ProviderStreamChunk>> {
            throw new Error("transport exploded");
          },
          async return(): Promise<IteratorResult<ProviderStreamChunk>> {
            returned = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const reader = new StreamReader(source);

    await expect(drain(reader.read())).rejects.toThrow(StreamError);
    expect(returned).toBe(true);
  });

  it("wraps a foreign throw in StreamError, naming the provider", async () => {
    const source: AsyncIterable<ProviderStreamChunk> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ProviderStreamChunk>> {
            throw new Error("transport exploded");
          },
        };
      },
    };
    const reader = new StreamReader(source, { providerName: "openai" });

    try {
      await drain(reader.read());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StreamError);
      expect((error as StreamError).message).toContain("openai");
      expect((error as StreamError).cause).toBeInstanceOf(Error);
    }
  });

  it("rethrows an AnikiError from the source unchanged", async () => {
    const original = new AuthenticationError("invalid api key", "openai", { statusCode: 401 });
    const source: AsyncIterable<ProviderStreamChunk> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ProviderStreamChunk>> {
            throw original;
          },
        };
      },
    };
    const reader = new StreamReader(source);

    await expect(drain(reader.read())).rejects.toBe(original);
  });

  it("throws StreamAbortedError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("caller cancelled");
    const source = makeSource([{ delta: "a" }], () => {});
    const reader = new StreamReader(source, { signal: controller.signal });

    await expect(drain(reader.read())).rejects.toThrow(StreamAbortedError);
  });

  it("throws StreamAbortedError when the signal fires mid-stream", async () => {
    const controller = new AbortController();
    let returned = false;
    const source: AsyncIterable<ProviderStreamChunk> = {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next(): Promise<IteratorResult<ProviderStreamChunk>> {
            if (index === 0) {
              index += 1;
              return { done: false, value: { delta: "a" } };
            }
            controller.abort("timeout");
            return new Promise(() => {
              // never resolves — the abort race must win
            });
          },
          async return(): Promise<IteratorResult<ProviderStreamChunk>> {
            returned = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const reader = new StreamReader(source, { signal: controller.signal });

    const seen: ProviderStreamChunk[] = [];
    await expect(
      (async () => {
        for await (const chunk of reader.read()) {
          seen.push(chunk);
        }
      })(),
    ).rejects.toThrow(StreamAbortedError);

    expect(seen).toEqual([{ delta: "a" }]);
    expect(returned).toBe(true);
  });
});
