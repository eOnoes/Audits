import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WINDOWS_WORKSPACE_POLICY,
  WINDOWS_WORKSPACE_POLICY_VERSION,
  parseWindowsWorkspacePolicy,
  previewWindowsWorkspaceAccess,
} from "../../src/build-only/windows-workspace-policy.js";

function policy() {
  return {
    schemaVersion: WINDOWS_WORKSPACE_POLICY_VERSION,
    revision: 2,
    allowedRoots: [{ path: "D:\\Projects", access: "read-write" }],
    deniedRoots: ["C:\\", "D:\\Projects\\private"],
  };
}

function preview(path: string, operation = "read", settings: unknown = policy()) {
  return previewWindowsWorkspaceAccess(settings, { path, operation });
}

test("workspace default denies all task roots and explicitly denies C", () => {
  assert.equal(preview("D:\\Projects\\a.ts", "read", DEFAULT_WINDOWS_WORKSPACE_POLICY).reason, "outside-allowed-roots");
  assert.equal(preview("c:/Users/alice/note.txt", "read", DEFAULT_WINDOWS_WORKSPACE_POLICY).reason, "explicit-deny");
  assert.equal(preview("C:\\Users\\alice\\note.txt", "write", DEFAULT_WINDOWS_WORKSPACE_POLICY).decision, "denied");
  assert.ok(Object.isFrozen(DEFAULT_WINDOWS_WORKSPACE_POLICY.deniedRoots));
});

test("whole-drive denial wins over an explicitly selected nested C workspace", () => {
  const settings = policy();
  settings.allowedRoots.push({ path: "C:\\Work", access: "read-write" });
  for (const operation of ["read", "write"]) {
    assert.equal(preview("C:/Work/task.txt", operation, settings).reason, "explicit-deny");
    assert.equal(preview("c:\\WORK\\task.txt", operation, settings).decision, "denied");
  }
  // Only an explicit different settings value removes the deny; a task cannot.
  settings.deniedRoots = [];
  assert.equal(preview("C:\\Work\\task.txt", "read", settings).decision, "requires-filesystem-validation");
});

test("denies beat allows regardless of order, case, and separator spelling", () => {
  const settings = policy();
  settings.allowedRoots.push({ path: "D:\\Projects\\private\\nested", access: "read-write" });
  for (const path of ["D:/Projects/private", "d:\\PROJECTS\\PRIVATE\\a.txt", "D:/Projects/private/nested/a"]) {
    for (const operation of ["read", "write"]) assert.equal(preview(path, operation, settings).reason, "explicit-deny");
  }
  assert.equal(preview("D:/Projects/private-not/a.txt").reason, "lexical-scope-match");
});

test("scope matches respect directory boundaries rather than raw prefixes", () => {
  for (const path of ["D:/Projects", "D:\\Projects\\a.ts", "d:/projects/sub/file.md"]) {
    assert.deepEqual(preview(path), { decision: "requires-filesystem-validation", reason: "lexical-scope-match", policyRevision: 2 });
  }
  for (const path of ["D:/Projects2/file", "E:/Projects/file", "D:/Other/Projects/file"]) {
    assert.equal(preview(path).reason, "outside-allowed-roots");
  }
});

test("most specific read-only root narrows a broader write root", () => {
  const settings = policy();
  settings.allowedRoots.push({ path: "D:/Projects/vendor/", access: "read-only" });
  for (let iteration = 0; iteration < 2; iteration++) {
    assert.equal(preview("D:/Projects/vendor/a", "write", settings).reason, "read-only-root");
    assert.equal(preview("D:/Projects/vendor/a", "read", settings).decision, "requires-filesystem-validation");
    assert.equal(preview("D:/Projects/other/a", "write", settings).decision, "requires-filesystem-validation");
    settings.allowedRoots.reverse();
  }
});

