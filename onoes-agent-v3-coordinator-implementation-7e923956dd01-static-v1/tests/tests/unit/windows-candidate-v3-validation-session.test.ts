import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson as wire, canonicalSha256Digest as hash, sha256Digest } from "../../src/compatibility/canonical-json.js";
import { CandidateV3MessageError, V3_MESSAGE_LIMITS, candidateV3EscapedBytes, boundedV3Text,
  encodeCandidateV3BootstrapRequest, encodeCandidateV3AppendRequest, parseCandidateV3Request,
  encodeCandidateV3Response, parseCandidateV3Response } from "../../src/build-only/windows-candidate-v3-messages.js";
import { createCandidateV3ValidationSession } from "../../src/build-only/windows-candidate-v3-validation-session.js";
import { inspectSyntheticPairClaims } from "../helpers/candidate-v3-pair-claims.js";
import { make, transcript, pins, envelope, historyWire, genesis } from "../helpers/candidate-v3-history-fixture.js";
import { uuid } from "../helpers/candidate-v3-record-fixture.js";
const lifetimeId = uuid(9000), epoch = uuid(9001), nonce = uuid(9002), binding = wire({ lifetimeId, epoch });
const signal = () => new AbortController().signal;
const empty = { inventory: envelope([]), history: historyWire([genesis]) };
const bootstrapHeader = () => ({ domain: "agent-candidate-v3-bootstrap-request/v1", operation: "bootstrap", lifetimeId, epoch, nonce,
  requestNumber: 0, deadline: V3_MESSAGE_LIMITS.bootstrapMs, anchorHistoryDigest: sha256Digest(empty.history) });
const boot = () => encodeCandidateV3BootstrapRequest(wire(bootstrapHeader()), pins, empty.inventory, empty.history);
const frames = (family = 0) => {
  const parent = family >= 5 ? make(0, 0) : undefined, f = make(family, 1, parent), fs = parent ? [parent, f] : [f];
  return transcript(fs, fs.flatMap((r, i) => Array(r.record.events.length + 1).fill(i) as number[]));
};
const appendHeader = (pre: readonly string[], requestNumber = 1) => ({ domain: "agent-candidate-v3-append-request/v1", operation: "append",
  lifetimeId, epoch, nonce: uuid(9002 + requestNumber), requestNumber, deadline: V3_MESSAGE_LIMITS.appendMs, pre });
const started = (clock = () => 0) => {
  const session = createCandidateV3ValidationSession(binding, clock), request = boot();
  const response = parseCandidateV3Response("bootstrap", session.request(request, signal()), request);
  return { session, response };
};
const rehash = (text: string, edit: (core: Record<string, any>) => void) => {
  const { resultDigest: _ignored, ...core } = JSON.parse(text); edit(core); return wire({ ...core, resultDigest: hash(core) });
};

test("dormant validation session: full bootstrap and all 53 family prefixes match the separate full-reference identity", t => {
  let appends = 0;
  for (let family = 0; family < 8; family++) {
    const { session, response } = started(); let pre = response.post, n = 0;
    assert.deepEqual(pre, inspectSyntheticPairClaims(pins, empty.inventory, empty.history, empty.history).identity);
    for (const f of frames(family)) {
      const request = encodeCandidateV3AppendRequest(wire(appendHeader(pre, ++n)), f.input, wire(f.checkpoint));
      const result = parseCandidateV3Response("append", session.request(request, signal()), request);
      const history = historyWire(f.history), expected = inspectSyntheticPairClaims(pins, f.input, history, history);
      assert.deepEqual(result.post, expected.identity); pre = result.post; appends++;
      assert.equal(session.status().phase, "ready"); assert.equal(session.status().requestNumber, n);
    }
    assert.equal(session.status().bootstrapAttempts, 1);
  }
  assert.equal(appends, 53);
  t.diagnostic("53 validation prefixes; zero storage/anchor/effect ports; not confirmed durable pairs");
});

