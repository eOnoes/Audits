import { deepFreeze } from "../validation/deep-freeze.js";

export interface BuilderWorktreeAttestation {
  readonly valid: boolean;
  readonly attestationDigest: string;
}

export interface BuilderWorktreeAttestor {
  attest(repositoryRoot: string, worktreeRoot: string): Promise<BuilderWorktreeAttestation>;
}

export class DenyingBuilderWorktreeAttestor implements BuilderWorktreeAttestor {
  public async attest(): Promise<BuilderWorktreeAttestation> {
    return deepFreeze({ valid: false, attestationDigest: `sha256:${"0".repeat(64)}` });
  }
}
