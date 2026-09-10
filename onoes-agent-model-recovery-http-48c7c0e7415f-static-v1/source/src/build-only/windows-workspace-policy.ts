import { z } from "zod";
import { deepFreeze } from "../validation/deep-freeze.js";

/** Settings/planning preview only. No filesystem I/O, lease, or execution grant.
 * Keep build-only until the real filesystem boundary and consumer are reviewed.
 * Comparison keys never replace paths in existing signed Builder contracts.
 */
export const WINDOWS_WORKSPACE_POLICY_VERSION = "agent-windows-workspace-policy/v1" as const;
const MAX_ROOTS = 64;
const MAX_PATH_CHARS = 2_048;
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[ .]|$)/i;

function comparisonKey(value: string): string | undefined {
  if (value.length > MAX_PATH_CHARS || !/^[A-Za-z]:[\\/]/.test(value)) return undefined;
  // Deliberately conservative, matching the current Builder's ASCII path scope.
  // In particular, no namespaces, ADS, short-name ~ aliases, env expansion or
  // expansion syntax. Paths are never shell arguments here. No traversal is
  // normalized away before admission.
  if (!/^[A-Za-z]:[\\/][A-Za-z0-9._/@+(), \\-]*$/.test(value)) return undefined;
  const slashes = value.replaceAll("\\", "/");
  const body = slashes.slice(3);
  if (body === "") return slashes.toLowerCase();
  const directoryBody = body.endsWith("/") ? body.slice(0, -1) : body;
  const segments = directoryBody.split("/");
  if (segments.some((segment) => segment.length === 0 || segment.length > 255
    || segment === "." || segment === ".." || segment.endsWith(".")
    || segment.startsWith(" ") || segment.endsWith(" ") || RESERVED_NAME.test(segment))) return undefined;
  return `${slashes.slice(0, 3)}${directoryBody}`.toLowerCase();
}

const rootPath = z.string().max(MAX_PATH_CHARS).refine((value) => comparisonKey(value) !== undefined);
const workspacePath = rootPath.refine((value) => (comparisonKey(value)?.length ?? 0) > 3);
const uniquePaths = (paths: readonly string[]): boolean => {
  const keys = paths.map(comparisonKey);
  return new Set(keys).size === keys.length;
};

const policySchema = z.object({
  schemaVersion: z.literal(WINDOWS_WORKSPACE_POLICY_VERSION),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  allowedRoots: z.array(z.object({
    path: workspacePath,
    access: z.enum(["read-only", "read-write"]),
  }).strict()).max(MAX_ROOTS).refine((roots) => uniquePaths(roots.map((root) => root.path))),
  deniedRoots: z.array(rootPath).max(MAX_ROOTS).refine(uniquePaths),
}).strict();

export type WindowsWorkspacePolicy = Readonly<{
  schemaVersion: typeof WINDOWS_WORKSPACE_POLICY_VERSION;
  revision: number;
  allowedRoots: readonly Readonly<{ path: string; access: "read-only" | "read-write" }>[];
  deniedRoots: readonly string[];
}>;

export const DEFAULT_WINDOWS_WORKSPACE_POLICY: WindowsWorkspacePolicy = deepFreeze({
  schemaVersion: WINDOWS_WORKSPACE_POLICY_VERSION,
  revision: 1,
  allowedRoots: [],
  deniedRoots: ["C:\\"],
});

/** Parse settings from bounded JSON. Error text never echoes a submitted path. */
export function parseWindowsWorkspacePolicy(input: unknown): WindowsWorkspacePolicy {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw new Error("workspace-policy-invalid");
  return deepFreeze(parsed.data);
}

export type WindowsWorkspacePreview = Readonly<{
  decision: "denied" | "requires-filesystem-validation";
  reason: "policy-invalid" | "request-invalid" | "explicit-deny" | "outside-allowed-roots"
    | "read-only-root" | "lexical-scope-match";
  policyRevision: number | null;
}>;

const requestSchema = z.object({
  path: workspacePath,
  operation: z.enum(["read", "write"]),
}).strict();

function contains(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/** A lexical match is NOT filesystem authorization. Aliases, races, reparse
 * points, policy freshness, exact file scope and leases must still be checked
 * by the future consumer. This API cannot authorize commands or child I/O.
 */
export function previewWindowsWorkspaceAccess(policyInput: unknown, requestInput: unknown): WindowsWorkspacePreview {
  let policy: WindowsWorkspacePolicy;
  try {
    policy = parseWindowsWorkspacePolicy(policyInput);
  } catch {
    return Object.freeze({ decision: "denied", reason: "policy-invalid", policyRevision: null });
  }
  const result = (reason: WindowsWorkspacePreview["reason"]): WindowsWorkspacePreview => Object.freeze({
    decision: reason === "lexical-scope-match" ? "requires-filesystem-validation" : "denied",
    reason,
    policyRevision: policy.revision,
  });
  const request = requestSchema.safeParse(requestInput);
  if (!request.success) return result("request-invalid");
  const target = comparisonKey(request.data.path)!;
  if (policy.deniedRoots.some((root) => contains(comparisonKey(root)!, target))) return result("explicit-deny");

  // The most specific allowed root controls access. A nested read-only root
  // narrows a broader read-write root; it is not defeated by array ordering.
  const roots = policy.allowedRoots.map((root) => ({ ...root, key: comparisonKey(root.path)! }))
    .filter((root) => contains(root.key, target))
    .sort((left, right) => right.key.length - left.key.length);
  const root = roots[0];
  if (root === undefined) return result("outside-allowed-roots");
  if (request.data.operation === "write" && root.access === "read-only") return result("read-only-root");
  return result("lexical-scope-match");
}