test("message parser accepts only exact primitive canonical transport and expected operation", () => {
  let reflected = 0;
  const active = new Proxy({}, { get() { reflected++; throw Error("active"); }, ownKeys() { reflected++; return []; } });
  const request = boot();
  for (const bad of [active, new String(request), Buffer.from(request), null, "{}", request + "\n", "\uFEFF" + request,
    request.replace('"operation":"bootstrap"', '"operation":"bootstrap","operation":"bootstrap"')]) {
    assert.throws(() => parseCandidateV3Request("bootstrap", bad), CandidateV3MessageError);
  }
  assert.throws(() => parseCandidateV3Request("append", request), CandidateV3MessageError);
  assert.equal(reflected, 0);
  assert(Object.isFrozen(parseCandidateV3Request("bootstrap", request)));
});

test("request digests bind every inner wire and unknown keys never survive canonical parsing", () => {
  const bootstrap = JSON.parse(boot());
  for (const field of ["metadataWire", "inventoryWire", "historyWire", "metadataDigest", "inventoryDigest", "historyDigest", "extra"]) {
    const q = { ...bootstrap, [field]: field.endsWith("Digest") ? "sha256:" + "f".repeat(64) : "{}" };
    assert.throws(() => parseCandidateV3Request("bootstrap", wire(q)), CandidateV3MessageError, field);
  }
  const { response } = started(), f = frames()[0]!;
  const request = encodeCandidateV3AppendRequest(wire(appendHeader(response.post)), f.input, wire(f.checkpoint));
  for (const field of ["inventoryWire", "checkpointWire", "inputDigest", "checkpointDigest", "extra"]) {
    const q = { ...JSON.parse(request), [field]: field.endsWith("Digest") ? "sha256:" + "f".repeat(64) : "{}" };
    assert.throws(() => parseCandidateV3Request("append", wire(q)), CandidateV3MessageError, field);
  }
});

test("response parsing binds every echoed field even if an attacker recomputes resultDigest", () => {
  const request = boot(), session = createCandidateV3ValidationSession(binding, () => 0), result = session.request(request, signal());
  for (const field of ["lifetimeId", "epoch", "nonce", "deadline", "requestNumber", "anchorHistoryDigest", "metadataDigest",
    "inventoryDigest", "historyDigest", "requestDigest", "domain", "operation", "extra"]) {
    const bad = rehash(result, core => {
      if (["lifetimeId", "epoch", "nonce"].includes(field)) core[field] = uuid(999);
      else if (["deadline", "requestNumber"].includes(field)) core[field]++;
      else if (field.endsWith("Digest")) core[field] = "sha256:" + "f".repeat(64);
      else core[field] = "wrong";
    });
    assert.throws(() => parseCandidateV3Response("bootstrap", bad, request), CandidateV3MessageError, field);
  }
  assert.throws(() => parseCandidateV3Response("bootstrap", result + " ", request), CandidateV3MessageError);
  // A structurally valid post is a CLAIM. Caller/coordinator must compare it to
  // its staged snapshot: response validation alone is deliberately not proof.
  const alteredPost = rehash(result, core => { core["post"][3] = "sha256:" + "f".repeat(64); });
  assert.notDeepEqual(parseCandidateV3Response("bootstrap", alteredPost, request).post, JSON.parse(result).post);
});

test("append response for a previous request cannot satisfy the new private pending request", () => {
  const { session, response } = started(), fs = frames();
  const first = encodeCandidateV3AppendRequest(wire(appendHeader(response.post)), fs[0]!.input, wire(fs[0]!.checkpoint));
  const old = session.request(first, signal()), nextPre = parseCandidateV3Response("append", old, first).post;
  const next = encodeCandidateV3AppendRequest(wire(appendHeader(nextPre, 2)), fs[1]!.input, wire(fs[1]!.checkpoint));
  assert.throws(() => parseCandidateV3Response("append", old, next), CandidateV3MessageError);
  for (const field of ["pre", "inputDigest", "checkpointDigest"]) {
    const bad = rehash(old, core => { if (field === "pre") core[field][3] = "sha256:" + "f".repeat(64); else core[field] = "sha256:" + "f".repeat(64); });
    assert.throws(() => parseCandidateV3Response("append", bad, first), CandidateV3MessageError);
  }
});

