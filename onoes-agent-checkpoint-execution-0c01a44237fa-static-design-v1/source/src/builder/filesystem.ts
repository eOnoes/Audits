import { lstat, open, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

export interface BuilderFileMetadata {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly linkCount: number;
}

export interface BuilderFileSystem {
  realpath(path: string): Promise<string>;
  metadata(path: string): Promise<BuilderFileMetadata>;
  read(path: string, maxBytes?: number): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}

// Matches the frozen Builder per-file schema ceiling. A caller can only narrow it.
export const BUILDER_MAX_READ_BYTES = 16_777_216;
export class BuilderReadLimitError extends Error {
  constructor() { super("builder-read-limit-exceeded"); this.name = "BuilderReadLimitError"; }
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly nlink: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

function normalizedPath(path: string): string {
  const normalized = resolve(path).replaceAll("/", sep);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameVersion(left: FileIdentity, right: FileIdentity): boolean {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function assertSafeFile(metadata: FileIdentity): void {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n) {
    throw new Error("unsafe-builder-file-target");
  }
}

async function assertCanonicalPath(path: string): Promise<void> {
  if (normalizedPath(await realpath(path)) !== normalizedPath(path)) {
    throw new Error("unsafe-builder-path-alias");
  }
}

export class LocalBuilderFileSystem implements BuilderFileSystem {
  public async realpath(path: string): Promise<string> {
    return realpath(path);
  }

  public async metadata(path: string): Promise<BuilderFileMetadata> {
    const result = await lstat(path);
    return {
      isFile: result.isFile(),
      isDirectory: result.isDirectory(),
      isSymbolicLink: result.isSymbolicLink(),
      linkCount: result.nlink,
    };
  }

  public async read(path: string, maxBytes = BUILDER_MAX_READ_BYTES): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > BUILDER_MAX_READ_BYTES) {
      throw new Error("builder-read-limit-invalid");
    }
    const before = await lstat(path, { bigint: true });
    assertSafeFile(before);
    if (before.size > BigInt(maxBytes)) throw new BuilderReadLimitError();
    await assertCanonicalPath(path);
    const handle = await open(path, "r");
    try {
      const opened = await handle.stat({ bigint: true });
      const afterOpen = await lstat(path, { bigint: true });
      assertSafeFile(opened);
      assertSafeFile(afterOpen);
      await assertCanonicalPath(path);
      if (!sameVersion(before, opened) || !sameVersion(opened, afterOpen)) throw new Error("builder-file-race-detected");
      if (opened.size > BigInt(maxBytes)) throw new BuilderReadLimitError();
      // Allocate from the validated size, never an unbounded readFile. A growing
      // file cannot enlarge the allocation; one extra byte detects a grown tail.
      const bytes = new Uint8Array(Number(opened.size));
      let offset = 0;
      while (offset < bytes.byteLength) {
        const result = await handle.read(bytes, offset, Math.min(65_536, bytes.byteLength - offset), offset);
        if (result.bytesRead === 0) throw new Error("builder-file-race-detected");
        offset += result.bytesRead;
      }
      const tail = await handle.read(new Uint8Array(1), 0, 1, offset);
      if (tail.bytesRead !== 0) {
        if (offset >= maxBytes) throw new BuilderReadLimitError();
        throw new Error("builder-file-race-detected");
      }
      const afterRead = await handle.stat({ bigint: true });
      const finalPath = await lstat(path, { bigint: true });
      assertSafeFile(afterRead);
      assertSafeFile(finalPath);
      await assertCanonicalPath(path);
      if (!sameVersion(opened, afterRead) || !sameVersion(afterRead, finalPath)) throw new Error("builder-file-race-detected");
      return bytes;
    } finally {
      await handle.close();
    }
  }

  public async write(path: string, bytes: Uint8Array): Promise<void> {
    const before = await lstat(path, { bigint: true });
    assertSafeFile(before);
    await assertCanonicalPath(path);
    const handle = await open(path, "r+");
    try {
      const opened = await handle.stat({ bigint: true });
      const afterOpen = await lstat(path, { bigint: true });
      assertSafeFile(opened);
      assertSafeFile(afterOpen);
      await assertCanonicalPath(path);
      if (!sameVersion(before, opened) || !sameVersion(opened, afterOpen)) throw new Error("builder-file-race-detected");
      await handle.truncate(0);
      await handle.writeFile(bytes);
      await handle.sync();
      const afterWrite = await handle.stat({ bigint: true });
      const finalPath = await lstat(path, { bigint: true });
      assertSafeFile(afterWrite);
      assertSafeFile(finalPath);
      await assertCanonicalPath(path);
      if (!sameIdentity(opened, afterWrite) || !sameIdentity(afterWrite, finalPath)) throw new Error("builder-file-race-detected");
    } finally {
      await handle.close();
    }
  }
}
