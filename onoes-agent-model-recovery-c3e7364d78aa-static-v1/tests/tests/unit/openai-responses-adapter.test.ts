import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIResponsesAdapter, ProviderResponseError, MAX_OPENAI_COMPATIBLE_RESPONSE_BYTES,
  MAX_OPENAI_COMPATIBLE_EVENT_BYTES, MAX_OPENAI_COMPATIBLE_RESPONSE_CHUNKS } from "../../src/model/openai-responses-adapter.js";
import { TurnCallBudget } from "../../src/model/turn-call-budget.js";
import { MAX_CHAT_RESPONSE_TEXT_LENGTH } from "../../src/validation/schemas.js";

const request = (onTextDelta?: (delta: string) => void) => ({ traceId: "trace-1", threadId: "thread-1", instructions: "versioned context", messages: [{ role: "user" as const, content: "hello" }], signal: new AbortController().signal, ...(onTextDelta === undefined ? {} : { onTextDelta }) });
const API_KEY = "sk-test_12345678901234567890";
test("provider transport denies remote plaintext before fetch in both API and auth modes", () => {
  let calls = 0;
  for (const apiMode of ["responses", "chat-completions"] as const)
    for (const authMode of ["bearer", "api-key"] as const)
      for (const host of ["provider.example", "localhost.example", "localhost.", "192.168.1.10", "0.0.0.0", "[2001:db8::1]", "[::ffff:127.0.0.1]"]) {
        const endpoint = `http://${host}/v1`;
        assert.throws(() => new OpenAIResponsesAdapter({ apiKey: API_KEY, endpoint, apiMode, authMode,
          fetch: async () => { calls++; return new Response(null, { status: 401 }); } }),
        (error: unknown) => error instanceof Error && !error.message.includes(host) && !error.message.includes(API_KEY));
      }
  assert.equal(calls, 0);
});

test("provider transport retains HTTPS and canonical loopback HTTP configuration", () => {
  for (const apiMode of ["responses", "chat-completions"] as const)
    for (const endpoint of ["https://provider.example/v1", "http://127.0.0.1:11434/v1",
      "http://[::1]:11434/v1", "http://localhost:11434/v1", "http://LOCALHOST:11434/v1",
      "http://127.1:11434/v1"]) {
      assert.doesNotThrow(() => new OpenAIResponsesAdapter({ apiKey: API_KEY, endpoint, apiMode,
        fetch: async () => { assert.fail("configuration must not fetch"); } }));
    }
});

test("provider transport forbids fetch redirects for every API and auth mode", async () => {
  const observed: (string | undefined)[] = [];
  for (const apiMode of ["responses", "chat-completions"] as const)
    for (const authMode of ["bearer", "api-key"] as const)
      for (const endpoint of ["https://provider.example/v1", "http://127.0.0.1:11434/v1"]) {
        let calls = 0;
        const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, endpoint, apiMode, authMode,
          fetch: async (_input, init) => { calls++; observed.push(init?.redirect); return new Response(null, { status: 401 }); } });
        await assert.rejects(adapter.complete(request()), (error: unknown) => error instanceof ProviderResponseError);
        assert.equal(calls, 1);
      }
  assert.deepEqual(observed, Array(8).fill("error"));
});

test("runtime attempt policy preserves host ceilings and audit/single-attempt narrowing", async () => {
  for (const maxAttempts of [1, 2, 3]) for (const purpose of ["conversation", "extraction", "audit"] as const)
    for (const narrowed of [false, true]) {
      let calls = 0, sleeps = 0;
      const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, maxAttempts,
        sleep: async () => { sleeps++; }, fetch: async () => { calls++; return new Response(null, { status: 429 }); } });
      const expected = purpose === "audit" || narrowed ? 1 : maxAttempts;
      await assert.rejects(adapter.complete({ ...request(), purpose, ...(narrowed ? { providerAttemptLimit: 1 as const } : {}) }),
        (error: unknown) => error instanceof ProviderResponseError && error.code === "provider-rate-limited" && error.retryCount === expected - 1);
      assert.equal(calls, expected); assert.equal(sleeps, expected - 1);
    }
});

