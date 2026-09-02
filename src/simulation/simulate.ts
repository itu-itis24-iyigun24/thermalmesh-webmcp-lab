import { percentile, round } from '@/src/simulation/math';
import { createSeededRandom } from '@/src/simulation/prng';
import { scenarioSignature } from '@/src/simulation/scenario';
import { validateWorkers, validateWorkload } from '@/src/domain/validation';
import type {
  RoutingPolicy,
  ScenarioConfig,
  SimulationResult,
  WorkerConfig,
  WorkerMetrics,
} from '@/src/types';

export interface PlannedRequest {
  arrivalMs: number;
  prefillWork: number;
  decodeWork: number;
}

interface RuntimeWorker {
  config: WorkerConfig;
  availableAtMs: number;
  pendingFinishTimes: number[];
  pendingHead: number;
  assignedRequests: number;
  completedRequests: number;
  maxQueueDepth: number;
  busyMs: number;
}

const BUCKET_MS = 100;
const BURST_CYCLE_MS = 5_000;
const BURST_WINDOW_MS = 1_500;
const BURST_RATE_MULTIPLIER = 2.45;
const LULL_RATE_MULTIPLIER = 0.38;

function rawTrafficMultiplier(
  pattern: ScenarioConfig['workload']['trafficPattern'],
  bucketStart: number,
): number {
  if (pattern === 'steady') return 1;
  return bucketStart % BURST_CYCLE_MS < BURST_WINDOW_MS
    ? BURST_RATE_MULTIPLIER
    : LULL_RATE_MULTIPLIER;
}

function trafficNormalization(
  pattern: ScenarioConfig['workload']['trafficPattern'],
  durationMs: number,
): number {
  if (pattern === 'steady') return 1;
  let weightedMultiplierMs = 0;
  for (
    let bucketStart = 0;
    bucketStart < durationMs;
    bucketStart += BUCKET_MS
  ) {
    const bucketWidth = Math.min(BUCKET_MS, durationMs - bucketStart);
    weightedMultiplierMs +=
      bucketWidth * rawTrafficMultiplier(pattern, bucketStart);
  }
  return durationMs / weightedMultiplierMs;
}

export function generateRequestPlan(
  config: ScenarioConfig,
): readonly PlannedRequest[] {
  validateWorkers(config.workers);
  const workload = validateWorkload(config.workload);
  const random = createSeededRandom(workload.seed);
  const requests: PlannedRequest[] = [];
  const durationMs = workload.durationSeconds * 1_000;
  const normalization = trafficNormalization(
    workload.trafficPattern,
    durationMs,
  );

  for (
    let bucketStart = 0;
    bucketStart < durationMs;
    bucketStart += BUCKET_MS
  ) {
    const bucketWidth = Math.min(BUCKET_MS, durationMs - bucketStart);
    const multiplier =
      rawTrafficMultiplier(workload.trafficPattern, bucketStart) *
      normalization;
    const expected = workload.requestRate * (bucketWidth / 1_000) * multiplier;
    const guaranteed = Math.floor(expected);
    const count = guaranteed + (random.next() < expected - guaranteed ? 1 : 0);

    for (let index = 0; index < count; index += 1) {
      const inputJitter = 0.82 + random.next() * 0.36;
      const outputJitter = 0.78 + random.next() * 0.44;
      const inputTokens = workload.inputTokens * inputJitter;
      const outputTokens = workload.outputTokens * outputJitter;

      requests.push({
        arrivalMs: Math.min(
          durationMs - 0.001,
          bucketStart + random.next() * bucketWidth,
        ),
        prefillWork: 0.65 + inputTokens * 0.003,
        decodeWork: 0.45 + outputTokens * 0.028,
      });
    }
  }

  requests.sort((left, right) => left.arrivalMs - right.arrivalMs);
  for (const request of requests) Object.freeze(request);
  return Object.freeze(requests);
}

