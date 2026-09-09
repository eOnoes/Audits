import type { ChatModel, ChatRequest, ChatResponse, ProviderFailureCode, ProviderHttpStatusClass, TokenUsage } from "../contracts/index.js";
import { chatResponseSchema, MAX_CHAT_RESPONSE_TEXT_LENGTH, MODEL_ID_PATTERN, MAX_MODEL_ID_LENGTH, MAX_TOKEN_USAGE_COUNT } from "../validation/schemas.js";
import { classifyProviderFailure, providerFailureForHttpStatus, ProviderResponseError } from "./provider-failure.js";

export { ProviderResponseError } from "./provider-failure.js";

export type OpenAICompatibleAuthMode = "bearer" | "api-key";
export type OpenAICompatibleResponseMode = "stream" | "json";
export type OpenAICompatibleInputMode = "messages" | "text";
export type OpenAICompatibleApiMode = "responses" | "chat-completions";

export interface OpenAIResponsesAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly authMode?: OpenAICompatibleAuthMode;
  readonly responseMode?: OpenAICompatibleResponseMode;
  readonly includeTextVerbosity?: boolean;
  readonly includeReasoning?: boolean;
  readonly inputMode?: OpenAICompatibleInputMode;
  readonly apiMode?: OpenAICompatibleApiMode;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

type CompletedResponse = { model?: unknown; usage?: unknown };
const INVALID_OPENAI_API_KEY_MESSAGE = "OpenAI API key is malformed";
const INVALID_OPENAI_ENDPOINT_MESSAGE = "OpenAI Responses endpoint is malformed";
const INVALID_OPENAI_MODEL_ID_MESSAGE = "OpenAI model id is malformed";
export const DEFAULT_OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const MAX_OPENAI_COMPATIBLE_ATTEMPTS = 3;
export const MAX_OPENAI_COMPATIBLE_RETRY_DELAY_MS = 5_000;
// Transport ceilings include metadata, ignored SSE events and incomplete event
// framing, not just returned answer text. Fetch/remote allocations are outside
// this parser's control. Total bytes are checked before decoding; decoded event
// sizes are checked before event JSON parsing, including ignored events.
export const MAX_OPENAI_COMPATIBLE_RESPONSE_BYTES = 2_097_152;
export const MAX_OPENAI_COMPATIBLE_EVENT_BYTES = 262_144;
export const MAX_OPENAI_COMPATIBLE_RESPONSE_CHUNKS = 32_768;

