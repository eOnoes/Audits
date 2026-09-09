export type ModelCallPurpose = "conversation" | "extraction";

/** Per-turn guard: one conversation call and one extraction call, never retries. */
export class TurnCallBudget {
  private readonly counts: Record<ModelCallPurpose, number> = { conversation: 0, extraction: 0 };
  private total = 0;

  public constructor(private readonly maxTotal = 2) {}

  public consume(purpose: ModelCallPurpose): void {
    if (this.total >= this.maxTotal) throw new Error("Model call budget exhausted");
    if (this.counts[purpose] >= 1) throw new Error(`Model ${purpose} call budget exhausted`);
    this.counts[purpose] += 1;
    this.total += 1;
  }

  public count(purpose: ModelCallPurpose): number {
    return this.counts[purpose];
  }

  public countTotal(): number {
    return this.total;
  }
}
