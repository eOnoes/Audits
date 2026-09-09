import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalJson, canonicalSha256Digest, sha256Digest } from "../../src/compatibility/canonical-json.js";
import { MANAGED_IMPORT_LIMITS, MANAGED_IMPORT_SCHEMA, prepareManagedImport,
  readPreparedManagedFile, discardPreparedManagedImport, type PreparedManagedImport } from "../../src/build-only/windows-managed-import.js";

function entry(relativePath = "src/example.ts", bytes: Uint8Array = Buffer.from("fixed fixture")) {
  return { relativePath, contentBase64: Buffer.from(bytes).toString("base64"), sha256: sha256Digest(bytes) };
}
function wire(files = [entry()], extra = {}) {
  return Buffer.from(canonicalJson({ schemaVersion: MANAGED_IMPORT_SCHEMA, files, ...extra }));
}
function denied(frame: Uint8Array) {
  assert.throws(() => prepareManagedImport(frame), { message: "managed-import-invalid" });
}

test("managed import preserves binary bytes, exact paths and independently reproducible manifest", () => {
  const data = Buffer.from([0, 255, 128, 13, 10]);
  const files = [entry("bin/b.dat", data), entry("Docs/A.md", Buffer.alloc(0))];
  const prepared = prepareManagedImport(wire(files));
  assert.equal(prepared.kind, "prepared-content-not-authorization");
  assert.deepEqual(prepared.files.map((file) => file.relativePath), ["Docs/A.md", "bin/b.dat"]);
  assert.deepEqual(readPreparedManagedFile(prepared, "bin/b.dat"), data);
  assert.equal(prepared.manifestDigest, canonicalSha256Digest({ schemaVersion: MANAGED_IMPORT_SCHEMA, files: prepared.files }));
  // Separate construction, without invoking the subject's canonical/hash helper.
  const expected = JSON.stringify({ files: [
    { byteLength: 0, relativePath: "Docs/A.md", sha256: `sha256:${createHash("sha256").update(Buffer.alloc(0)).digest("hex")}` },
    { byteLength: 5, relativePath: "bin/b.dat", sha256: `sha256:${createHash("sha256").update(data).digest("hex")}` },
  ], schemaVersion: MANAGED_IMPORT_SCHEMA });
  assert.equal(prepared.manifestDigest, `sha256:${createHash("sha256").update(expected).digest("hex")}`);
  assert.equal(prepareManagedImport(wire([...files].reverse())).manifestDigest, prepared.manifestDigest);
  assert.deepEqual(prepared.summary, { status: "prepared", fileCount: 2, byteLength: 5 });
});

test("managed import owns copies and rejects serialized or prototype-forged read-back records", () => {
  const frame = wire();
  const prepared = prepareManagedImport(frame);
  frame.fill(0);
  const copy = readPreparedManagedFile(prepared, "src/example.ts");
  copy.fill(0);
  assert.equal(readPreparedManagedFile(prepared, "src/example.ts").toString(), "fixed fixture");
  assert.ok(Object.isFrozen(prepared) && Object.isFrozen(prepared.files) && Object.isFrozen(prepared.files[0]));
  for (const fake of [JSON.parse(JSON.stringify(prepared)), Object.create(prepared)]) {
    assert.throws(() => readPreparedManagedFile(fake as PreparedManagedImport, "src/example.ts"), /managed-import-invalid/);
  }
  assert.throws(() => readPreparedManagedFile(prepared, "SRC/example.ts"), /managed-import-invalid/);
  denied(new Uint8Array(new SharedArrayBuffer(4)));
});

test("managed import cancellation removes read-back without invalidating a separate preparation", () => {
  const prepared = prepareManagedImport(wire());
  const other = prepareManagedImport(wire());
  const delivered = readPreparedManagedFile(prepared, "src/example.ts");
  discardPreparedManagedImport(prepared);
  discardPreparedManagedImport(prepared);
  assert.throws(() => readPreparedManagedFile(prepared, "src/example.ts"), /managed-import-invalid/);
  assert.equal(readPreparedManagedFile(other, "src/example.ts").toString(), "fixed fixture");
  assert.equal(delivered.toString(), "fixed fixture"); // No false erasure guarantee.
  discardPreparedManagedImport(other);
});

test("managed import rejects ambiguous wire encodings and invalid UTF-8", () => {
  const valid = wire().toString();
  for (const text of [valid + "\n", " " + valid, valid + "{}", "\uFEFF" + valid,
    valid.replace('"files":', '"files":[],"files":'), '{"a":1e999}', "[]", "null"]) denied(Buffer.from(text));
  denied(Buffer.from([0xc3, 0x28]));
  denied(Buffer.alloc(0));
  denied(Buffer.alloc(MANAGED_IMPORT_LIMITS.frameBytes + 1));
});