export class OpenAIResponsesAdapter implements ChatModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly authMode: OpenAICompatibleAuthMode;
  private readonly responseMode: OpenAICompatibleResponseMode;
  private readonly includeTextVerbosity: boolean;
  private readonly includeReasoning: boolean;
  private readonly inputMode: OpenAICompatibleInputMode;
  private readonly apiMode: OpenAICompatibleApiMode;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly options: OpenAIResponsesAdapterOptions) {
    if (!isWellFormedOpenAICompatibleApiKey(options.apiKey)) throw new Error(INVALID_OPENAI_API_KEY_MESSAGE);
    this.apiKey = options.apiKey.trim();
    this.model = normalizeOpenAIModelId(options.model ?? "gpt-5");
    this.apiMode = options.apiMode ?? "responses";
    this.endpoint = this.apiMode === "chat-completions"
      ? normalizeOpenAIChatCompletionsEndpoint(options.endpoint ?? DEFAULT_OPENAI_RESPONSES_BASE_URL)
      : normalizeOpenAIResponsesEndpoint(options.endpoint ?? DEFAULT_OPENAI_RESPONSES_ENDPOINT);
    this.authMode = options.authMode ?? "bearer";
    this.responseMode = options.responseMode ?? "stream";
    this.includeTextVerbosity = options.includeTextVerbosity ?? true;
    this.includeReasoning = options.includeReasoning ?? true;
    this.inputMode = options.inputMode ?? "messages";
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.maxAttempts = options.maxAttempts ?? 1;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.sleep = options.sleep ?? abortableSleep;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > MAX_OPENAI_COMPATIBLE_ATTEMPTS) {
      throw new RangeError("provider-max-attempts-invalid");
    }
    if (!Number.isInteger(this.retryBaseDelayMs) || this.retryBaseDelayMs < 0 || this.retryBaseDelayMs > MAX_OPENAI_COMPATIBLE_RETRY_DELAY_MS) {
      throw new RangeError("provider-retry-delay-invalid");
    }
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    // TypeScript's literal type is not a runtime boundary for JavaScript callers.
    // This override can only NARROW host policy, never replace it with a larger,
    // non-finite or coercible value. Snapshot once, before any provider effect.
    const requestedAttemptLimit = request.providerAttemptLimit;
    if (requestedAttemptLimit !== undefined && requestedAttemptLimit !== 1) {
      throw new ProviderResponseError("provider-bad-request", false, "none");
    }
    let retryCount = 0;
    const attemptLimit = request.purpose === "audit" || requestedAttemptLimit === 1 ? 1 : this.maxAttempts;
    while (true) {
      try {
        const response = await this.completeAttempt(request);
        if (request.signal.aborted) throw new ProviderResponseError("provider-cancelled", false, "none");
        return retryCount === 0 ? response : { ...response, providerRetryCount: retryCount };
      } catch (error) {
        const failure = classifyProviderFailure(error, request.signal);
        if (!this.canRetry(failure.code, failure.httpStatusClass, retryCount, request.signal, attemptLimit)) {
          throw new ProviderResponseError(failure.code, failure.retryable, failure.httpStatusClass, retryCount);
        }
        retryCount += 1;
        try {
          await this.sleep(this.retryDelayMs(retryCount), request.signal);
        } catch (sleepError) {
          const interrupted = classifyProviderFailure(sleepError, request.signal);
          throw new ProviderResponseError(interrupted.code, interrupted.retryable, interrupted.httpStatusClass, retryCount);
        }
      }
    }
  }

  private async completeAttempt(request: ChatRequest): Promise<ChatResponse> {
    if (request.signal.aborted) throw new ProviderResponseError("provider-cancelled", false, "none");
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { ...authHeaders(this.authMode, this.apiKey), "content-type": "application/json", accept: this.responseMode === "stream" && this.apiMode === "responses" ? "text/event-stream" : "application/json" },
        body: JSON.stringify(this.requestBody(request)),
        signal: request.signal,
      });
    } catch (error) {
      const failure = classifyProviderFailure(error, request.signal);
      throw new ProviderResponseError(failure.code, failure.retryable, failure.httpStatusClass);
    }
    if (!response.ok) throw providerFailureForHttpStatus(response.status);
    return this.responseMode === "stream" && this.apiMode === "responses" ? this.parseStreamingResponse(response, request) : this.parseJsonResponse(response, request);
  }

  private canRetry(
    code: ProviderFailureCode,
    statusClass: ProviderHttpStatusClass,
    retryCount: number,
    signal: AbortSignal,
    attemptLimit: number,
  ): boolean {
    if (signal.aborted || retryCount + 1 >= attemptLimit) return false;
    return code === "provider-rate-limited"
      || code === "provider-unavailable"
      || (code === "provider-timeout" && statusClass === "4xx");
  }

  private retryDelayMs(retryCount: number): number {
    return Math.min(MAX_OPENAI_COMPATIBLE_RETRY_DELAY_MS, this.retryBaseDelayMs * (2 ** (retryCount - 1)));
  }

  private requestBody(request: ChatRequest): Record<string, unknown> {
    if (this.apiMode === "chat-completions") {
      return {
        model: this.model,
        messages: [
          { role: "system", content: request.instructions },
          ...request.messages,
        ],
        max_completion_tokens: 1200,
        stream: false,
        thinking: { type: "disabled" },
      };
    }

    return {
      model: this.model,
      instructions: request.instructions,
      input: this.inputMode === "text" ? renderTextInput(request) : request.messages,
      ...(this.includeReasoning ? { reasoning: { effort: "low" } } : {}),
      ...(this.includeTextVerbosity ? { text: { verbosity: "medium" } } : {}),
      max_output_tokens: 1200,
      stream: this.responseMode === "stream",
      store: false,
    };
  }

  private async parseStreamingResponse(response: Response, request: ChatRequest): Promise<ChatResponse> {
    if (response.body === null) throw new ProviderResponseError("provider-malformed-response", false, "2xx");

    let text = "";
    let completed: CompletedResponse | undefined;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    const consume = (decoded: string) => {
      buffer += decoded;
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      if (Buffer.byteLength(buffer) > MAX_OPENAI_COMPATIBLE_EVENT_BYTES)
        throw new ProviderResponseError("provider-response-too-large", false, "2xx");
      for (const event of events) {
        if (Buffer.byteLength(event) > MAX_OPENAI_COMPATIBLE_EVENT_BYTES)
          throw new ProviderResponseError("provider-response-too-large", false, "2xx");
        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data === "" || data === "[DONE]") continue;
        const payload = parseEvent(data);
        if (payload["type"] === "response.output_text.delta" && typeof payload["delta"] === "string") {
          text = appendTextDelta(text, payload["delta"], request);
        } else if (payload["type"] === "response.completed" && isRecord(payload["response"])) {
          completed = payload["response"];
        } else if (payload["type"] === "response.incomplete" || payload["type"] === "error" || payload["type"] === "response.failed") {
          throw new ProviderResponseError("provider-incomplete-response", true, "2xx");
        }
      }
    };
    for await (const bytes of boundedResponseChunks(response, request.signal)) consume(decodeProviderBytes(decoder, bytes, true));
    consume(decodeProviderBytes(decoder));
    if (request.signal.aborted) throw new ProviderResponseError("provider-cancelled", false, "2xx");
    if (text.length === 0 || completed === undefined) throw new ProviderResponseError("provider-incomplete-response", true, "2xx");
    return chatResponseSchema.parse({ text, modelId: typeof completed.model === "string" ? normalizeProviderModelId(completed.model) : this.model, usage: parseUsage(completed.usage) });
  }

  private async parseJsonResponse(response: Response, request: ChatRequest): Promise<ChatResponse> {
    let payload: unknown;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const parts: string[] = [];
      for await (const bytes of boundedResponseChunks(response, request.signal)) parts.push(decodeProviderBytes(decoder, bytes, true));
      parts.push(decodeProviderBytes(decoder));
      if (request.signal.aborted) throw new ProviderResponseError("provider-cancelled", false, "2xx");
      payload = JSON.parse(parts.join(""));
    } catch (error) {
      if (error instanceof ProviderResponseError) throw error;
      throw new ProviderResponseError("provider-malformed-response", false, "2xx");
    }
    if (!isRecord(payload)) throw new ProviderResponseError("provider-malformed-response", false, "2xx");
    if (isRecord(payload["error"])) throw new ProviderResponseError("provider-incomplete-response", false, "2xx");
    if (payload["status"] === "incomplete" || payload["status"] === "failed") throw new ProviderResponseError("provider-incomplete-response", true, "2xx");
    const text = extractOpenAICompatibleResponseText(payload);
    if (text.length === 0) throw new ProviderResponseError("provider-incomplete-response", true, "2xx");
    if (text.length > MAX_CHAT_RESPONSE_TEXT_LENGTH) throw new ProviderResponseError("provider-response-too-large", false, "2xx");
    request.onTextDelta?.(text);
    return chatResponseSchema.parse({ text, modelId: typeof payload["model"] === "string" ? normalizeProviderModelId(payload["model"]) : this.model, usage: parseUsage(payload["usage"]) });
  }
}

