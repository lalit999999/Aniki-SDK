/**
 * The strategy every provider uses to attach credentials to a request.
 *
 * Providers depend on this interface rather than any concrete strategy,
 * so authentication can vary independently of vendor logic (e.g. swapping
 * a bearer token for a custom header scheme without touching the provider).
 */
export interface IAuthStrategy {
  /** Returns the headers to merge into an outgoing request. */
  getHeaders(): Readonly<Record<string, string>>;
}

/**
 * Attaches credentials via a standard `Authorization: Bearer <token>` header.
 *
 * @example
 * ```ts
 * const auth = new BearerAuthStrategy("sk-...");
 * auth.getHeaders(); // { Authorization: "Bearer sk-..." }
 * ```
 */
export class BearerAuthStrategy implements IAuthStrategy {
  private readonly apiKey: string;

  /** Constructs a BearerAuthStrategy for the given API key. */
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /** Returns `{ Authorization: "Bearer <apiKey>" }`. */
  getHeaders(): Readonly<Record<string, string>> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}

/**
 * Attaches credentials via an arbitrary, vendor-defined header name.
 *
 * @example
 * ```ts
 * const auth = new HeaderAuthStrategy("x-api-key", "sk-...");
 * auth.getHeaders(); // { "x-api-key": "sk-..." }
 * ```
 */
export class HeaderAuthStrategy implements IAuthStrategy {
  private readonly headerName: string;
  private readonly apiKey: string;

  /** Constructs a HeaderAuthStrategy that sends `apiKey` under `headerName`. */
  constructor(headerName: string, apiKey: string) {
    this.headerName = headerName;
    this.apiKey = apiKey;
  }

  /** Returns `{ [headerName]: apiKey }`. */
  getHeaders(): Readonly<Record<string, string>> {
    return { [this.headerName]: this.apiKey };
  }
}

/**
 * Attaches no credentials at all, for providers that require none (e.g. a
 * locally-hosted Ollama instance).
 */
export class NoAuthStrategy implements IAuthStrategy {
  /** Returns an empty header set. */
  getHeaders(): Readonly<Record<string, string>> {
    return {};
  }
}