test("invalid audit overrides deny before fetch and cannot hide behind audit narrowing", async () => {
  let calls = 0;
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, maxAttempts: 3,
    fetch: async () => { calls++; return new Response(null, { status: 429 }); } });
  await assert.rejects(adapter.complete({ ...request(), purpose: "audit", providerAttemptLimit: 2 } as unknown as Parameters<typeof adapter.complete>[0]),
    (error: unknown) => error instanceof ProviderResponseError && error.code === "provider-bad-request"
      && error.httpStatusClass === "none" && error.retryCount === 0 && error.retryable === false);
  assert.equal(calls, 0);
});

test("attempt policy is frozen before retry backoff rather than reread from a mutable request", async () => {
  const input = request() as ReturnType<typeof request> & { providerAttemptLimit?: unknown };
  let calls = 0;
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, maxAttempts: 2,
    sleep: async () => { input.providerAttemptLimit = Infinity; },
    fetch: async () => { calls++; return new Response(null, { status: calls < 6 ? 429 : 401 }); } });
  await assert.rejects(adapter.complete(input as Parameters<typeof adapter.complete>[0]),
    (error: unknown) => error instanceof ProviderResponseError && error.code === "provider-rate-limited" && error.retryCount === 1);
  assert.equal(calls, 2);
});

test("runtime attempt overrides cannot widen or remove the host retry ceiling", async () => {
  const results = [];
  // The injected sixth response is terminal, so even an unbounded-retry defect
  // cannot turn this regression into an endless loop or any real provider call.
  for (const limit of [2, 4, NaN, Infinity, -1, 0, 1.5, "1", null, {}, true]) {
    let calls = 0, sleeps = 0;
    const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, maxAttempts: 1,
      sleep: async () => { sleeps++; }, fetch: async () => {
        calls++; return new Response(null, { status: calls < 6 ? 429 : 401 });
      } });
    let failure: unknown;
    try { await adapter.complete({ ...request(), providerAttemptLimit: limit } as unknown as Parameters<typeof adapter.complete>[0]); }
    catch (error) { failure = error; }
    results.push({ calls, sleeps, code: failure instanceof ProviderResponseError ? failure.code : "unexpected",
      retryable: failure instanceof ProviderResponseError ? failure.retryable : true });
  }
  assert.deepEqual(results, Array.from({ length: 11 }, () => ({ calls: 0, sleeps: 0, code: "provider-bad-request", retryable: false })));
});

const validSse = (text = "ok") => `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`
  + 'data: {"type":"response.completed","response":{"usage":{}}}\n\n';
const providerCode = (code: string) => (error: unknown) => {
  assert.ok(error instanceof ProviderResponseError); assert.equal(error.code, code); return true;
};

test("Responses adapter accepts the exact raw JSON ceiling but rejects the next byte", async () => {
  const base = JSON.stringify({ output_text: "ok", metadata: "", usage: {} });
  for (const extra of [0, 1]) {
    const body = JSON.stringify({ output_text: "ok", metadata: "x".repeat(MAX_OPENAI_COMPATIBLE_RESPONSE_BYTES - Buffer.byteLength(base) + extra), usage: {} });
    assert.equal(Buffer.byteLength(body), MAX_OPENAI_COMPATIBLE_RESPONSE_BYTES + extra);
    const response = new Response(body);
    Object.defineProperty(response, "json", { value: async () => { throw new Error("unbounded-json-reader-must-not-run"); } });
    const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, responseMode: "json", fetch: async () => response });
    if (extra === 0) assert.equal((await adapter.complete(request())).text, "ok");
    else await assert.rejects(adapter.complete(request()), providerCode("provider-response-too-large"));
    assert.equal(response.body?.locked, false);
  }
});

test("Responses adapter counts SSE event bytes, including multibyte and unfinished events", async () => {
  for (const [event, accepted] of [
    [": " + "x".repeat(MAX_OPENAI_COMPATIBLE_EVENT_BYTES - 2), true],
    [": " + "x".repeat(MAX_OPENAI_COMPATIBLE_EVENT_BYTES - 1), false],
    [": " + "é".repeat(MAX_OPENAI_COMPATIBLE_EVENT_BYTES / 2), false],
  ] as const) {
    const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, fetch: async () => new Response(event + "\n\n" + validSse()) });
    if (accepted) assert.equal((await adapter.complete(request())).text, "ok");
    else await assert.rejects(adapter.complete(request()), providerCode("provider-response-too-large"));
  }
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY,
    fetch: async () => new Response(validSse() + ": " + "x".repeat(MAX_OPENAI_COMPATIBLE_EVENT_BYTES)) });
  await assert.rejects(adapter.complete(request()), providerCode("provider-response-too-large"));
});