function decodeProviderBytes(decoder: InstanceType<typeof TextDecoder>, bytes?: Uint8Array, stream = false): string {
  try { return decoder.decode(bytes, { stream }); }
  catch { throw new ProviderResponseError("provider-malformed-response", false, "2xx"); }
}

/** Cancel/release the local body reader on all early exits. A cancellation
 * request is not proof that the remote inference stopped or incurred no charge.
 * Observe rejection, but never wait indefinitely for a broken stream's cancel.
 * Callers still own the overall request deadline through the AbortSignal. */
async function* boundedResponseChunks(response: Response, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  if (signal.aborted) throw new ProviderResponseError("provider-cancelled", false, "2xx");
  if (response.body === null) throw new ProviderResponseError("provider-malformed-response", false, "2xx");
  const reader = response.body.getReader();
  let total = 0, chunks = 0, eof = false, cancelRequested = false;
  const cancel = () => {
    if (cancelRequested) return; cancelRequested = true;
    try { void reader.cancel().catch(() => {}); } catch { /* preserve the original typed failure */ }
  };
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => { cancel(); reject(new ProviderResponseError("provider-cancelled", false, "2xx")); };
  });
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    while (true) {
      const result = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw new ProviderResponseError("provider-cancelled", false, "2xx");
      if (result.done) { eof = true; return; }
      if (!(result.value instanceof Uint8Array)) throw new ProviderResponseError("provider-malformed-response", false, "2xx");
      total += result.value.byteLength; chunks++;
      if (total > MAX_OPENAI_COMPATIBLE_RESPONSE_BYTES || chunks > MAX_OPENAI_COMPATIBLE_RESPONSE_CHUNKS)
        throw new ProviderResponseError("provider-response-too-large", false, "2xx");
      yield result.value;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (!eof) cancel();
    reader.releaseLock();
  }
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function renderTextInput(request: ChatRequest): string {
  return request.messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}

function authHeaders(authMode: OpenAICompatibleAuthMode, apiKey: string): Record<string, string> {
  return authMode === "api-key" ? { "api-key": apiKey } : { authorization: `Bearer ${apiKey}` };
}

