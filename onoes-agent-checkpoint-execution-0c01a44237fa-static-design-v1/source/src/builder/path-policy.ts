import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BuilderFileSystem } from "./filesystem.js";
import { isSafeBuilderRelativePath } from "./schemas.js";
import type { BuilderInspectionReason, BuilderPatchReason } from "./types.js";

export type BuilderBoundaryReason = Extract<BuilderInspectionReason | BuilderPatchReason,
  "worktree-not-isolated" | "path-not-allowed" | "path-unsafe" | "symlink-rejected" | "hardlink-rejected" | "file-missing" | "read-failed">;

export class BuilderBoundaryError extends Error {
  public constructor(public readonly reasonCode: BuilderBoundaryReason) {
    super(reasonCode);
    this.name = "BuilderBoundaryError";
  }
}

function normalizedForComparison(path: string): string {
  const resolved = resolve(path).replaceAll("/", sep);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function containsPath(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return difference === "" || (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference));
}

async function canonicalDirectory(path: string, filesystem: BuilderFileSystem): Promise<string> {
  try {
    const metadata = await filesystem.metadata(path);
    if (metadata.isSymbolicLink) throw new BuilderBoundaryError("symlink-rejected");
    if (!metadata.isDirectory) throw new BuilderBoundaryError("file-missing");
    return await filesystem.realpath(path);
  } catch (error) {
    if (error instanceof BuilderBoundaryError) throw error;
    throw new BuilderBoundaryError("file-missing");
  }
}

export async function verifyIsolatedBuilderRoots(repositoryRoot: string, worktreeRoot: string, filesystem: BuilderFileSystem): Promise<{ repositoryRoot: string; worktreeRoot: string }> {
  const repository = await canonicalDirectory(repositoryRoot, filesystem);
  const worktree = await canonicalDirectory(worktreeRoot, filesystem);
  if (containsPath(repository, worktree) || containsPath(worktree, repository)) throw new BuilderBoundaryError("worktree-not-isolated");
  return { repositoryRoot: repository, worktreeRoot: worktree };
}

export interface BuilderFileResolutionOptions {
  readonly requireSingleLink?: boolean;
}

export async function resolveExactBuilderFile(
  root: string,
  relativePath: string,
  allowlist: readonly string[],
  filesystem: BuilderFileSystem,
  options: BuilderFileResolutionOptions = {},
): Promise<string> {
  if (!isSafeBuilderRelativePath(relativePath)) throw new BuilderBoundaryError("path-unsafe");
  if (!allowlist.includes(relativePath)) throw new BuilderBoundaryError("path-not-allowed");
  const rootCanonical = await canonicalDirectory(root, filesystem);
  let cursor = rootCanonical;
  const segments = relativePath.split("/");
  let finalLinkCount = 0;
  for (const [index, segment] of segments.entries()) {
    cursor = join(cursor, segment);
    let metadata;
    try {
      metadata = await filesystem.metadata(cursor);
    } catch {
      throw new BuilderBoundaryError("file-missing");
    }
    if (metadata.isSymbolicLink) throw new BuilderBoundaryError("symlink-rejected");
    if (index < segments.length - 1 && !metadata.isDirectory) throw new BuilderBoundaryError("file-missing");
    if (index === segments.length - 1 && !metadata.isFile) throw new BuilderBoundaryError("file-missing");
    if (index === segments.length - 1) finalLinkCount = metadata.linkCount;
  }
  if (options.requireSingleLink === true && finalLinkCount !== 1) throw new BuilderBoundaryError("hardlink-rejected");
  let canonical: string;
  try {
    canonical = await filesystem.realpath(cursor);
  } catch {
    throw new BuilderBoundaryError("file-missing");
  }
  if (!containsPath(rootCanonical, canonical) || normalizedForComparison(canonical) !== normalizedForComparison(cursor)) {
    throw new BuilderBoundaryError("symlink-rejected");
  }
  return canonical;
}