test("managed import rejects authority/path/command and metadata smuggling", () => {
  for (const extra of [{ approved: true }, { target: "D:/managed" }, { command: "cmd" }, { service: "owner" }]) denied(wire([entry()], extra));
  for (const extra of [{ hardlink: true }, { executable: true }, { acl: "inherited" }, { target: "elsewhere" }]) denied(wire([{ ...entry(), ...extra }]));
  denied(wire([], {}));
  denied(wire([entry()], { schemaVersion: "other" }));
});

test("managed import rejects traversal, Windows aliases and source Git metadata", () => {
  for (const path of ["/abs", "C:/work", "\\\\host\\share", "a\\b", "../a", "a/../b", "a//b", "a/",
    "a/./b", "a:b", "PROGRA~1/a", "nul", "CON.txt", "com1/file", "lpt0.log", "a.", "a ", " a",
    ".git/config", "sub/.GIT/hooks/x", "é.txt", "a\u0000b", "a\n", "a\r\n", "CON .txt", "a".repeat(65),
    "a/".repeat(16) + "b", ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)].join("/")]) denied(wire([entry(path)]));
});

test("managed import rejects duplicate/case aliases including conflicting parent spellings and file/directory collisions", () => {
  for (const paths of [["a", "a"], ["A", "a"], ["Docs/a", "docs/b"], ["a", "a/b"], ["a/b", "a"]]) {
    denied(wire(paths.map((path) => entry(path))));
    denied(wire([...paths].reverse().map((path) => entry(path))));
  }
  assert.equal(prepareManagedImport(wire([entry("Docs/a"), entry("Docs/b")])).files.length, 2);
});

test("managed import cannot populate native I/O lock or staging namespaces", () => {
  for (const path of [".onoes-io.lock", "src/.ONOES-IO.LOCK", ".onoes-stage-x", "src/.ONOES-STAGE-x/a", ".onoes-import-seal", "src/.ONOES-IMPORT-pending/a"])
    denied(wire([entry(path)]));
  assert.equal(prepareManagedImport(wire([entry("onoes-io.lock"), entry(".onoes-other")])).files.length, 2);
});

test("managed import checks base64 canonical spelling and independently hashed contents", () => {
  const single = entry("a", Buffer.from("a"));
  for (const contentBase64 of ["YQ", "YQ=", "YQ==\n", "YR==", "YQ==!", "YQ__"]) denied(wire([{ ...single, contentBase64 }]));
  denied(wire([{ ...single, sha256: sha256Digest("different") }]));
  denied(wire([{ ...single, sha256: single.sha256.toUpperCase() }]));
  const before = prepareManagedImport(wire([single]));
  assert.notEqual(before.manifestDigest, prepareManagedImport(wire([entry("b", Buffer.from("a"))])).manifestDigest);
  assert.notEqual(before.manifestDigest, prepareManagedImport(wire([entry("a", Buffer.from("b"))])).manifestDigest);
});

test("managed import enforces predeclared file/count/aggregate byte caps with boundary positives", () => {
  const max = Buffer.alloc(MANAGED_IMPORT_LIMITS.fileBytes, 42);
  assert.equal(prepareManagedImport(wire(Array.from({ length: 4 }, (_, i) => entry(`f${i}`, max)))).summary.byteLength, MANAGED_IMPORT_LIMITS.totalBytes);
  denied(wire([entry("too-large", Buffer.alloc(MANAGED_IMPORT_LIMITS.fileBytes + 1))]));
  denied(wire([...Array.from({ length: 4 }, (_, i) => entry(`f${i}`, max)), entry("extra", Buffer.from("x"))]));
  assert.equal(prepareManagedImport(wire(Array.from({ length: 64 }, (_, i) => entry(`f${i}`, Buffer.alloc(0))))).files.length, 64);
  denied(wire(Array.from({ length: 65 }, (_, i) => entry(`f${i}`, Buffer.alloc(0)))));
});

test("managed import summary/error never includes submitted names, bytes or digest", () => {
  const secret = "fixture-private-content";
  const prepared = prepareManagedImport(wire([entry("private-file.txt", Buffer.from(secret))]));
  const summary = JSON.stringify(prepared.summary);
  for (const value of [secret, "private-file", sha256Digest(secret)]) assert.equal(summary.includes(value), false);
  denied(wire([entry(`../${secret}`)]));
  assert.equal("decision" in prepared, false);
  assert.equal("approved" in prepared, false);
});