test("Responses adapter bounds cumulative stream bytes independently of individual event size", async () => {
  const comments = (": " + "x".repeat(65_530) + "\n\n").repeat(33);
  assert.ok(Buffer.byteLength(comments) > MAX_OPENAI_COMPATIBLE_RESPONSE_BYTES);
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, fetch: async () => new Response(comments + validSse()) });
  await assert.rejects(adapter.complete(request()), providerCode("provider-response-too-large"));
});

for (const mode of ["json", "stream"] as const) {
  test(`Responses adapter ${mode} decodes split UTF-8 and rejects invalid encoding`, async () => {
    const text = "é🌌", wire = Buffer.from(mode === "json" ? JSON.stringify({ output_text: text }) : validSse(text));
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset === wire.length) controller.close(); else controller.enqueue(wire.subarray(offset, ++offset));
    } }, { highWaterMark: 0 });
    const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, responseMode: mode, fetch: async () => new Response(body) });
    assert.equal((await adapter.complete(request())).text, text); assert.equal(body.locked, false);
    const invalid = Buffer.concat([wire.subarray(0, 5), Buffer.from([0xff]), wire.subarray(5)]);
    const malformed = new OpenAIResponsesAdapter({ apiKey: API_KEY, responseMode: mode, fetch: async () => new Response(invalid) });
    await assert.rejects(malformed.complete(request()), providerCode("provider-malformed-response"));
  });

  test(`Responses adapter ${mode} aborts a pending read without waiting for unconfirmed stream cancel`, async () => {
    const controller = new AbortController(); let entered!: () => void, releaseCancel!: () => void, cancels = 0;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pendingCancel = new Promise<void>(resolve => { releaseCancel = resolve; });
    const body = new ReadableStream<Uint8Array>({ pull() { entered(); }, cancel() { cancels++; return pendingCancel; } }, { highWaterMark: 0 });
    const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, responseMode: mode, fetch: async () => new Response(body) });
    try {
      const running = adapter.complete({ ...request(), signal: controller.signal });
      await Promise.race([ready, running.then(() => { throw new Error("pending read not reached"); })]);
      controller.abort(new Error("private-abort-detail"));
      await assert.rejects(running, providerCode("provider-cancelled"));
      assert.equal(cancels, 1); assert.equal(body.locked, false);
    } finally { releaseCancel(); }
  });

  test(`Responses adapter ${mode} does not accept completion after a delta callback aborts`, async () => {
    const controller = new AbortController();
    const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, responseMode: mode,
      fetch: async () => new Response(mode === "json" ? JSON.stringify({ output_text: "ok" }) : validSse()) });
    await assert.rejects(adapter.complete({ ...request(() => controller.abort()), signal: controller.signal }), providerCode("provider-cancelled"));
  });
}

test("Responses adapter cancels malformed streams once, releases the reader and never retries parsing failures", async () => {
  let pulls = 0, cancels = 0, fetches = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(Buffer.from("data: {private-invalid-json}\n\n")); },
    cancel() { cancels++; return Promise.reject(new Error("private-cancel-detail")); },
  }, { highWaterMark: 0 });
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, maxAttempts: 3,
    fetch: async () => { fetches++; return new Response(body); } });
  await assert.rejects(adapter.complete(request()), providerCode("provider-malformed-response"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(pulls, 1); assert.equal(cancels, 1); assert.equal(fetches, 1); assert.equal(body.locked, false);
});

test("Responses adapter bounds empty-chunk floods and cancels without another read", async () => {
  let pulls = 0, cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array()); }, cancel() { cancels++; },
  }, { highWaterMark: 0 });
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, responseMode: "json", fetch: async () => new Response(body) });
  await assert.rejects(adapter.complete(request()), providerCode("provider-response-too-large"));
  assert.equal(pulls, MAX_OPENAI_COMPATIBLE_RESPONSE_CHUNKS + 1); assert.equal(cancels, 1); assert.equal(body.locked, false);
});

test("Responses adapter rejects an already-cancelled request before fetch", async () => {
  let fetches = 0; const controller = new AbortController(); controller.abort();
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, fetch: async () => { fetches++; return new Response(validSse()); } });
  await assert.rejects(adapter.complete({ ...request(), signal: controller.signal }), providerCode("provider-cancelled"));
  assert.equal(fetches, 0);
});

