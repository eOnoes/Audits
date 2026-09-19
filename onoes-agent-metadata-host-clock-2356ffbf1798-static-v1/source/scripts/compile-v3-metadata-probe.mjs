// Compile-only. Never launches/loads any output, contacts a VM, or installs.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const compilerDirectory = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319';
export const compiler = `${compilerDirectory}/csc.exe`;
// Same fixed ASCII profile as the pure C# runtime configuration; cross-checked
// in the source/vector suite. Emitted only beside the four compile-only subjects.
export const metadataRuntimeConfiguration = '<configuration>\n  <startup>\n    <supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" />\n  </startup>\n</configuration>\n';
export const metadataRuntimeImages = Object.freeze(['OnoesMetadataCoordinator01.exe','OnoesMetadataAnchor01.exe','OnoesMetadataSupervisor01.exe','inert-child.exe']);
const hostSinkPolicySources=['host-sink-policy','host-root-policy','binding','peer-pin','roles','fixture-policy'].map(s=>`tests/probes/windows-v3-metadata-${s}.cs`);
const hostClockSources=['host-clock','host-clock-policy'].map(s=>`tests/probes/windows-v3-metadata-${s}.cs`);
const hostClockTransferSources=['host-clock-context','host-clock-transfer'].map(s=>`tests/probes/windows-v3-metadata-${s}.cs`);
const hostSinkReportSources=['host-history','bootstrap-report','provision-policy','service-setup-policy','service-start-policy','image-policy',
  'case-report','service-job-policy','service-policy','service-control-policy','role-policy','configuration'].map(s=>`tests/probes/windows-v3-metadata-${s}.cs`);
const nativeSubject = Object.freeze({ source: 'tests/probes/windows-v3-metadata-suspended.cs', output: 'suspended.dll', target: 'library',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-peer.cs', 'tests/probes/windows-v3-metadata-peer-policy.cs',
      'tests/probes/windows-v3-metadata-handshake.cs', 'tests/probes/windows-v3-metadata-roles.cs',
      'tests/probes/windows-v3-metadata-pipe-io.cs', 'tests/probes/windows-v3-metadata-io-policy.cs',
      'tests/probes/windows-v3-metadata-channel.cs', 'tests/probes/windows-v3-metadata-channel-budget.cs',
      'tests/probes/windows-v3-metadata-peer-pin.cs', 'tests/probes/windows-v3-metadata-binding.cs',
      'tests/probes/windows-v3-metadata-channel-offer.cs', 'tests/probes/windows-v3-metadata-supervisor.cs',
      'tests/probes/windows-v3-metadata-custody-policy.cs', 'tests/probes/windows-v3-metadata-resume-policy.cs',
      'tests/probes/windows-v3-metadata-fixture.cs', 'tests/probes/windows-v3-metadata-fixture-policy.cs',
      'tests/probes/windows-v3-metadata-role-policy.cs', 'tests/probes/windows-v3-metadata-role-run.cs',
      'tests/probes/windows-v3-metadata-service-policy.cs', 'tests/probes/windows-v3-metadata-service.cs',
      'tests/probes/windows-v3-metadata-configuration.cs', 'tests/probes/windows-v3-metadata-configuration-hold.cs',
      'tests/probes/windows-v3-metadata-readiness.cs', 'tests/probes/windows-v3-metadata-readiness-policy.cs',
      'tests/probes/windows-v3-metadata-work-grant.cs', 'tests/probes/windows-v3-metadata-work-grant-policy.cs']),
    additionalReferences: Object.freeze(['System.ServiceProcess.dll']) });
