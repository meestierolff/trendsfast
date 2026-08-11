import type {
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderRunError,
  ProviderRunRequest,
  ProviderRunResult,
  ProviderSlug,
} from "./types";
import { redactProviderError } from "./util";

export class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      code: string;
      retryable: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderError";
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

export class ProviderBudget {
  readonly limitUsd: number;
  #usedUsd = 0;

  constructor(limitUsd: number) {
    this.limitUsd = Math.max(0, limitUsd);
  }

  get usedUsd(): number {
    return this.#usedUsd;
  }

  get remainingUsd(): number {
    return Math.max(0, this.limitUsd - this.#usedUsd);
  }

  reserve(estimatedUsd: number): boolean {
    const estimate = Math.max(0, estimatedUsd);
    if (this.#usedUsd + estimate > this.limitUsd + Number.EPSILON) return false;
    this.#usedUsd += estimate;
    return true;
  }

  reconcile(estimatedUsd: number, actualUsd: number | undefined): boolean {
    if (actualUsd === undefined || !Number.isFinite(actualUsd))
      return this.#usedUsd <= this.limitUsd;
    this.#usedUsd = Math.max(0, this.#usedUsd - Math.max(0, estimatedUsd) + Math.max(0, actualUsd));
    return this.#usedUsd <= this.limitUsd + Number.EPSILON;
  }
}

type CircuitState = { failures: number; openedAt?: number };

export class ProviderCircuitBreaker {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly #states = new Map<ProviderSlug, CircuitState>();

  constructor(options: { failureThreshold?: number; cooldownMs?: number } = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(1, options.cooldownMs ?? 60_000);
  }

  isOpen(provider: ProviderSlug, now: Date): boolean {
    const state = this.#states.get(provider);
    if (!state?.openedAt) return false;
    if (now.getTime() - state.openedAt >= this.cooldownMs) {
      this.#states.set(provider, { failures: 0 });
      return false;
    }
    return true;
  }

  recordSuccess(provider: ProviderSlug): void {
    this.#states.set(provider, { failures: 0 });
  }

  recordFailure(provider: ProviderSlug, now: Date): void {
    const current = this.#states.get(provider) ?? { failures: 0 };
    const failures = current.failures + 1;
    this.#states.set(provider, {
      failures,
      ...(failures >= this.failureThreshold ? { openedAt: now.getTime() } : {}),
    });
  }
}

type ExecuteProviderOptions = {
  context: ProviderExecutionContext;
  budget: ProviderBudget;
  circuitBreaker: ProviderCircuitBreaker;
  deadline?: Date;
};

function errorRecord(error: unknown): ProviderRunError {
  return {
    code: error instanceof ProviderError ? error.code : "PROVIDER_UNEXPECTED_ERROR",
    message: redactProviderError(error),
    retryable: error instanceof ProviderError ? error.retryable : false,
  };
}

function terminalResult(
  adapter: ProviderAdapter,
  context: ProviderExecutionContext,
  status: ProviderRunResult["status"],
  estimate: ReturnType<ProviderAdapter["estimate"]>,
  error: ProviderRunError,
): ProviderRunResult {
  const timestamp = context.now().toISOString();
  return {
    provider: adapter.metadata.slug,
    status,
    signals: [],
    measurements: [],
    calls: 0,
    attempts: 0,
    quota: { used: 0 },
    cost: { estimatedUsd: estimate.estimatedUsd, actualUsd: 0 },
    startedAt: timestamp,
    finishedAt: timestamp,
    limitations: [error.message],
    errors: [error],
  };
}