test("Responses adapter bounds raw JSON metadata before accepting a small answer", async () => {
  const body = JSON.stringify({ output_text: "ok", metadata: "x".repeat(2_097_152), usage: {} });
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, responseMode: "json",
    fetch: async () => new Response(body, { headers: { "content-length": "1" } }) });
  await assert.rejects(adapter.complete(request()), (error: unknown) => {
    assert.ok(error instanceof ProviderResponseError); assert.equal(error.code, "provider-response-too-large"); return true;
  });
});

test("Responses adapter bounds ignored streaming events before accepting a small answer", async () => {
  const body = `: ${"x".repeat(262_144)}\n\n`
    + 'data: {"type":"response.output_text.delta","delta":"ok"}\n\n'
    + 'data: {"type":"response.completed","response":{"usage":{}}}\n\n';
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, fetch: async () => new Response(body) });
  await assert.rejects(adapter.complete(request()), (error: unknown) => {
    assert.ok(error instanceof ProviderResponseError); assert.equal(error.code, "provider-response-too-large"); return true;
  });
});

test("Responses adapter sends the bounded gpt-5 streaming contract and accounts for tokens", async () => {
  let body: Record<string, unknown> | undefined;
  let authorization = "";
  const deltas: string[] = [];
  const events = [
    { type: "response.output_text.delta", delta: "Hello" },
    { type: "response.output_text.delta", delta: " there" },
    { type: "response.completed", response: { model: "gpt-5.6-terra-2026-08-01", usage: { input_tokens: 40, input_tokens_details: { cached_tokens: 12 }, output_tokens: 9, output_tokens_details: { reasoning_tokens: 3 } } } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const adapter = new OpenAIResponsesAdapter({ apiKey: ` ${API_KEY} `, fetch: async (_url, init) => { body = JSON.parse(String(init?.body)) as Record<string, unknown>; authorization = String((init?.headers as Record<string, string> | undefined)?.["authorization"]); return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } }); } });
  const response = await adapter.complete(request((delta) => deltas.push(delta)));
  assert.equal(authorization, `Bearer ${API_KEY}`);
  assert.equal(body?.["model"], "gpt-5");
  assert.equal(body?.["stream"], true);
  assert.equal(body?.["store"], false);
  assert.equal(body?.["max_output_tokens"], 1200);
  assert.deepEqual(body?.["reasoning"], { effort: "low" });
  assert.deepEqual(body?.["text"], { verbosity: "medium" });
  assert.deepEqual(deltas, ["Hello", " there"]);
  assert.deepEqual(response, { text: "Hello there", modelId: "gpt-5.6-terra-2026-08-01", usage: { input: 40, cached: 12, reasoning: 3, output: 9 } });
});