test("failed bootstrap counts exactly once, closes permanently, and has no reset/import API", () => {
  let clocks = 0;
  for (const bad of ["{}", "", wire({ summary: "ready" }), boot() + "\n"]) {
    const s = createCandidateV3ValidationSession(binding, () => { clocks++; return 0; });
    assert.throws(() => s.request(bad, signal()), CandidateV3MessageError);
    assert.equal(s.status().phase, "closed"); assert.equal(s.status().bootstrapAttempts, 1);
    const before = clocks;
    for (let i = 0; i < 10; i++) assert.throws(() => s.request(boot(), signal()), CandidateV3MessageError);
    assert.equal(clocks, before); assert.equal(s.status().bootstrapAttempts, 1);
    assert.deepEqual(Object.keys(s).sort(), ["close", "request", "status"]);
  }
});

test("binding mismatch and one-ahead bootstrap claims close before any successful transcript", () => {
  for (const field of ["lifetimeId", "epoch", "anchorHistoryDigest"]) {
    const header = { ...bootstrapHeader(), [field]: field.endsWith("Digest") ? "sha256:" + "f".repeat(64) : uuid(111) };
    const request = encodeCandidateV3BootstrapRequest(wire(header), pins, empty.inventory, empty.history);
    const s = createCandidateV3ValidationSession(binding, () => 0);
    assert.throws(() => s.request(request, signal()), CandidateV3MessageError); assert.equal(s.status().phase, "closed");
  }
});

test("counter gaps, duplicate bootstrap and pre-state substitution close the persistent session", () => {
  for (const fault of ["counter", "bootstrap", "pre", "epoch", "lifetime"] as const) {
    const { session, response } = started(), f = frames()[0]!, h = appendHeader(response.post);
    if (fault === "counter") h.requestNumber = 2;
    if (fault === "pre") h.pre = [response.post[0], response.post[1], response.post[2], "sha256:" + "f".repeat(64)];
    if (fault === "epoch") h.epoch = uuid(111);
    if (fault === "lifetime") h.lifetimeId = uuid(111);
    const q = fault === "bootstrap" ? boot() : encodeCandidateV3AppendRequest(wire(h), f.input, wire(f.checkpoint));
    assert.throws(() => session.request(q, signal()), CandidateV3MessageError); assert.equal(session.status().phase, "closed");
    assert.throws(() => session.request(boot(), signal()), CandidateV3MessageError);
  }
});

test("coherent message with invalid record bytes poisons transcript rather than offering a retry", () => {
  const { session, response } = started(), f = frames()[0]!;
  const bad = encodeCandidateV3AppendRequest(wire(appendHeader(response.post)), "{}", wire(f.checkpoint));
  assert.throws(() => session.request(bad, signal()), CandidateV3MessageError);
  const good = encodeCandidateV3AppendRequest(wire(appendHeader(response.post)), f.input, wire(f.checkpoint));
  assert.throws(() => session.request(good, signal()), CandidateV3MessageError);
  assert.equal(session.status().requestNumber, 0); assert.equal(session.status().phase, "closed");
});

test("expiry before or after replay/encoding and invalid clocks close without a successful reply", () => {
  for (const expiryAt of [1, 2, 3, 4]) {
    let calls = 0; const s = createCandidateV3ValidationSession(binding, () => ++calls >= expiryAt ? V3_MESSAGE_LIMITS.bootstrapMs : 0);
    assert.throws(() => s.request(boot(), signal()), CandidateV3MessageError); assert.equal(s.status().phase, "closed");
  }
  for (const bad of [-1, NaN, Infinity, 0.5]) {
    const s = createCandidateV3ValidationSession(binding, () => bad);
    assert.throws(() => s.request(boot(), signal()), CandidateV3MessageError);
  }
  let time = 5; const { session, response } = started(() => time); time = 4;
  const f = frames()[0]!, q = encodeCandidateV3AppendRequest(wire(appendHeader(response.post)), f.input, wire(f.checkpoint));
  assert.throws(() => session.request(q, signal()), CandidateV3MessageError);
  const long = encodeCandidateV3BootstrapRequest(wire({ ...bootstrapHeader(), deadline: V3_MESSAGE_LIMITS.bootstrapMs + 1 }), pins, empty.inventory, empty.history);
  assert.throws(() => createCandidateV3ValidationSession(binding, () => 0).request(long, signal()), CandidateV3MessageError);
});

