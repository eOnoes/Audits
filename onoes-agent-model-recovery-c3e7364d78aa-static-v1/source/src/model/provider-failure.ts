import type { ProviderFailureCode, ProviderHttpStatusClass } from "../contracts/index.js";

export interface ProviderFailureDescriptor {
  readonly code: ProviderFailureCode;
  readonly retryable: boolean;
  readonly httpStatusClass: ProviderHttpStatusClass;
  readonly retryCount: number;
}

export class ProviderResponseError extends Error {
  override readonly name = "ProviderResponseError";

  constructor(
    readonly code: ProviderFailureCode,
    readonly retryable: boolean,
    readonly httpStatusClass: ProviderHttpStatusClass,
    readonly retryCount: number = 0,
  ) {
    super(code);
  }
}

export function classifyProviderFailure(
  error: unknown,
  signal?: AbortSignal,
): ProviderFailureDescriptor {
  if (error instanceof ProviderResponseError) {
    return {
      code: error.code,
      retryable: error.retryable,
      httpStatusClass: error.httpStatusClass,
      retryCount: error.retryCount,
    };
  }

  const abortName = abortReasonName(signal) ?? (error instanceof DOMException ? error.name : null);
  if (abortName === "TimeoutError") {
    return { code: "provider-timeout", retryable: true, httpStatusClass: "none", retryCount: 0 };
  }
  if (abortName === "AbortError") {
    return { code: "provider-cancelled", retryable: false, httpStatusClass: "none", retryCount: 0 };
  }
  if (error instanceof TypeError) {
    return { code: "provider-network", retryable: true, httpStatusClass: "none", retryCount: 0 };
  }
  return { code: "provider-unknown", retryable: false, httpStatusClass: "none", retryCount: 0 };
}

export function providerFailureForHttpStatus(status: number): ProviderResponseError {
  if (status === 400) return new ProviderResponseError("provider-bad-request", false, "4xx");
  if (status === 401) return new ProviderResponseError("provider-unauthorized", false, "4xx");
  if (status === 403) return new ProviderResponseError("provider-forbidden", false, "4xx");
  if (status === 404) return new ProviderResponseError("provider-not-found", false, "4xx");
  if (status === 408) return new ProviderResponseError("provider-timeout", true, "4xx");
  if (status === 429) return new ProviderResponseError("provider-rate-limited", true, "4xx");
  if (status >= 500) return new ProviderResponseError("provider-unavailable", true, "5xx");
  return new ProviderResponseError("provider-unavailable", false, status >= 400 ? "4xx" : "none");
}

function abortReasonName(signal: AbortSignal | undefined): string | null {
  if (signal?.aborted !== true) return null;
  return signal.reason instanceof DOMException ? signal.reason.name : "AbortError";
}