test("Responses adapter rejects malformed API keys before fetch", () => {
  let calls = 0;
  assert.throws(
    () =>
      new OpenAIResponsesAdapter({
        apiKey: "openai-secret-from-D:\\private\\token.txt",
        fetch: async () => {
          calls += 1;
          return new Response("", { status: 200 });
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "OpenAI API key is malformed");
      assert.equal(error.message.includes("openai-secret"), false);
      assert.equal(error.message.includes("D:\\private\\token.txt"), false);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("Responses adapter normalizes a valid Responses endpoint before fetch", async () => {
  let url = "";
  const events = [
    { type: "response.output_text.delta", delta: "ok" },
    { type: "response.completed", response: { model: "gpt-5.6-terra-2026-08-01", usage: {} } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, endpoint: " https://api.openai.com/v1/responses ", fetch: async (input) => { url = String(input); return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } }); } });
  await adapter.complete(request());
  assert.equal(url, "https://api.openai.com/v1/responses");
});


test("Responses adapter supports MiMo token-plan chat-completions route and api-key auth", async () => {
  let url = "";
  let apiKeyHeader = "";
  let authorization = "";
  let body: Record<string, unknown> | undefined;
  const adapter = new OpenAIResponsesAdapter({
    apiKey: "tp-test_12345678901234567890",
    model: "mimo-v2.5",
    endpoint: "https://token-plan-sgp.xiaomimimo.com/v1",
    authMode: "api-key",
    responseMode: "json",
    apiMode: "chat-completions",
    fetch: async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const headers = init?.headers as Record<string, string> | undefined;
      apiKeyHeader = String(headers?.["api-key"] ?? "");
      authorization = String(headers?.["authorization"] ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], model: "mimo-v2.5", usage: {} }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const response = await adapter.complete(request());
  assert.equal(url, "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions");
  assert.equal(apiKeyHeader, "tp-test_12345678901234567890");
  assert.equal(authorization, "");
  assert.equal(body?.["max_completion_tokens"], 1200);
  assert.deepEqual(body?.["thinking"], { type: "disabled" });
  assert.equal(Array.isArray(body?.["messages"]), true);
  assert.equal(response.modelId, "mimo-v2.5");
  assert.equal(response.text, "ok");
});
test("Responses adapter parses non-stream JSON output for MiMo-compatible providers", async () => {
  let body: Record<string, unknown> | undefined;
  const deltas: string[] = [];
  const adapter = new OpenAIResponsesAdapter({
    apiKey: "tp-test_12345678901234567890",
    model: "mimo-v2.5",
    endpoint: "https://token-plan-sgp.xiaomimimo.com/v1",
    authMode: "api-key",
    responseMode: "json",
    apiMode: "chat-completions",
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "mimo-v2.5",
        choices: [{ message: { role: "assistant", content: "Hello from MiMo." } }],
        usage: { prompt_tokens: 3, prompt_tokens_details: { cached_tokens: 1 }, completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 2 } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const response = await adapter.complete(request((delta) => deltas.push(delta)));
  assert.equal(body?.["stream"], false);
  assert.deepEqual(body?.["thinking"], { type: "disabled" });
  assert.equal(Object.hasOwn(body ?? {}, "input"), false);
  assert.equal(Object.hasOwn(body ?? {}, "text"), false);
  assert.equal(Object.hasOwn(body ?? {}, "reasoning"), false);
  assert.deepEqual(deltas, ["Hello from MiMo."]);
  assert.deepEqual(response, { text: "Hello from MiMo.", modelId: "mimo-v2.5", usage: { input: 3, cached: 1, reasoning: 2, output: 4 } });
});
test("Responses adapter parses non-stream output content arrays when output_text is absent", async () => {
  const adapter = new OpenAIResponsesAdapter({
    apiKey: API_KEY,
    responseMode: "json",
    fetch: async () => new Response(JSON.stringify({
      status: "completed",
      model: "gpt-5",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }, { type: "text", text: " there" }] }],
      usage: {},
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const response = await adapter.complete(request());
  assert.equal(response.text, "Hello there");
});

test("Responses adapter parses OpenAI-compatible chat choices from JSON providers", async () => {
  const adapter = new OpenAIResponsesAdapter({
    apiKey: "tp-test_12345678901234567890",
    model: "mimo-v2.5",
    endpoint: "https://token-plan-sgp.xiaomimimo.com/v1",
    authMode: "api-key",
    responseMode: "json",
    includeTextVerbosity: false,
    includeReasoning: false,
    inputMode: "text",
    fetch: async () => new Response(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      model: "mimo-v2.5",
      choices: [{ message: { role: "assistant", content: "Hello from a chat-compatible shape." } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const response = await adapter.complete(request());
  assert.equal(response.text, "Hello from a chat-compatible shape.");
  assert.equal(response.modelId, "mimo-v2.5");
});
test("Responses adapter rejects malformed or incomplete non-stream JSON without leaking payload text", async () => {
  for (const payload of [
    { error: { message: "raw provider secret" } },
    { status: "incomplete", output_text: "partial secret" },
    { status: "completed", output_text: "" },
  ]) {
    const adapter = new OpenAIResponsesAdapter({
      apiKey: API_KEY,
      responseMode: "json",
      fetch: async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
    });
    await assert.rejects(adapter.complete(request()), (error: unknown) => {
      assert.ok(error instanceof ProviderResponseError);
      assert.equal(error.message.includes("secret"), false);
      return true;
    });
  }
});
test("Responses adapter rejects malformed Responses endpoints before fetch", () => {
  for (const endpoint of ["ftp://api.openai.com/v1/responses", "https://user:pass@api.openai.com/v1/responses", "https://api.openai.com/v1/responses?api_key=secret", "https://api.openai.com/v1/responses#secret", "https://api.openai.com/v1/chat/completions", "D:\\private\\responses"]) {
    let calls = 0;
    assert.throws(
      () =>
        new OpenAIResponsesAdapter({
          apiKey: API_KEY,
          endpoint,
          fetch: async () => {
            calls += 1;
            return new Response("", { status: 200 });
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "OpenAI Responses endpoint is malformed");
        assert.equal(error.message.includes(endpoint), false);
        assert.equal(error.message.includes("secret"), false);
        return true;
      },
    );
    assert.equal(calls, 0);
  }
});

test("Responses adapter rejects malformed configured model ids before fetch", () => {
  let calls = 0;
  assert.throws(
    () =>
      new OpenAIResponsesAdapter({
        apiKey: API_KEY,
        model: "sk-secret-model-from-D:\\private\\model.txt",
        fetch: async () => {
          calls += 1;
          return new Response("", { status: 200 });
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "OpenAI model id is malformed");
      assert.equal(error.message.includes("sk-secret-model"), false);
      assert.equal(error.message.includes("D:\\private\\model.txt"), false);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("Responses adapter rejects oversized streamed text before emitting the overflow delta", async () => {
  const deltas: string[] = [];
  const overflow = `secret-start-${"x".repeat(MAX_CHAT_RESPONSE_TEXT_LENGTH)}-secret-end`;
  const events = [
    { type: "response.output_text.delta", delta: overflow },
    { type: "response.completed", response: { model: "gpt-5.6-terra-2026-08-01", usage: {} } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, fetch: async () => new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } }) });
  await assert.rejects(adapter.complete(request((delta) => deltas.push(delta))), (error: unknown) => {
    assert.ok(error instanceof ProviderResponseError);
    assert.equal(error.message, "provider-response-too-large");
    assert.equal(error.code, "provider-response-too-large");
    assert.equal(error.retryable, false);
    assert.equal(error.message.includes("secret-start"), false);
    assert.equal(error.message.includes("secret-end"), false);
    return true;
  });
  assert.deepEqual(deltas, []);
});

test("Responses adapter rejects malformed provider model ids with sanitized text", async () => {
  const events = [
    { type: "response.output_text.delta", delta: "ok" },
    { type: "response.completed", response: { model: "https://secret.invalid/model?key=sk-secret123456", usage: {} } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, fetch: async () => new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } }) });
  await assert.rejects(adapter.complete(request()), (error: unknown) => {
    assert.ok(error instanceof ProviderResponseError);
    assert.equal(error.code, "provider-invalid-model");
    assert.equal(error.message, "provider-invalid-model");
    assert.equal(error.message.includes("https://secret.invalid"), false);
    assert.equal(error.message.includes("sk-secret123456"), false);
    return true;
  });
});

test("Responses adapter normalizes unsafe provider token usage counts", async () => {
  const events = [
    { type: "response.output_text.delta", delta: "ok" },
    {
      type: "response.completed",
      response: {
        model: "gpt-5.6-terra-2026-08-01",
        usage: {
          input_tokens: 1_000_001,
          input_tokens_details: { cached_tokens: 9_007_199_254_740_992 },
          output_tokens: 1.5,
          output_tokens_details: { reasoning_tokens: -1 },
        },
      },
    },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, fetch: async () => new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } }) });
  const response = await adapter.complete(request());
  assert.deepEqual(response.usage, { input: 0, cached: 0, reasoning: 0, output: 0 });
});

test("provider errors are surfaced after exactly one request with no adapter retry", async () => {
  let calls = 0;
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, fetch: async () => { calls += 1; return new Response("unavailable", { status: 503 }); } });
  await assert.rejects(adapter.complete(request()), ProviderResponseError);
  assert.equal(calls, 1);
});

test("explicit retry policy recovers only an acknowledged transient HTTP failure", async () => {
  let calls = 0;
  const delays: number[] = [];
  const adapter = new OpenAIResponsesAdapter({
    apiKey: API_KEY,
    responseMode: "json",
    maxAttempts: 2,
    retryBaseDelayMs: 10,
    sleep: async (delayMs) => { delays.push(delayMs); },
    fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ output_text: "recovered", model: "gpt-5", usage: {} }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const response = await adapter.complete(request());

  assert.equal(calls, 2);
  assert.deepEqual(delays, [10]);
  assert.equal(response.text, "recovered");
  assert.equal(response.providerRetryCount, 1);
});

test("audit requests force one provider attempt even when adapter retries are enabled", async () => {
  let calls = 0;
  const delays: number[] = [];
  const adapter = new OpenAIResponsesAdapter({
    apiKey: API_KEY,
    maxAttempts: 3,
    retryBaseDelayMs: 10,
    sleep: async (delayMs) => { delays.push(delayMs); },
    fetch: async () => { calls += 1; return new Response("unavailable", { status: 503 }); },
  });

  await assert.rejects(
    adapter.complete({ ...request(), purpose: "audit", providerAttemptLimit: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderResponseError);
      assert.equal(error.code, "provider-unavailable");
      assert.equal(error.retryCount, 0);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("explicit retry policy is exponentially bounded and reports exhausted attempts", async () => {
  let calls = 0;
  const delays: number[] = [];
  const adapter = new OpenAIResponsesAdapter({
    apiKey: API_KEY,
    maxAttempts: 3,
    retryBaseDelayMs: 10,
    sleep: async (delayMs) => { delays.push(delayMs); },
    fetch: async () => { calls += 1; return new Response("private provider payload", { status: 503 }); },
  });

  await assert.rejects(adapter.complete(request()), (error: unknown) => {
    assert.ok(error instanceof ProviderResponseError);
    assert.equal(error.code, "provider-unavailable");
    assert.equal(error.retryCount, 2);
    assert.equal(error.message.includes("private provider payload"), false);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("cancellation interrupts retry backoff before another provider request", async () => {
  let calls = 0;
  const cancellation = new AbortController();
  const adapter = new OpenAIResponsesAdapter({
    apiKey: API_KEY,
    maxAttempts: 3,
    sleep: async (_delayMs, signal) => {
      cancellation.abort(new DOMException("operator cancelled", "AbortError"));
      throw signal.reason;
    },
    fetch: async () => { calls += 1; return new Response("unavailable", { status: 503 }); },
  });

  await assert.rejects(adapter.complete({ ...request(), signal: cancellation.signal }), (error: unknown) => {
    assert.ok(error instanceof ProviderResponseError);
    assert.equal(error.code, "provider-cancelled");
    assert.equal(error.retryCount, 1);
    return true;
  });
  assert.equal(calls, 1);
});

test("retry constructor bounds fail closed", () => {
  assert.throws(() => new OpenAIResponsesAdapter({ apiKey: API_KEY, maxAttempts: 0 }), /provider-max-attempts-invalid/);
  assert.throws(() => new OpenAIResponsesAdapter({ apiKey: API_KEY, maxAttempts: 4 }), /provider-max-attempts-invalid/);
  assert.throws(() => new OpenAIResponsesAdapter({ apiKey: API_KEY, retryBaseDelayMs: 5001 }), /provider-retry-delay-invalid/);
});

test("HTTP failures map to stable redacted retry policy", async () => {
  const cases = [
    { status: 401, code: "provider-unauthorized", retryable: false, statusClass: "4xx" },
    { status: 429, code: "provider-rate-limited", retryable: true, statusClass: "4xx" },
    { status: 503, code: "provider-unavailable", retryable: true, statusClass: "5xx" },
  ] as const;
  for (const item of cases) {
    const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, fetch: async () => new Response("raw provider secret", { status: item.status }) });
    await assert.rejects(adapter.complete(request()), (error: unknown) => {
      assert.ok(error instanceof ProviderResponseError);
      assert.equal(error.code, item.code);
      assert.equal(error.retryable, item.retryable);
      assert.equal(error.httpStatusClass, item.statusClass);
      assert.equal(error.message.includes("secret"), false);
      return true;
    });
  }
});

test("network failures become retryable stable codes without leaking transport text", async () => {
  let calls = 0;
  const adapter = new OpenAIResponsesAdapter({ apiKey: API_KEY, maxAttempts: 3, fetch: async () => { calls += 1; throw new TypeError("DNS failure at private host"); } });
  await assert.rejects(adapter.complete(request()), (error: unknown) => {
    assert.ok(error instanceof ProviderResponseError);
    assert.equal(error.code, "provider-network");
    assert.equal(error.retryable, true);
    assert.equal(error.httpStatusClass, "none");
    assert.equal(error.message.includes("private host"), false);
    return true;
  });
  assert.equal(calls, 1);
});

test("turn budget permits at most one call for each of the two purposes", () => {
  const budget = new TurnCallBudget();
  budget.consume("conversation");
  budget.consume("extraction");
  assert.throws(() => budget.consume("conversation"), /budget exhausted/);
  assert.throws(() => budget.consume("extraction"), /budget exhausted/);
});
