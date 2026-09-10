import assert from "node:assert/strict";
import test from "node:test";
import { createWindowsOperatorSession, OperatorSessionDenied, OPERATOR_PAIRING_TTL_MS,
  OPERATOR_PAIRING_MAX_ATTEMPTS, OPERATOR_SESSION_TTL_MS } from "../../src/build-only/windows-operator-session.js";

const denied = (operation: () => unknown): void => {
  assert.throws(operation, (error: unknown) => error instanceof OperatorSessionDenied
    && error.message === "operator-session-denied");
};

test("operator session denies before pairing and issues separate fixed-width credentials only once", () => {
  const setup = createWindowsOperatorSession(() => 0);
  assert.equal(Object.isFrozen(setup), true);
  assert.equal(Object.isFrozen(setup.session), true);
  assert.match(setup.bootstrapSecret, /^[a-f0-9]{64}$/);
  denied(() => setup.session.assertSession(setup.bootstrapSecret, setup.bootstrapSecret));
  const credentials = setup.session.pair(setup.bootstrapSecret);
  assert.equal(Object.isFrozen(credentials), true);
  assert.equal(credentials.sessionToken === credentials.csrfToken, false);
  assert.equal(credentials.sessionToken === setup.bootstrapSecret, false);
  assert.match(credentials.csrfToken, /^[a-f0-9]{64}$/);
  setup.session.assertSession(credentials.sessionToken, credentials.csrfToken);
  denied(() => setup.session.pair(setup.bootstrapSecret));
  setup.session.assertSession(credentials.sessionToken, credentials.csrfToken);
  assert.equal(JSON.stringify(setup.session), "{}");
});

test("pairing rejects malformed tokens and locks after the fixed attempt budget", () => {
  const setup = createWindowsOperatorSession(() => 0);
  const malformed: unknown[] = [undefined, {}, "a", "a".repeat(65), "g".repeat(64)];
  assert.equal(malformed.length, OPERATOR_PAIRING_MAX_ATTEMPTS);
  for (const value of malformed) denied(() => setup.session.pair(value));
  denied(() => setup.session.pair(setup.bootstrapSecret));
  const other = createWindowsOperatorSession(() => 0);
  for (let index = 1; index < OPERATOR_PAIRING_MAX_ATTEMPTS; index++) denied(() => other.session.pair("bad"));
  const paired = other.session.pair(other.bootstrapSecret);
  other.session.assertSession(paired.sessionToken, paired.csrfToken);
});

test("pairing expiry is inclusive and a correct expired bootstrap never creates a session", () => {
  let now = 0;
  const before = createWindowsOperatorSession(() => now);
  const at = createWindowsOperatorSession(() => now);
  now = OPERATOR_PAIRING_TTL_MS - 1;
  before.session.pair(before.bootstrapSecret);
  now++;
  denied(() => at.session.pair(at.bootstrapSecret));
});

test("both tokens are required; another process-session or swapped token pair is denied", () => {
  const left = createWindowsOperatorSession(() => 0);
  const right = createWindowsOperatorSession(() => 0);
  const a = left.session.pair(left.bootstrapSecret);
  const b = right.session.pair(right.bootstrapSecret);
  for (const pair of [[a.sessionToken, undefined], [undefined, a.csrfToken], [a.csrfToken, a.sessionToken],
    [b.sessionToken, b.csrfToken], [a.sessionToken, b.csrfToken], [a.sessionToken.toUpperCase(), a.csrfToken]]) {
    denied(() => left.session.assertSession(pair[0], pair[1]));
  }
  left.session.assertSession(a.sessionToken, a.csrfToken);
  right.session.assertSession(b.sessionToken, b.csrfToken);
});

test("session has an absolute lifetime, not a sliding lifetime extended by requests", () => {
  let now = 0;
  const setup = createWindowsOperatorSession(() => now);
  now = 1_000;
  const credentials = setup.session.pair(setup.bootstrapSecret);
  now += OPERATOR_SESSION_TTL_MS - 1;
  setup.session.assertSession(credentials.sessionToken, credentials.csrfToken);
  now++;
  denied(() => setup.session.assertSession(credentials.sessionToken, credentials.csrfToken));
  now = 1_000;
  denied(() => setup.session.assertSession(credentials.sessionToken, credentials.csrfToken));
});

test("revocation is permanent and idempotent before or after pairing", () => {
  const unpaired = createWindowsOperatorSession(() => 0);
  unpaired.session.revoke();
  unpaired.session.revoke();
  denied(() => unpaired.session.pair(unpaired.bootstrapSecret));
  const paired = createWindowsOperatorSession(() => 0);
  const credentials = paired.session.pair(paired.bootstrapSecret);
  paired.session.revoke();
  denied(() => paired.session.assertSession(credentials.sessionToken, credentials.csrfToken));
  denied(() => paired.session.pair(paired.bootstrapSecret));
});

test("invalid, throwing and regressed monotonic clocks fail closed permanently", () => {
  for (const invalid of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) denied(() => createWindowsOperatorSession(() => invalid));
  denied(() => createWindowsOperatorSession(() => { throw new Error("private-clock-detail"); }));
  for (const invalid of [0, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    let now = 1;
    const setup = createWindowsOperatorSession(() => now);
    const credentials = setup.session.pair(setup.bootstrapSecret);
    now = invalid;
    denied(() => setup.session.assertSession(credentials.sessionToken, credentials.csrfToken));
    now = 2;
    denied(() => setup.session.assertSession(credentials.sessionToken, credentials.csrfToken));
  }
  let fail = false;
  const setup = createWindowsOperatorSession(() => { if (fail) throw new Error("private-clock-detail"); return 0; });
  fail = true;
  denied(() => setup.session.pair(setup.bootstrapSecret));
  fail = false;
  denied(() => setup.session.pair(setup.bootstrapSecret));
});

test("new host session does not accept old pairing or session material", () => {
  const old = createWindowsOperatorSession(() => 0);
  const credentials = old.session.pair(old.bootstrapSecret);
  const restarted = createWindowsOperatorSession(() => 0);
  denied(() => restarted.session.pair(old.bootstrapSecret));
  const current = restarted.session.pair(restarted.bootstrapSecret);
  denied(() => restarted.session.assertSession(credentials.sessionToken, credentials.csrfToken));
  restarted.session.assertSession(current.sessionToken, current.csrfToken);
});