function appendTextDelta(text: string, delta: string, request: ChatRequest): string {
  if (text.length + delta.length > MAX_CHAT_RESPONSE_TEXT_LENGTH) throw new ProviderResponseError("provider-response-too-large", false, "2xx");
  request.onTextDelta?.(delta);
  return text + delta;
}

export function extractOpenAICompatibleResponseText(payload: Record<string, unknown>): string {
  if (typeof payload["output_text"] === "string") return payload["output_text"];

  const output = Array.isArray(payload["output"]) ? payload["output"] : [];
  const outputChunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    outputChunks.push(...extractContentText(item["content"]));
  }
  if (outputChunks.length > 0) return outputChunks.join("");

  const choices = Array.isArray(payload["choices"]) ? payload["choices"] : [];
  const choiceChunks: string[] = [];
  for (const choice of choices) {
    if (!isRecord(choice)) continue;
    if (typeof choice["text"] === "string") choiceChunks.push(choice["text"]);
    if (isRecord(choice["message"])) choiceChunks.push(...extractContentText(choice["message"]["content"]));
    if (isRecord(choice["delta"])) choiceChunks.push(...extractContentText(choice["delta"]["content"]));
  }
  return choiceChunks.join("");
}

function extractContentText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  const chunks: string[] = [];
  for (const part of value) {
    if (typeof part === "string") {
      chunks.push(part);
    } else if (isRecord(part) && (part["type"] === "output_text" || part["type"] === "text") && typeof part["text"] === "string") {
      chunks.push(part["text"]);
    }
  }
  return chunks;
}

function parseEvent(data: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(data);
    if (!isRecord(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new ProviderResponseError("provider-malformed-response", false, "2xx");
  }
}

function parseUsage(value: unknown): TokenUsage {
  if (!isRecord(value)) return { input: 0, cached: 0, reasoning: 0, output: 0 };
  const inputDetails = isRecord(value["input_tokens_details"]) ? value["input_tokens_details"] : isRecord(value["prompt_tokens_details"]) ? value["prompt_tokens_details"] : {};
  const outputDetails = isRecord(value["output_tokens_details"]) ? value["output_tokens_details"] : isRecord(value["completion_tokens_details"]) ? value["completion_tokens_details"] : {};
  return {
    input: firstInteger(value["input_tokens"], value["prompt_tokens"]),
    cached: integer(inputDetails["cached_tokens"]),
    reasoning: integer(outputDetails["reasoning_tokens"]),
    output: firstInteger(value["output_tokens"], value["completion_tokens"]),
  };
}

const integer = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TOKEN_USAGE_COUNT ? value : 0;
const firstInteger = (...values: readonly unknown[]): number => {
  for (const value of values) {
    const parsed = integer(value);
    if (parsed !== 0) return parsed;
  }
  return 0;
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const isWellFormedOpenAICompatibleApiKey = (value: string | undefined): boolean =>
  value !== undefined && /^(sk|tp)-[A-Za-z0-9_-]{16,}$/.test(value.trim());
const normalizeOpenAIModelId = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_MODEL_ID_LENGTH || !MODEL_ID_PATTERN.test(normalized)) throw new Error(INVALID_OPENAI_MODEL_ID_MESSAGE);
  return normalized;
};
const normalizeProviderModelId = (value: string): string => {
  try {
    return normalizeOpenAIModelId(value);
  } catch {
    throw new ProviderResponseError("provider-invalid-model", false, "2xx");
  }
};

function endpointFromBaseUrl(value: string, terminalPath: "/v1/responses" | "/v1/chat/completions"): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(INVALID_OPENAI_ENDPOINT_MESSAGE);
  }
  const isHttp = parsed.protocol === "https:" || parsed.protocol === "http:";
  const hasCredentials = parsed.username !== "" || parsed.password !== "";
  const hasQueryOrHash = parsed.search !== "" || parsed.hash !== "";
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (!isHttp || hasCredentials || hasQueryOrHash || !["/v1", terminalPath].includes(normalizedPath)) throw new Error(INVALID_OPENAI_ENDPOINT_MESSAGE);
  parsed.pathname = normalizedPath === "/v1" ? terminalPath : normalizedPath;
  return parsed.toString();
}

export const responsesEndpointFromBaseUrl = (value: string): string => endpointFromBaseUrl(value, "/v1/responses");
export const chatCompletionsEndpointFromBaseUrl = (value: string): string => endpointFromBaseUrl(value, "/v1/chat/completions");
export const normalizeOpenAIResponsesEndpoint = (value: string): string => responsesEndpointFromBaseUrl(value);
export const normalizeOpenAIChatCompletionsEndpoint = (value: string): string => chatCompletionsEndpointFromBaseUrl(value);
