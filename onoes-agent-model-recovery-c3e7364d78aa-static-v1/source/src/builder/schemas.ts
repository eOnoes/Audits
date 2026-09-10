import { isAbsolute, parse as parsePath, resolve } from "node:path";
import { z } from "zod";
import { deepFreeze } from "../validation/deep-freeze.js";
import { sha256BuilderDigest } from "./content-policy.js";
import { BUILDER_CONTRACT_VERSION } from "./types.js";
import type { BuilderInspectionRequest, BuilderPatchPlan, BuilderTaskScope } from "./types.js";

const stableId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const dateTime = z.string().datetime({ offset: true });
const unique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length;
const uniqueBuilderPaths = (values: readonly string[]): boolean => {
  const normalized = process.platform === "win32" ? values.map((value) => value.toLowerCase()) : values;
  return unique(normalized);
};
const forbiddenWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function isSafeBuilderRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 512 || value.includes("\\") || value.startsWith("/") || value.endsWith("/")) return false;
  if (!/^[A-Za-z0-9._/@+(), -]+$/.test(value)) return false;
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment.endsWith(".") || segment.endsWith(" ") || forbiddenWindowsName.test(segment))) return false;
  const lowered = segments.map((segment) => segment.toLowerCase());
  if (lowered.some((segment) => [".git", ".ssh", "secrets", "credentials", "node_modules"].includes(segment))) return false;
  if (lowered.some((segment) => (segment === ".env" || (segment.startsWith(".env.") && segment !== ".env.example")))) return false;
  if (lowered.some((segment) => /\.(pem|key|pfx|p12|kdbx)$/.test(segment) || /^(id_rsa|id_ed25519)$/.test(segment))) return false;
  return true;
}

export function computeBuilderInspectionScopeDigest(scopeInput: unknown): string {
  return sha256BuilderDigest(JSON.stringify(parseBuilderTaskScope(scopeInput)));
}

const relativeFile = z.string().refine(isSafeBuilderRelativePath, "unsafe relative file path");
const absoluteRoot = z.string().min(1).max(2_048).refine((value) => {
  if (!isAbsolute(value) || /[\u0000-\u001f\u007f]/u.test(value) || value.startsWith("\\\\") || value.startsWith("//")) return false;
  if (/(?:^|[\\/])\.\.?([\\/]|$)/.test(value)) return false;
  return resolve(value) !== resolve(parsePath(value).root);
}, "root must be a bounded local absolute path without controls or traversal");

export const builderTaskScopeSchema = z.object({
  contractVersion: z.literal(BUILDER_CONTRACT_VERSION),
  taskId: stableId,
  sessionId: stableId,
  profileId: z.enum(["builder", "kitchen-sink"]),
  repositoryRoot: absoluteRoot,
  worktreeRoot: absoluteRoot,
  worktreeAttestationDigest: digest,
  allowedReadFiles: z.array(relativeFile).nonempty().refine(uniqueBuilderPaths, "read allowlist must be unique"),
  allowedWriteFiles: z.array(relativeFile).refine(uniqueBuilderPaths, "write allowlist must be unique"),
  allowedVerificationIds: z.array(stableId).refine(unique, "verification allowlist must be unique"),
  maxFiles: z.number().int().positive().max(1_000),
  maxFileBytes: z.number().int().positive().max(16_777_216),
  maxTotalBytes: z.number().int().positive().max(67_108_864),
  maxPatchOperations: z.number().int().positive().max(10_000),
  issuedAt: dateTime,
  expiresAt: dateTime,
}).strict().superRefine((scope, context) => {
  if (Date.parse(scope.expiresAt) <= Date.parse(scope.issuedAt)) context.addIssue({ code: "custom", message: "scope must expire after issuance" });
  if (scope.repositoryRoot === scope.worktreeRoot) context.addIssue({ code: "custom", message: "repository and worktree roots must differ" });
  if (scope.allowedReadFiles.length > scope.maxFiles || scope.allowedWriteFiles.length > scope.maxFiles) context.addIssue({ code: "custom", message: "allowlist exceeds file budget" });
  const reads = new Set(scope.allowedReadFiles);
  if (scope.allowedWriteFiles.some((file) => !reads.has(file))) context.addIssue({ code: "custom", message: "write files require read/preimage authority" });
  if (scope.allowedWriteFiles.length > 0 && scope.allowedVerificationIds.length === 0) context.addIssue({ code: "custom", message: "writes require an allowed verification plan" });
});

export const builderInspectionRequestSchema = z.object({
  taskId: stableId,
  requestedFiles: z.array(relativeFile).nonempty().refine(unique, "requested files must be unique"),
}).strict();

export const builderPatchExecutionRequestSchema = z.object({
  plan: z.unknown().refine((value) => value !== undefined, "patch plan required"),
  authorization: z.unknown().refine((value) => value !== undefined, "authorization required"),
}).strict();

export const builderPatchPlanSchema = z.object({
  contractVersion: z.literal(BUILDER_CONTRACT_VERSION),
  planId: stableId,
  taskId: stableId,
  verificationId: stableId,
  patches: z.array(z.object({
    relativePath: relativeFile,
    expectedPreimageDigest: digest,
    operations: z.array(z.object({
      operation: z.literal("replace-exact"),
      before: z.string().min(1).max(65_536),
      after: z.string().max(65_536),
      expectedOccurrences: z.literal(1),
    }).strict()).nonempty(),
  }).strict()).nonempty().refine((patches) => uniqueBuilderPaths(patches.map((patch) => patch.relativePath)), "patched files must be unique"),
}).strict();

export function parseBuilderTaskScope(input: unknown): BuilderTaskScope {
  return deepFreeze(builderTaskScopeSchema.parse(input)) as BuilderTaskScope;
}

export function parseBuilderInspectionRequest(input: unknown): BuilderInspectionRequest {
  return deepFreeze(builderInspectionRequestSchema.parse(input)) as BuilderInspectionRequest;
}

export function parseBuilderPatchPlan(input: unknown): BuilderPatchPlan {
  return deepFreeze(builderPatchPlanSchema.parse(input)) as BuilderPatchPlan;
}

export function parseBuilderPatchExecutionRequest(input: unknown): { readonly plan: unknown; readonly authorization: unknown } {
  return deepFreeze(builderPatchExecutionRequestSchema.parse(input));
}