test("abort and explicit close cannot be revived by a later valid request", () => {
  for (const before of [true, false]) {
    const controller = new AbortController(); let calls = 0;
    const s = createCandidateV3ValidationSession(binding, () => { if (++calls === 3 && !before) controller.abort(); return 0; });
    if (before) controller.abort();
    assert.throws(() => s.request(boot(), controller.signal), CandidateV3MessageError);
    assert.equal(s.status().phase, "closed"); assert.throws(() => s.request(boot(), signal()), CandidateV3MessageError);
  }
  const { session } = started(); session.close(); session.close();
  assert.throws(() => session.request(boot(), signal()), CandidateV3MessageError);
});

test("reentrant busy request has no queue and does not poison the valid winner", () => {
  let reentered = false, loser = false;
  const s = createCandidateV3ValidationSession(binding, () => {
    if (!reentered) { reentered = true; assert.throws(() => s.request(boot(), signal()), CandidateV3MessageError); loser = true; }
    return 0;
  });
  const request = boot(); assert.equal(parseCandidateV3Response("bootstrap", s.request(request, signal()), request).requestNumber, 0);
  assert(loser); assert.equal(s.status().phase, "ready"); assert.equal(s.status().bootstrapAttempts, 1);
});

test("size preflight matches canonical UTF-8 escaping with exact cap, cap-minus-one and no active input inspection", () => {
  const samples = [...Array.from({ length: 256 }, (_, n) => String.fromCharCode(n)), "", "漢", "😀", "\u2028\u2029", '\\"\u0000😀é'];
  for (const s of samples) {
    const bytes = Buffer.byteLength(wire(s)) - 2;
    assert.equal(candidateV3EscapedBytes(s, bytes), bytes);
    if (bytes > 0) assert.throws(() => candidateV3EscapedBytes(s, bytes - 1), CandidateV3MessageError);
  }
  let reflected = false; const active = new Proxy({}, { get() { reflected = true; throw Error("active"); } });
  for (const value of [active, "\ud800", "\udc00", "\ud800x"]) assert.throws(() => candidateV3EscapedBytes(value, 100), CandidateV3MessageError);
  for (const budget of [-1, NaN, Infinity, 0.5, V3_MESSAGE_LIMITS.bootstrapBytes + 1]) assert.throws(() => candidateV3EscapedBytes("", budget), CandidateV3MessageError);
  assert.equal(reflected, false);
});

test("inner, header and response caps cannot be widened by the outer profile", () => {
  assert.throws(() => encodeCandidateV3BootstrapRequest(wire(bootstrapHeader()), "x".repeat(1025), empty.inventory, empty.history), CandidateV3MessageError);
  assert.throws(() => encodeCandidateV3AppendRequest("{}", "{}", "x".repeat(4097)), CandidateV3MessageError);
  const { response } = started();
  assert.throws(() => encodeCandidateV3AppendRequest(wire(appendHeader(response.post)), "{}", "x".repeat(4097)), CandidateV3MessageError);
  assert.throws(() => encodeCandidateV3BootstrapRequest("x".repeat(V3_MESSAGE_LIMITS.headerBytes + 1), pins, empty.inventory, empty.history), CandidateV3MessageError);
  assert.throws(() => parseCandidateV3Response("bootstrap", "x".repeat(V3_MESSAGE_LIMITS.responseBytes + 1), new Proxy({}, {})), CandidateV3MessageError);
  assert.throws(() => boundedV3Text("a".repeat(V3_MESSAGE_LIMITS.appendBytes + 1), V3_MESSAGE_LIMITS.appendBytes), CandidateV3MessageError);
});