test("malformed or ambiguous Windows paths deny instead of normalizing into scope", () => {
  const paths = [
    "", "D:", "D:Projects/a", "/Projects/a", "Projects/a", "D:/", "D:/Projects/../other/a",
    "D:/Projects/./a", "D:/Projects//a", "D:/Projects/a//", "D:/Projects/a.", "D:/Projects/a ",
    "D:/Projects/ leading/a", "D:/Projects/a:stream", "D:/Projects/a\u0000b", "D:/Projects/a\nb",
    "\\\\server\\share\\a", "\\\\?\\D:\\Projects\\a", "\\\\.\\D:\\Projects\\a", "//?/D:/Projects/a",
    "D:/PROJEC~1/a", "D:/Projects/CON", "D:/Projects/NUL.txt", "D:/Projects/COM1/a",
    "D:/Projects/CON .txt", "D:/Projects/LPT9.log", "D:/Projects/COM¹", "D:/Projects/caf\u00e9.txt",
    "D:/Projects/%USERPROFILE%/a", "D:/Projects/*.ts", "D:/Projects/?.ts", "D:/Projects/a|b",
    "D:/Projects/a<b", "D:/Projects/a>b", 'D:/Projects/a"b', `D:/Projects/${"a".repeat(256)}`,
    `D:/Projects/${"a/".repeat(1_024)}b`,
  ];
  for (const path of paths) assert.equal(preview(path).reason, "request-invalid", JSON.stringify(path));
});

test("strict settings reject unknown keys, case-aliased duplicates and invalid bounds", () => {
  const base = policy();
  const invalid = [
    null, {}, { ...base, schemaVersion: "v2" }, { ...base, revision: 0 },
    { ...base, revision: 1.5 }, { ...base, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, command: "cmd.exe" }, { ...base, deniedRoots: undefined },
    { ...base, allowedRoots: [{ path: "D:/", access: "read-write" }] },
    { ...base, allowedRoots: [{ path: "D:/Projects", access: "execute" }] },
    { ...base, allowedRoots: [{ path: "D:/Projects", access: "read-only", approval: true }] },
    { ...base, allowedRoots: [...base.allowedRoots, { path: "d:/projects/", access: "read-only" }] },
    { ...base, deniedRoots: ["C:/", "c:\\"] },
    { ...base, allowedRoots: Array.from({ length: 65 }, (_, i) => ({ path: `D:/w${i}`, access: "read-only" })) },
    { ...base, deniedRoots: Array.from({ length: 65 }, (_, i) => `D:/d${i}`) },
    { ...base, deniedRoots: ["D:/Projects/../other"] },
  ];
  for (const settings of invalid) {
    assert.throws(() => parseWindowsWorkspacePolicy(settings), /^Error: workspace-policy-invalid$/);
    assert.deepEqual(preview("D:/Projects/a", "read", settings), {
      decision: "denied", reason: "policy-invalid", policyRevision: null,
    });
  }
});

test("parse copies and freezes settings without rewriting signed path spellings", () => {
  const input = policy();
  const parsed = parseWindowsWorkspacePolicy(input);
  input.allowedRoots[0]!.path = "C:/Users";
  input.deniedRoots.length = 0;
  assert.equal(parsed.allowedRoots[0]!.path, "D:\\Projects");
  assert.deepEqual(parsed.deniedRoots, ["C:\\", "D:\\Projects\\private"]);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.allowedRoots));
  assert.ok(Object.isFrozen(parsed.allowedRoots[0]));
  assert.throws(() => { (parsed.allowedRoots[0] as { path: string }).path = "C:/"; }, TypeError);
});

test("preview cannot be used to request shell execution or smuggle request fields", () => {
  for (const request of [null, {}, { path: "D:/Projects/a", operation: "execute" },
    { path: "D:/Projects/a", operation: "write", approved: true }]) {
    assert.equal(previewWindowsWorkspaceAccess(policy(), request).reason, "request-invalid");
  }
  const result = preview("D:/Projects/a", "write");
  assert.equal(result.decision, "requires-filesystem-validation");
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(Object.keys(result).sort(), ["decision", "policyRevision", "reason"]);
  assert.ok(!JSON.stringify(result).includes("Projects"));
});