export const subjects = Object.freeze([
  nativeSubject,
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-bundle-receiver-tests.cs', output: 'bundle-receiver-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-bundle-receiver.cs','tests/probes/windows-v3-metadata-bundle.cs',
      'tests/probes/windows-v3-metadata-provision-policy.cs','tests/probes/windows-v3-metadata-image-policy.cs',
      'tests/probes/windows-v3-metadata-fixture-policy.cs','tests/probes/windows-v3-metadata-peer-pin.cs','tests/probes/windows-v3-metadata-roles.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-bundle-tests.cs', output: 'bundle-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-bundle.cs','tests/probes/windows-v3-metadata-provision-policy.cs',
      'tests/probes/windows-v3-metadata-image-policy.cs','tests/probes/windows-v3-metadata-fixture-policy.cs',
      'tests/probes/windows-v3-metadata-peer-pin.cs','tests/probes/windows-v3-metadata-roles.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-provision-tests.cs', output: 'provision-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-provision-policy.cs','tests/probes/windows-v3-metadata-image-policy.cs',
      'tests/probes/windows-v3-metadata-fixture-policy.cs','tests/probes/windows-v3-metadata-peer-pin.cs','tests/probes/windows-v3-metadata-roles.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-inert-child.cs', output: 'inert-child.exe', target: 'exe' }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-host-sink.cs', output: 'host-report-sink.dll', target: 'library',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-host-sink-read.cs','tests/probes/windows-v3-metadata-host-root.cs','tests/probes/windows-v3-metadata-watchdog-retention.cs','tests/probes/windows-v3-metadata-retained-watchdog.cs','tests/probes/windows-v3-metadata-controller-retention.cs',
      'tests/probes/windows-v3-metadata-controller-clock-records.cs','tests/probes/windows-v3-metadata-controller-clock-storage.cs',
      'tests/probes/windows-v3-metadata-watchdog-clock-records.cs','tests/probes/windows-v3-metadata-watchdog-clock-history-read.cs',
      'tests/probes/windows-v3-metadata-watchdog-retention-policy.cs','tests/probes/windows-v3-metadata-host-code-policy.cs',
      'tests/probes/windows-v3-metadata-host-code-hold.cs','tests/probes/windows-v3-metadata-host-code-set.cs',...hostClockSources,...hostClockTransferSources,...hostSinkPolicySources,...hostSinkReportSources]) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-watchdog-retention-tests.cs', output: 'watchdog-retention-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-watchdog-retention-policy.cs',...hostSinkPolicySources]) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-host-sink-tests.cs', output: 'host-sink-tests.exe', target: 'exe',
    additionalSources: Object.freeze([...hostSinkPolicySources,...hostSinkReportSources]) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-image-tests.cs', output: 'image-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-image-policy.cs', 'tests/probes/windows-v3-metadata-fixture-policy.cs',
      'tests/probes/windows-v3-metadata-peer-pin.cs', 'tests/probes/windows-v3-metadata-roles.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-root-inventory-tests.cs', output: 'root-inventory-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-root-inventory-policy.cs','tests/probes/windows-v3-metadata-image-policy.cs',
      'tests/probes/windows-v3-metadata-fixture-policy.cs','tests/probes/windows-v3-metadata-peer-pin.cs','tests/probes/windows-v3-metadata-roles.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-service-start-tests.cs', output: 'service-start-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-service-start-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-peer-policy-tests.cs', output: 'peer-policy-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-peer-policy.cs', 'tests/probes/windows-v3-metadata-roles.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-handshake-tests.cs', output: 'handshake-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-roles.cs', 'tests/probes/windows-v3-metadata-handshake.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-io-policy-tests.cs', output: 'io-policy-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-io-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-channel-budget-tests.cs', output: 'channel-budget-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-channel-budget.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-binding-tests.cs', output: 'binding-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-binding.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs', 'tests/probes/windows-v3-metadata-roles.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-custody-policy-tests.cs', output: 'custody-policy-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-custody-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-resume-policy-tests.cs', output: 'resume-policy-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-resume-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-fixture-policy-tests.cs', output: 'fixture-policy-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-fixture-policy.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs', 'tests/probes/windows-v3-metadata-roles.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-role-policy-tests.cs', output: 'role-policy-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-role-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-service-policy-tests.cs', output: 'service-policy-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-service-policy.cs', 'tests/probes/windows-v3-metadata-role-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-configuration-tests.cs', output: 'configuration-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-configuration.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs',
      'tests/probes/windows-v3-metadata-roles.cs', 'tests/probes/windows-v3-metadata-binding.cs', 'tests/probes/windows-v3-metadata-fixture-policy.cs',
      'tests/probes/windows-v3-metadata-configuration-descriptor.cs']) }),
  ...['Coordinator', 'Anchor', 'Supervisor'].map(role => Object.freeze({
    source: 'tests/probes/windows-v3-metadata-service-entry.cs', output: `OnoesMetadata${role}01.exe`, target: 'exe',
    additionalSources: Object.freeze([nativeSubject.source, ...nativeSubject.additionalSources]),
    additionalReferences: nativeSubject.additionalReferences, define: `METADATA_${role.toUpperCase()}`,
  })),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-service-observation.cs', output: 'service-observation.dll', target: 'library',
    additionalSources: Object.freeze([nativeSubject.source, ...nativeSubject.additionalSources, 'tests/probes/windows-v3-metadata-service-observation-policy.cs',
      'tests/probes/windows-v3-metadata-configuration-descriptor.cs', 'tests/probes/windows-v3-metadata-configuration-create.cs',
      'tests/probes/windows-v3-metadata-configuration-handoff.cs', 'tests/probes/windows-v3-metadata-readiness-create.cs',
      'tests/probes/windows-v3-metadata-service-job.cs', 'tests/probes/windows-v3-metadata-service-job-root.cs',
      'tests/probes/windows-v3-metadata-service-job-policy.cs', 'tests/probes/windows-v3-metadata-service-control.cs',
      'tests/probes/windows-v3-metadata-service-control-policy.cs', 'tests/probes/windows-v3-metadata-case-report.cs',
      'tests/probes/windows-v3-metadata-case-run.cs', 'tests/probes/windows-v3-metadata-bootstrap-report.cs',
      'tests/probes/windows-v3-metadata-bootstrap-run.cs', 'tests/probes/windows-v3-metadata-service-setup.cs',
      'tests/probes/windows-v3-metadata-root-inventory-policy.cs',
      'tests/probes/windows-v3-metadata-bundle.cs',
      'tests/probes/windows-v3-metadata-bundle-receiver.cs',
      'tests/probes/windows-v3-metadata-provision.cs', 'tests/probes/windows-v3-metadata-provision-policy.cs',
      'tests/probes/windows-v3-metadata-service-setup-policy.cs', 'tests/probes/windows-v3-metadata-work-grant-create.cs',
      'tests/probes/windows-v3-metadata-image-policy.cs', 'tests/probes/windows-v3-metadata-image-hold.cs',
      'tests/probes/windows-v3-metadata-service-start.cs', 'tests/probes/windows-v3-metadata-service-start-policy.cs']),
    additionalReferences: nativeSubject.additionalReferences }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-service-observation-tests.cs', output: 'service-observation-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-service-observation-policy.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs',
      'tests/probes/windows-v3-metadata-roles.cs', 'tests/probes/windows-v3-metadata-fixture-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-service-job-tests.cs', output: 'service-job-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-service-job-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-service-control-tests.cs', output: 'service-control-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-service-control-policy.cs', 'tests/probes/windows-v3-metadata-configuration.cs',
      'tests/probes/windows-v3-metadata-binding.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs', 'tests/probes/windows-v3-metadata-roles.cs',
      'tests/probes/windows-v3-metadata-fixture-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-bootstrap-report-tests.cs', output: 'bootstrap-report-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-bootstrap-report.cs', 'tests/probes/windows-v3-metadata-provision-policy.cs',
      'tests/probes/windows-v3-metadata-service-setup-policy.cs', 'tests/probes/windows-v3-metadata-service-start-policy.cs',
      'tests/probes/windows-v3-metadata-image-policy.cs', 'tests/probes/windows-v3-metadata-case-report.cs',
      'tests/probes/windows-v3-metadata-service-job-policy.cs', 'tests/probes/windows-v3-metadata-service-policy.cs',
      'tests/probes/windows-v3-metadata-service-control-policy.cs', 'tests/probes/windows-v3-metadata-role-policy.cs',
      'tests/probes/windows-v3-metadata-configuration.cs', 'tests/probes/windows-v3-metadata-binding.cs',
      'tests/probes/windows-v3-metadata-peer-pin.cs', 'tests/probes/windows-v3-metadata-roles.cs', 'tests/probes/windows-v3-metadata-fixture-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-case-report-tests.cs', output: 'case-report-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-case-report.cs', 'tests/probes/windows-v3-metadata-service-job-policy.cs',
      'tests/probes/windows-v3-metadata-service-policy.cs', 'tests/probes/windows-v3-metadata-service-control-policy.cs',
      'tests/probes/windows-v3-metadata-role-policy.cs', 'tests/probes/windows-v3-metadata-configuration.cs',
      'tests/probes/windows-v3-metadata-binding.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs', 'tests/probes/windows-v3-metadata-roles.cs',
      'tests/probes/windows-v3-metadata-fixture-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-readiness-tests.cs', output: 'readiness-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-readiness-policy.cs', 'tests/probes/windows-v3-metadata-service-policy.cs',
      'tests/probes/windows-v3-metadata-role-policy.cs', 'tests/probes/windows-v3-metadata-roles.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs',
      'tests/probes/windows-v3-metadata-fixture-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-service-setup-tests.cs', output: 'service-setup-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-service-setup-policy.cs', 'tests/probes/windows-v3-metadata-service-observation-policy.cs',
      'tests/probes/windows-v3-metadata-service-control-policy.cs', 'tests/probes/windows-v3-metadata-configuration.cs',
      'tests/probes/windows-v3-metadata-binding.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs', 'tests/probes/windows-v3-metadata-roles.cs',
      'tests/probes/windows-v3-metadata-fixture-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-work-grant-tests.cs', output: 'work-grant-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-work-grant-policy.cs', 'tests/probes/windows-v3-metadata-peer-pin.cs',
      'tests/probes/windows-v3-metadata-roles.cs', 'tests/probes/windows-v3-metadata-fixture-policy.cs',
      'tests/probes/windows-v3-metadata-service-policy.cs', 'tests/probes/windows-v3-metadata-role-policy.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-retained-watchdog-tests.cs', output: 'retained-watchdog-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-retained-watchdog.cs','tests/probes/windows-v3-metadata-retained-watchdog-model.cs',
      'tests/probes/windows-v3-metadata-watchdog-retention-policy.cs','tests/probes/windows-v3-metadata-binding.cs','tests/probes/windows-v3-metadata-peer-pin.cs',
      'tests/probes/windows-v3-metadata-roles.cs','tests/probes/windows-v3-metadata-fixture-policy.cs',...hostClockSources,...hostClockTransferSources,
      'tests/probes/windows-v3-metadata-watchdog-clock-records.cs','tests/probes/windows-v3-metadata-watchdog-clock-records-tests.cs']) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-controller-retention-tests.cs', output: 'controller-retention-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-controller-retention.cs','tests/probes/windows-v3-metadata-controller-retention-model.cs',
      'tests/probes/windows-v3-metadata-controller-clock-records.cs','tests/probes/windows-v3-metadata-controller-clock-records-tests.cs','tests/probes/windows-v3-metadata-watchdog-retention-policy.cs',
      'tests/probes/windows-v3-metadata-watchdog-clock-records.cs',
      ...hostClockSources,...hostClockTransferSources,...hostSinkPolicySources,...hostSinkReportSources]) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-host-code-tests.cs', output: 'host-code-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-host-code-policy.cs',...hostClockSources]) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-host-code-set-tests.cs', output: 'host-code-set-tests.exe', target: 'exe',
    additionalSources: Object.freeze(['tests/probes/windows-v3-metadata-host-code-set.cs',
      'tests/probes/windows-v3-metadata-host-code-set-model.cs','tests/probes/windows-v3-metadata-host-code-policy.cs',...hostClockSources]) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-host-clock-tests.cs', output: 'host-clock-tests.exe', target: 'exe',
    additionalSources: Object.freeze([...hostClockSources]) }),
  Object.freeze({ source: 'tests/probes/windows-v3-metadata-host-clock-context-tests.cs', output: 'host-clock-context-tests.exe', target: 'exe',
    additionalSources: Object.freeze([...hostClockSources,...hostClockTransferSources,'tests/probes/windows-v3-metadata-binding.cs',
      'tests/probes/windows-v3-metadata-peer-pin.cs','tests/probes/windows-v3-metadata-roles.cs']) }),
]);
export function compileArgs(productRoot, outputRoot, subject) {
  if (!subjects.includes(subject)) throw new Error('unknown-compile-subject');
  return ['/nologo', '/noconfig', '/nostdlib+', '/warn:4', '/warnaserror+', '/optimize+', '/platform:x64',
    `/reference:${compilerDirectory}/mscorlib.dll`, `/reference:${compilerDirectory}/System.dll`, `/reference:${compilerDirectory}/System.Core.dll`,
    ...(subject.additionalReferences ?? []).map(reference => `/reference:${compilerDirectory}/${reference}`),
    ...(subject.define ? [`/define:${subject.define}`] : []),
    `/target:${subject.target}`, `/out:${join(outputRoot, subject.output)}`, join(productRoot, subject.source),
    ...(subject.additionalSources ?? []).map(source => join(productRoot, source))];
}
function identity(path) {
  const bytes = readFileSync(path);
  return { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export function compileOnly() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('windows-x64-compile-only');
  const product = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sourcePaths = [...new Set(subjects.flatMap(s => [s.source, ...(s.additionalSources ?? [])]))];
  const inputs = sourcePaths.map(source => ({ path: source, ...identity(join(product, source)) }));
  const compilerIdentity = identity(compiler);
  const references = [...new Set(['mscorlib.dll', 'System.dll', 'System.Core.dll', ...subjects.flatMap(s => s.additionalReferences ?? [])])]
    .map(path => ({ path, ...identity(`${compilerDirectory}/${path}`) }));
  const scriptIdentity = identity(fileURLToPath(import.meta.url));
  const artifacts = join(product, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  const output = mkdtempSync(join(artifacts, 'v3-metadata-compile-'));
  const receipt = { kind: 'producer-compile-only-not-native-execution', at: new Date().toISOString(),
    node: process.version, compiler: compilerIdentity, references, script: scriptIdentity, inputs,
    outputExecuted: false, physicalCases: 'NOT_RUN', sourceUnchanged: false,
    toolchainUnchanged: false, results: [], runtimeConfigurations: [] };
  let failure;
  try {
    for (const subject of subjects) {
      const args = compileArgs(product, output, subject);
      const result = spawnSync(compiler, args, { cwd: product, shell: false, windowsHide: true,
        timeout: 60_000, maxBuffer: 65_536, encoding: 'utf8',
        env: { SystemRoot: 'C:\\Windows', TEMP: process.env.TEMP, TMP: process.env.TMP } });
      // Compiler output stays local; neither raw diagnostics nor paths are audit claims.
      writeFileSync(join(output, `${subject.output}.compile.txt`), (result.stdout ?? '') + (result.stderr ?? ''), { flag: 'wx' });
      const ok = result.status === 0 && !result.error && !result.signal;
      receipt.results.push({ source: subject.source, target: subject.target, status: result.status,
        signal: result.signal, succeeded: ok, ...(ok ? { output: { path: subject.output, ...identity(join(output, subject.output)) } } : {}) });
      if (!ok) throw new Error('compile-failed-no-execution-or-retry');
    }
    for (const image of metadataRuntimeImages) {
      if (!receipt.results.some(r => r.succeeded && r.output.path === image)) throw new Error('runtime-profile-image-missing');
      const path = `${image}.config`;
      writeFileSync(join(output, path), metadataRuntimeConfiguration, { flag: 'wx', encoding: 'ascii' });
      receipt.runtimeConfigurations.push({ path, ...identity(join(output, path)) });
    }
    receipt.sourceUnchanged = inputs.every(({ path, ...before }) => JSON.stringify(before) === JSON.stringify(identity(join(product, path))));
    receipt.toolchainUnchanged = JSON.stringify(compilerIdentity) === JSON.stringify(identity(compiler)) &&
      JSON.stringify(scriptIdentity) === JSON.stringify(identity(fileURLToPath(import.meta.url))) &&
      references.every(({ path, ...before }) => JSON.stringify(before) === JSON.stringify(identity(`${compilerDirectory}/${path}`)));
    if (!receipt.sourceUnchanged || !receipt.toolchainUnchanged) throw new Error('input-changed-during-compile');
  } catch (error) { failure = error; }
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, ...receipt }));
  if (failure) throw failure;
  return { output, ...receipt };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) compileOnly();