async function collectWithDeadline(
  adapter: ProviderAdapter,
  request: ProviderRunRequest,
  context: ProviderExecutionContext,
  attemptDeadline: Date,
  scanDeadlineIsBinding: boolean,
): Promise<ProviderRunResult> {
  const controller = new AbortController();
  const inheritedSignal = context.abortSignal;
  const abortFromParent = (): void => controller.abort();
  if (inheritedSignal?.aborted) controller.abort();
  else inheritedSignal?.addEventListener("abort", abortFromParent, { once: true });

  const remainingMs = attemptDeadline.getTime() - context.now().getTime();
  if (remainingMs <= 0 || controller.signal.aborted) {
    inheritedSignal?.removeEventListener("abort", abortFromParent);
    throw new ProviderError("Provider execution deadline was exhausted", {
      code: "PROVIDER_DEADLINE_EXCEEDED",
      retryable: false,
    });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        // Abort first so the transport is torn down before the executor moves on
        // to a retry or returns control to the scan state machine.
        controller.abort();
        reject(
          scanDeadlineIsBinding
            ? new ProviderError("Provider scan deadline was exhausted", {
                code: "PROVIDER_DEADLINE_EXCEEDED",
                retryable: false,
              })
            : new ProviderError("Provider timed out", {
                code: "PROVIDER_TIMEOUT",
                retryable: true,
              }),
        );
      },
      Math.max(1, remainingMs),
    );
  });
  const attemptContext: ProviderExecutionContext = {
    ...context,
    deadline: attemptDeadline,
    abortSignal: controller.signal,
  };
  try {
    return await Promise.race([adapter.collect(request, attemptContext), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    inheritedSignal?.removeEventListener("abort", abortFromParent);
    // Successful adapters may leave speculative or streaming work behind. The
    // attempt capability ends with collect(), so close every remaining transport.
    controller.abort();
  }
}

export async function executeProvider(
  adapter: ProviderAdapter,
  request: ProviderRunRequest,
  options: ExecuteProviderOptions,
): Promise<ProviderRunResult> {
  const { context, budget, circuitBreaker } = options;
  const parsed = adapter.requestSchema.safeParse(request);
  const estimate = adapter.estimate(request, context);

  if (!parsed.success) {
    return terminalResult(adapter, context, "FAILED", estimate, {
      code: "INVALID_PROVIDER_REQUEST",
      message: "Provider request did not match its runtime schema",
      retryable: false,
    });
  }
  if (estimate.calls > adapter.metadata.maxCallsPerScan) {
    return terminalResult(adapter, context, "QUOTA_EXCEEDED", estimate, {
      code: "PROVIDER_CALL_LIMIT",
      message: `${adapter.metadata.publicName} call plan exceeds the per-scan limit`,
      retryable: false,
    });
  }
  if (circuitBreaker.isOpen(adapter.metadata.slug, context.now())) {
    return terminalResult(adapter, context, "CIRCUIT_OPEN", estimate, {
      code: "PROVIDER_CIRCUIT_OPEN",
      message: `${adapter.metadata.publicName} circuit is temporarily open`,
      retryable: true,
    });
  }
  if (!budget.reserve(estimate.estimatedUsd)) {
    return terminalResult(adapter, context, "BUDGET_EXCEEDED", estimate, {
      code: "PROVIDER_COST_LIMIT",
      message: `${adapter.metadata.publicName} estimate exceeds the remaining scan budget`,
      retryable: false,
    });
  }

  let lastError: unknown;
  let attempts = 0;
  let reservedUsd = Math.max(0, estimate.estimatedUsd);
  const maximumAttempts = Math.max(1, adapter.metadata.retryPolicy.maxAttempts);
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const executionDeadlineMs = Math.min(
      options.deadline?.getTime() ?? Number.POSITIVE_INFINITY,
      context.deadline?.getTime() ?? Number.POSITIVE_INFINITY,
    );
    const remainingMs = executionDeadlineMs - context.now().getTime();
    if (remainingMs <= 0 || context.abortSignal?.aborted) {
      lastError = new ProviderError("Provider scan deadline was exhausted", {
        code: "PROVIDER_DEADLINE_EXCEEDED",
        retryable: false,
      });
      break;
    }
    if (attempt > 1) {
      if (!budget.reserve(estimate.estimatedUsd)) {
        const stopped = terminalResult(adapter, context, "BUDGET_EXCEEDED", estimate, {
          code: "PROVIDER_RETRY_COST_LIMIT",
          message: `${adapter.metadata.publicName} retry would exceed the remaining scan budget`,
          retryable: false,
        });
        return {
          ...stopped,
          calls: estimate.calls * (attempt - 1),
          attempts: attempt - 1,
          quota: { used: estimate.quotaUnits * (attempt - 1) },
          cost: { estimatedUsd: reservedUsd, actualUsd: reservedUsd },
        };
      }
      reservedUsd += Math.max(0, estimate.estimatedUsd);
    }
    attempts = attempt;
    try {
      const startedAtMs = context.now().getTime();
      const providerDeadlineMs = startedAtMs + adapter.metadata.timeoutMs;
      const attemptDeadlineMs = Math.min(providerDeadlineMs, executionDeadlineMs);
      const result = await collectWithDeadline(
        adapter,
        parsed.data,
        context,
        new Date(attemptDeadlineMs),
        executionDeadlineMs <= providerDeadlineMs,
      );
      circuitBreaker.recordSuccess(adapter.metadata.slug);
      const withinBudget = budget.reconcile(estimate.estimatedUsd, result.cost.actualUsd);
      const priorAttemptEstimate = Math.max(0, reservedUsd - estimate.estimatedUsd);
      const totalActualUsd =
        result.cost.actualUsd === undefined
          ? undefined
          : priorAttemptEstimate + Math.max(0, result.cost.actualUsd);
      const boundedResult: ProviderRunResult = {
        ...result,
        calls: result.calls + estimate.calls * (attempt - 1),
        attempts: attempt,
        quota: {
          ...result.quota,
          used: result.quota.used + estimate.quotaUnits * (attempt - 1),
        },
        cost: {
          estimatedUsd: reservedUsd,
          ...(totalActualUsd === undefined ? {} : { actualUsd: totalActualUsd }),
        },
      };
      if (!withinBudget) {
        return {
          ...boundedResult,
          status: "BUDGET_EXCEEDED",
          signals: [],
          measurements: [],
          limitations: [
            ...boundedResult.limitations,
            "Provider-reported actual cost exceeded the hard scan ceiling; collected data was discarded.",
          ],
          errors: [
            ...boundedResult.errors,
            {
              code: "PROVIDER_ACTUAL_COST_LIMIT",
              message: "Provider-reported actual cost exceeded the hard scan ceiling",
              retryable: false,
            },
          ],
        };
      }
      return boundedResult;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt >= maximumAttempts) break;
      const delay = Math.min(
        adapter.metadata.retryPolicy.maxDelayMs,
        adapter.metadata.retryPolicy.baseDelayMs * 2 ** (attempt - 1),
      );
      if (context.now().getTime() + delay >= executionDeadlineMs) {
        lastError = new ProviderError("Provider retry would exceed the scan deadline", {
          code: "PROVIDER_DEADLINE_EXCEEDED",
          retryable: false,
        });
        break;
      }
      await context.sleep(delay);
    }
  }

  circuitBreaker.recordFailure(adapter.metadata.slug, context.now());
  const failure = errorRecord(lastError);
  const timestamp = context.now().toISOString();
  return {
    provider: adapter.metadata.slug,
    status: failure.code === "UPSTREAM_HTTP_429" ? "QUOTA_EXCEEDED" : "FAILED",
    signals: [],
    measurements: [],
    calls: estimate.calls * attempts,
    attempts,
    quota: { used: estimate.quotaUnits * attempts },
    cost: { estimatedUsd: reservedUsd, actualUsd: attempts === 0 ? 0 : reservedUsd },
    startedAt: timestamp,
    finishedAt: timestamp,
    limitations: [failure.message],
    errors: [failure],
  };
}
