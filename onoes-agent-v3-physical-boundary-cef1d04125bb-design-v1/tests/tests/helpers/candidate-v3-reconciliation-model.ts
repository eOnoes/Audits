import { canonicalJson as wire, canonicalSha256Digest, sha256Digest } from "../../src/compatibility/canonical-json.js";
import { inspectSyntheticPairClaims } from "./candidate-v3-pair-claims.js";
import { pins, historyWire, type Frame } from "./candidate-v3-history-fixture.js";

// TEST-ONLY DESIGN MODEL. All "durable" state below is ordinary JS memory.
// No database, key, authentication, IPC, physical fence, task or effect exists.
// Reopening shares one fixture world; rotating is a simulated retirement claim,
// NEVER evidence that a real process or callback stopped. NOT a production port.
type Snapshot = { metadata: string; inventory: string; history: string };
type Journal = Readonly<{ key: string; confirmation: string; identity: readonly string[];
  anchor: string; candidate: string; phase: "prepared" | "contact-possible" | "witnessed" }>;
export class SyntheticRecoveryError extends Error {
  constructor() { super("synthetic-reconciliation-denied"); }
}
const fail = (): never => { throw new SyntheticRecoveryError(); };
export class SyntheticReconciliationWorld {
  // Public ONLY so a test driver can inject corruption/drift at exact cuts.
  local: Snapshot;
  now = 0;
  epoch = "synthetic-owner-1";
  #state: { anchor: string; journal: Journal | null };
  #active: { crash(): void } | null = null;
  #lastNow = -1; // Simulated authority clock survives client-lifetime reopening.
  preparations = 0;
  possibleMarkers = 0;
  anchorWrites = 0;
  constructor(frame: Frame, anchor = historyWire(frame.history.slice(0, -1))) {
    this.local = { metadata: pins, inventory: frame.input, history: historyWire(frame.history) };
    this.#state = { anchor, journal: null };
  }
  snapshot() {
    return Object.freeze({ kind: "synthetic-maintenance-state-not-persistence" as const,
      authority: "none" as const, ...this.#state, preparations: this.preparations,
      possibleMarkers: this.possibleMarkers, anchorWrites: this.anchorWrites });
  }
  corruptAnchorForTest(anchor: string) { this.#state = { ...this.#state, anchor }; }
  rotateAfterSimulatedRetirement(epoch: string) { this.#active?.crash(); this.epoch = epoch; }
  open() {
    if (this.#active) return fail();
    const epoch = this.epoch;
    let closed = false, canCommit = false;
    const crash = () => { closed = true; canCommit = false; if (this.#active === handle) this.#active = null; };
    const check = () => {
      if (closed || epoch !== this.epoch || !Number.isSafeInteger(this.now) || this.now < 0 || this.now < this.#lastNow) {
        crash(); return fail();
      }
      this.#lastNow = this.now;
    };
    const claims = () => inspectSyntheticPairClaims(this.local.metadata, this.local.inventory,
      this.local.history, this.#state.anchor);
    const expected = (expiresAt: number) => {
      check();
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now || expiresAt - this.now > 30_000) return fail();
      const pair = claims();
      if (pair.relation !== "one-ahead-claims") return fail();
      return wire({ domain: "synthetic-v3-maintenance-confirmation/v1", epoch, expiresAt,
        acknowledgeWitnessOnly: true, identity: pair.identity,
        anchorDigest: sha256Digest(this.#state.anchor), checkpointDigest: pair.identity[3] });
    };
    const checkedConfirmation = (input: unknown) => {
      check();
      if (typeof input !== "string" || Buffer.byteLength(input) > 4096) return fail();
      let c: { expiresAt: number };
      try { c = JSON.parse(input) as { expiresAt: number }; } catch { return fail(); }
      if (!c || input !== expected(c.expiresAt)) return fail();
      return input;
    };
    const currentJournal = (phase: Journal["phase"]) => {
      check(); const j = this.#state.journal;
      if (!j || j.phase !== phase) return fail();
      checkedConfirmation(j.confirmation);
      if (this.#state.anchor !== j.anchor || this.local.history !== j.candidate
        || wire(claims().identity) !== wire(j.identity)) return fail();
      return j;
    };
    const handle = Object.freeze({
      offer: (expiresAt: number) => expected(expiresAt),
      prepare: (input: unknown) => {
        const confirmation = checkedConfirmation(input);
        if (this.#state.journal) return fail(); // discover instead; new consent cannot reset a spent tuple
        const pair = claims();
        const key = canonicalSha256Digest({ domain: "synthetic-v3-maintenance-key/v1",
          metadataDigest: sha256Digest(this.local.metadata), anchorDigest: sha256Digest(this.#state.anchor),
          checkpointDigest: pair.identity[3] });
        const journal: Journal = Object.freeze({ key, confirmation, identity: pair.identity,
          anchor: this.#state.anchor, candidate: this.local.history, phase: "prepared" });
        this.#state = { ...this.#state, journal }; this.preparations++;
        return this.snapshot();
      },
      markPossible: () => {
        const j = currentJournal("prepared");
        this.#state = { ...this.#state, journal: Object.freeze({ ...j, phase: "contact-possible" }) };
        this.possibleMarkers++; canCommit = true;
        return this.snapshot();
      },
      commitExactTail: () => {
        if (!canCommit) return fail();
        canCommit = false; // failed handling also consumes this model lifetime's continuation
        const j = currentJournal("contact-possible");
        // One JS assignment models the REQUIRED atomic anchor+journal transaction.
        // It does not prove SQLite, flush, crash, power-loss or any physical property.
        this.#state = { anchor: j.candidate, journal: Object.freeze({ ...j, phase: "witnessed" }) };
        this.anchorWrites++;
        return this.snapshot();
      },
      discover: () => {
        check(); const pair = claims(), j = this.#state.journal;
        if (j && (wire(pair.identity) !== wire(j.identity) || this.local.history !== j.candidate
          || (j.phase === "witnessed" && pair.relation !== "equal-claims"))) return fail();
        return Object.freeze({ kind: "synthetic-discovery-not-owner-admission" as const, authority: "none" as const,
          relation: pair.relation, journalPhase: j?.phase ?? null,
          disposition: pair.relation === "equal-claims" ? "equal-claims-only" as const
            : j?.phase === "contact-possible" ? "unknown-consumed-no-retry" as const : "one-ahead-claims-only" as const });
      },
      crash,
    });
    this.#active = handle;
    return handle;
  }
}
