import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const product = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("native artifact hold preserves pinned bytes and releases handles in disposable Windows controls", {
  skip: process.platform !== "win32", timeout: 20_000,
}, () => {
  const script = join(product, "tests/probes/windows-artifact-read-hold.ps1");
  const native = join(product, "src/build-only/native/windows-artifact-read-hold.cs");
  const scriptHash = sha(readFileSync(script)), nativeHash = sha(readFileSync(native));
  const powershell = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  const child = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-File", script, "-DisposableOnly"], {
    cwd: product, windowsHide: true, timeout: 15_000, maxBuffer: 65_536, encoding: "utf8",
    // Node may inherit PowerShell 7's module path; Windows PowerShell 5.1 must
    // resolve only its own installed system modules, never user module folders.
    env: { ...process.env, PSModulePath: join(dirname(powershell), "Modules") },
  });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, "");
  const output = JSON.parse(child.stdout);
  const reportPath = resolve(output.reportPath);
  assert.ok(reportPath.startsWith(join(product, "artifacts", "artifact-read-hold-")));
  assert.equal(reportPath.slice(reportPath.lastIndexOf(sep) + 1), "report.json");
  assert.equal(realpathSync(reportPath), reportPath); assert.equal(lstatSync(reportPath).isSymbolicLink(), false);
  const report = JSON.parse(readFileSync(reportPath, "utf8").replace(/^\uFEFF/u, ""));
  assert.deepEqual(output.evidence, report);
  assert.equal(report.schemaVersion, "onoes-artifact-read-hold-probe/v1");
  assert.equal(report.evidenceClass, "LOCAL_DISPOSABLE_PRIMITIVE_EXECUTION_NOT_PRODUCTION_CUSTODY");
  assert.equal(report.harnessSha256, scriptHash); assert.equal(report.nativeSourceSha256, nativeHash);
  assert.equal(sha(readFileSync(script)), scriptHash); assert.equal(sha(readFileSync(native)), nativeHash);
  assert.equal(report.implementationAssertions, 32);
  for (const field of ["compatibleRead", "writeDenied", "appendDenied", "deleteDenied", "renameDenied",
    "writableAfterRelease", "existingWriterDeniesHold", "holdAfterWriterRelease", "writableViewPositiveControl",
    "anchoredParentRenameDenied", "parentRenameAfterRelease", "testedByteMutationRoutesDenied", "noProductionConclusion"])
    assert.equal(report[field], true, field);
  for (const field of ["ordinaryBytesChanged", "holdWithWritableView", "mappedWriteSucceeded", "mappedBytesChangedDuringHold",
    "anchoredPathSubstituted", "hostSecurityConfigurationChanged", "artifactExecutableLaunched"])
    assert.equal(report[field], false, field);
});
