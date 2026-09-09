export const MAX_CORE_KERNEL_PROMPT_TOKENS = 500 as const;

export class KernelPromptBudgetError extends Error {
  public constructor(
    public readonly measuredTokens: number,
    public readonly maximumTokens: number = MAX_CORE_KERNEL_PROMPT_TOKENS,
  ) {
    super("core-kernel-prompt-budget-exceeded");
    this.name = "KernelPromptBudgetError";
  }
}

export interface KernelPromptMeasurement {
  readonly promptVersion: string;
  readonly measuredTokens: number;
  readonly maximumTokens: typeof MAX_CORE_KERNEL_PROMPT_TOKENS;
}

export function enforceCoreKernelPromptBudget(promptVersion: string, measuredTokens: number): KernelPromptMeasurement {
  if (!Number.isInteger(measuredTokens) || measuredTokens < 0) {
    throw new TypeError("measured kernel prompt tokens must be a non-negative integer");
  }
  if (measuredTokens > MAX_CORE_KERNEL_PROMPT_TOKENS) {
    throw new KernelPromptBudgetError(measuredTokens);
  }
  return Object.freeze({ promptVersion, measuredTokens, maximumTokens: MAX_CORE_KERNEL_PROMPT_TOKENS });
}