export function chooseWorkerIndex(
  policy: RoutingPolicy,
  workers: readonly Pick<RuntimeWorker, 'availableAtMs' | 'config'>[],
  request: PlannedRequest,
  roundRobinIndex: number,
): number {
  if (policy === 'round_robin') return roundRobinIndex % workers.length;

  const totalWork = request.prefillWork + request.decodeWork;
  let bestIndex = 0;
  let bestCompletion = Number.POSITIVE_INFINITY;

  workers.forEach((worker, index) => {
    const start = Math.max(request.arrivalMs, worker.availableAtMs);
    const predictedCompletion =
      start + (totalWork / worker.config.capacity) * 1_000;
    const completionDifference = predictedCompletion - bestCompletion;
    const preferredIndex = roundRobinIndex % workers.length;
    const candidateDistance =
      (index - preferredIndex + workers.length) % workers.length;
    const currentDistance =
      (bestIndex - preferredIndex + workers.length) % workers.length;
    if (
      completionDifference < -0.000_001 ||
      (Math.abs(completionDifference) <= 0.000_001 &&
        candidateDistance < currentDistance)
    ) {
      bestCompletion = predictedCompletion;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function simulateScenario(
  config: ScenarioConfig,
  policy: RoutingPolicy,
  requestPlan: readonly PlannedRequest[] = generateRequestPlan(config),
): SimulationResult {
  const validatedConfig: ScenarioConfig = {
    workers: validateWorkers(config.workers),
    workload: validateWorkload(config.workload),
  };

  const durationMs = validatedConfig.workload.durationSeconds * 1_000;
  const requests = requestPlan;
  requests.forEach((request, index) => {
    if (
      !Number.isFinite(request.arrivalMs) ||
      !Number.isFinite(request.prefillWork) ||
      !Number.isFinite(request.decodeWork) ||
      request.arrivalMs < 0 ||
      request.arrivalMs >= durationMs ||
      request.prefillWork <= 0 ||
      request.decodeWork < 0
    ) {
      throw new Error(`Request trace entry ${index} is invalid.`);
    }
  });
  const runtimeWorkers: RuntimeWorker[] = validatedConfig.workers.map(
    (worker) => ({
      config: worker,
      availableAtMs: 0,
      pendingFinishTimes: [],
      pendingHead: 0,
      assignedRequests: 0,
      completedRequests: 0,
      maxQueueDepth: 0,
      busyMs: 0,
    }),
  );
  const observedTtft: number[] = [];
  const observedQueueLatency: number[] = [];
  let roundRobinIndex = 0;

  for (const request of requests) {
    for (const worker of runtimeWorkers) {
      while (
        worker.pendingHead < worker.pendingFinishTimes.length &&
        worker.pendingFinishTimes[worker.pendingHead] <= request.arrivalMs
      ) {
        worker.pendingHead += 1;
      }
    }

    const selectedIndex = chooseWorkerIndex(
      policy,
      runtimeWorkers,
      request,
      roundRobinIndex,
    );
    roundRobinIndex += 1;

    const worker = runtimeWorkers[selectedIndex];
    const startMs = Math.max(request.arrivalMs, worker.availableAtMs);
    const queueLatencyMs = startMs - request.arrivalMs;
    const prefillMs = (request.prefillWork / worker.config.capacity) * 1_000;
    const serviceMs =
      ((request.prefillWork + request.decodeWork) / worker.config.capacity) *
      1_000;
    const finishMs = startMs + serviceMs;
    const ttftMs = queueLatencyMs + prefillMs;

    worker.assignedRequests += 1;
    worker.maxQueueDepth = Math.max(
      worker.maxQueueDepth,
      worker.pendingFinishTimes.length - worker.pendingHead,
    );
    worker.pendingFinishTimes.push(finishMs);
    worker.availableAtMs = finishMs;
    worker.busyMs += Math.max(
      0,
      Math.min(finishMs, durationMs) - Math.min(startMs, durationMs),
    );

    if (startMs <= durationMs) {
      observedQueueLatency.push(queueLatencyMs);
    }
    if (startMs + prefillMs <= durationMs) {
      observedTtft.push(ttftMs);
    }

    if (finishMs <= durationMs) {
      worker.completedRequests += 1;
    }
  }

  const completedRequests = runtimeWorkers.reduce(
    (sum, worker) => sum + worker.completedRequests,
    0,
  );
  const unfinishedRequests = requests.length - completedRequests;
  const workerMetrics: WorkerMetrics[] = runtimeWorkers.map((worker) => {
    let firstAfterEnd = worker.pendingHead;
    while (
      firstAfterEnd < worker.pendingFinishTimes.length &&
      worker.pendingFinishTimes[firstAfterEnd] <= durationMs
    ) {
      firstAfterEnd += 1;
    }
    const remainingAtEnd = worker.pendingFinishTimes.length - firstAfterEnd;
    return {
      workerId: worker.config.id,
      name: worker.config.name,
      capacity: worker.config.capacity,
      assignedRequests: worker.assignedRequests,
      completedRequests: worker.completedRequests,
      unfinishedRequests: worker.assignedRequests - worker.completedRequests,
      utilization: round(Math.min(100, (worker.busyMs / durationMs) * 100), 1),
      maxQueueDepth: worker.maxQueueDepth,
      queueDepthAtEnd: Math.max(0, remainingAtEnd - 1),
      busyMs: round(worker.busyMs, 1),
    };
  });

  return {
    policy,
    seed: validatedConfig.workload.seed,
    scenarioSignature: scenarioSignature(validatedConfig),
    metrics: {
      ttftP50Ms:
        observedTtft.length > 0
          ? round(percentile(observedTtft, 0.5), 1)
          : null,
      ttftP95Ms:
        observedTtft.length > 0
          ? round(percentile(observedTtft, 0.95), 1)
          : null,
      throughput: round(
        completedRequests / validatedConfig.workload.durationSeconds,
        2,
      ),
      queueP95Ms:
        observedQueueLatency.length > 0
          ? round(percentile(observedQueueLatency, 0.95), 1)
          : null,
      ttftSampleCount: observedTtft.length,
      queueSampleCount: observedQueueLatency.length,
      completedRequests,
      unfinishedRequests,
      totalRequests: requests.length,
      averageUtilization: round(
        workerMetrics.reduce((sum, worker) => sum + worker.utilization, 0) /
          workerMetrics.length,
        1,
      ),
    },
    workers: workerMetrics,
  };
}