test("public encoders do not inspect proxies, getters or toJSON inputs", () => {
  let touched = false; const active = new Proxy({}, { get() { touched = true; throw Error("active"); }, ownKeys() { touched = true; return []; } });
  assert.throws(() => encodeCandidateV3BootstrapRequest(active, pins, empty.inventory, empty.history), CandidateV3MessageError);
  assert.throws(() => encodeCandidateV3BootstrapRequest(wire(bootstrapHeader()), active, empty.inventory, empty.history), CandidateV3MessageError);
  assert.throws(() => encodeCandidateV3Response("bootstrap", boot(), active), CandidateV3MessageError);
  assert.throws(() => createCandidateV3ValidationSession(active, () => 0), CandidateV3MessageError);
  assert.equal(touched, false);
});

test("fresh nonempty bootstrap replays complete history then starts a new request counter at one", () => {
  const fs = frames(), prior = fs[3]!, next = fs[4]!, history = historyWire(prior.history);
  const header = { ...bootstrapHeader(), anchorHistoryDigest: sha256Digest(history) };
  const request = encodeCandidateV3BootstrapRequest(wire(header), pins, prior.input, history);
  const s = createCandidateV3ValidationSession(binding, () => 0);
  const b = parseCandidateV3Response("bootstrap", s.request(request, signal()), request);
  assert.deepEqual(b.post, inspectSyntheticPairClaims(pins, prior.input, history, history).identity);
  const append = encodeCandidateV3AppendRequest(wire(appendHeader(b.post)), next.input, wire(next.checkpoint));
  const r = parseCandidateV3Response("append", s.request(append, signal()), append), after = historyWire(next.history);
  assert.deepEqual(r.post, inspectSyntheticPairClaims(pins, next.input, after, after).identity);
  const missing = wire({ ...JSON.parse(history), checkpoints: JSON.parse(history).checkpoints.slice(1) });
  const bad = encodeCandidateV3BootstrapRequest(wire({ ...header, anchorHistoryDigest: sha256Digest(missing) }), pins, prior.input, missing);
  assert.throws(() => createCandidateV3ValidationSession(binding, () => 0).request(bad, signal()), CandidateV3MessageError);
});

test("response post-identity encoding requires an exact bounded four-tuple and carries no effect authority", () => {
  const q = boot(), d = "sha256:" + "0".repeat(64);
  for (const post of [wire([]), wire([d, d, d]), wire([d, d, d, d, d]), wire([d, d, d, "wrong"]), "x".repeat(4097)]) {
    assert.throws(() => encodeCandidateV3Response("bootstrap", q, post), CandidateV3MessageError);
  }
  const known = JSON.parse(q);
  const response = parseCandidateV3Response("bootstrap", encodeCandidateV3Response("bootstrap", q,
    wire([known.metadataDigest, known.inventoryDigest, known.historyDigest, d])), q);
  for (const key of ["authorized", "safeToExecute", "processStopped", "committed", "anchorConfirmed"]) assert.equal(key in response, false);
});

test("known post-state identities are checked independently of worker claims", () => {
  const q = boot(), s = createCandidateV3ValidationSession(binding, () => 0), r = s.request(q, signal());
  for (const index of [0, 1, 2]) {
    const bad = rehash(r, core => { core["post"][index] = "sha256:" + "f".repeat(64); });
    assert.throws(() => parseCandidateV3Response("bootstrap", bad, q), CandidateV3MessageError);
    const post = [...JSON.parse(r).post]; post[index] = "sha256:" + "f".repeat(64);
    assert.throws(() => encodeCandidateV3Response("bootstrap", q, wire(post)), CandidateV3MessageError);
  }
  const pre = parseCandidateV3Response("bootstrap", r, q).post, f = frames()[0]!;
  const a = encodeCandidateV3AppendRequest(wire(appendHeader(pre)), f.input, wire(f.checkpoint)), ar = s.request(a, signal());
  for (const index of [0, 1]) {
    const bad = rehash(ar, core => { core["post"][index] = "sha256:" + "f".repeat(64); });
    assert.throws(() => parseCandidateV3Response("append", bad, a), CandidateV3MessageError);
    const post = [...JSON.parse(ar).post]; post[index] = "sha256:" + "f".repeat(64);
    assert.throws(() => encodeCandidateV3Response("append", a, wire(post)), CandidateV3MessageError);
  }
});
