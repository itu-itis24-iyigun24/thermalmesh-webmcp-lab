import { describe, expect, it } from 'vitest';

import {
  compareRoutingPolicies,
  performanceScore,
  scoresAreTied,
} from '@/src/domain/comparison';
import {
  ValidationError,
  validateWorkers,
  validateWorkload,
} from '@/src/domain/validation';
import { percentile } from '@/src/simulation/math';
import { DEMO_SCENARIO } from '@/src/simulation/scenario';
import {
  chooseWorkerIndex,
  generateRequestPlan,
  simulateScenario,
} from '@/src/simulation/simulate';

const routingWorkers = [
  { config: { id: 'a', name: 'A', capacity: 100 }, availableAtMs: 0 },
  { config: { id: 'b', name: 'B', capacity: 50 }, availableAtMs: 0 },
  { config: { id: 'c', name: 'C', capacity: 25 }, availableAtMs: 0 },
];
const request = { arrivalMs: 0, prefillWork: 2, decodeWork: 8 };

describe('routing policies', () => {
  it('Round Robin distributes sequentially in worker order', () => {
    const assignments = Array.from({ length: 7 }, (_, index) =>
      chooseWorkerIndex('round_robin', routingWorkers, request, index),
    );
    expect(assignments).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it('ThermalMesh responds to both capacity and queued availability', () => {
    expect(chooseWorkerIndex('thermalmesh', routingWorkers, request, 0)).toBe(
      0,
    );
    const loadedFastWorker = [
      { ...routingWorkers[0], availableAtMs: 2_000 },
      routingWorkers[1],
      routingWorkers[2],
    ];
    expect(chooseWorkerIndex('thermalmesh', loadedFastWorker, request, 0)).toBe(
      1,
    );
  });
});

describe('deterministic simulation', () => {
  it('reproduces the same result with the same seed', () => {
    const first = simulateScenario(DEMO_SCENARIO, 'thermalmesh');
    const second = simulateScenario(DEMO_SCENARIO, 'thermalmesh');
    expect(second).toEqual(first);

    const differentSeed = {
      ...DEMO_SCENARIO,
      workload: {
        ...DEMO_SCENARIO.workload,
        seed: DEMO_SCENARIO.workload.seed + 1,
      },
    };
    expect(generateRequestPlan(differentSeed)).not.toEqual(
      generateRequestPlan(DEMO_SCENARIO),
    );
  });

  it('uses linear-interpolated percentiles', () => {
    expect(percentile([0, 10, 20, 30], 0.5)).toBe(15);
    expect(percentile([0, 10, 20, 30], 0.95)).toBeCloseTo(28.5);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([0, 10, 20], 0.5)).toBe(10);
    expect(percentile([], 0.95)).toBe(0);
    expect(() => percentile([], Number.NaN)).toThrow(RangeError);
    expect(() => percentile([], -0.1)).toThrow(RangeError);
    expect(() => percentile([1, Number.POSITIVE_INFINITY], 0.5)).toThrow(
      RangeError,
    );
  });

  it('treats score gaps below, but not exactly at, 1% as ties', () => {
    expect(scoresAreTied(100, 100.99)).toBe(true);
    expect(scoresAreTied(100, 101)).toBe(false);
    expect(scoresAreTied(0, 0)).toBe(true);
    expect(scoresAreTied(0, 1)).toBe(false);
  });

  it('creates a frozen trace and allows both policies to consume that exact trace', () => {
    const trace = generateRequestPlan(DEMO_SCENARIO);
    expect(Object.isFrozen(trace)).toBe(true);
    expect(trace.every((request) => Object.isFrozen(request))).toBe(true);
    const roundRobin = simulateScenario(DEMO_SCENARIO, 'round_robin', trace);
    const thermalmesh = simulateScenario(DEMO_SCENARIO, 'thermalmesh', trace);
    expect(roundRobin.metrics.totalRequests).toBe(trace.length);
    expect(thermalmesh.metrics.totalRequests).toBe(trace.length);
    expect(roundRobin.scenarioSignature).toBe(thermalmesh.scenarioSignature);
  });

  it('lets input and output token settings materially increase service work', () => {
    const baseline = generateRequestPlan({
      ...DEMO_SCENARIO,
      workload: {
        ...DEMO_SCENARIO.workload,
        inputTokens: 128,
        outputTokens: 32,
      },
    });
    const larger = generateRequestPlan({
      ...DEMO_SCENARIO,
      workload: {
        ...DEMO_SCENARIO.workload,
        inputTokens: 2_048,
        outputTokens: 512,
      },
    });
    expect(larger).toHaveLength(baseline.length);
    expect(larger[0].prefillWork).toBeGreaterThan(baseline[0].prefillWork);
    expect(larger[0].decodeWork).toBeGreaterThan(baseline[0].decodeWork);
  });

  it('lets worker capacity materially reduce service and first-token time', () => {
    const trace = Object.freeze([
      Object.freeze({ arrivalMs: 0, prefillWork: 2, decodeWork: 8 }),
    ]);
    const fast = simulateScenario(
      {
        ...DEMO_SCENARIO,
        workers: [{ id: 'fast', name: 'Fast', capacity: 100 }],
      },
      'round_robin',
      trace,
    );
    const slow = simulateScenario(
      {
        ...DEMO_SCENARIO,
        workers: [{ id: 'slow', name: 'Slow', capacity: 50 }],
      },
      'round_robin',
      trace,
    );
    expect(fast.metrics.ttftP50Ms).not.toBeNull();
    expect(slow.metrics.ttftP50Ms).toBe(fast.metrics.ttftP50Ms! * 2);
    expect(slow.workers[0].busyMs).toBe(fast.workers[0].busyMs * 2);
  });

  it('keeps bursty average demand near steady demand while concentrating arrivals', () => {
    const steady = generateRequestPlan({
      ...DEMO_SCENARIO,
      workload: { ...DEMO_SCENARIO.workload, trafficPattern: 'steady' },
    });
    const bursty = generateRequestPlan(DEMO_SCENARIO);
    const steadyOpening = steady.filter((request) => request.arrivalMs < 1_500);
    const burstyOpening = bursty.filter((request) => request.arrivalMs < 1_500);
    expect(burstyOpening.length).toBeGreaterThan(steadyOpening.length * 1.8);
    expect(
      Math.abs(bursty.length - steady.length) / steady.length,
    ).toBeLessThan(0.08);
  });

  it('normalizes burst demand for durations that end mid-cycle', () => {
    const workload = {
      ...DEMO_SCENARIO.workload,
      requestRate: 80,
      durationSeconds: 6.5,
    };
    const steady = generateRequestPlan({
      ...DEMO_SCENARIO,
      workload: { ...workload, trafficPattern: 'steady' },
    });
    const bursty = generateRequestPlan({
      ...DEMO_SCENARIO,
      workload: { ...workload, trafficPattern: 'bursty' },
    });
    expect(
      Math.abs(bursty.length - steady.length) / steady.length,
    ).toBeLessThan(0.05);
  });

  it('compares identical scenario inputs and request counts', () => {
    const comparison = compareRoutingPolicies(DEMO_SCENARIO);
    expect(comparison.roundRobin.scenarioSignature).toBe(
      comparison.thermalmesh.scenarioSignature,
    );
    expect(comparison.roundRobin.metrics.totalRequests).toBe(
      comparison.thermalmesh.metrics.totalRequests,
    );
    expect(comparison.roundRobin.seed).toBe(comparison.thermalmesh.seed);
  });

  it('naturally produces different routing behavior for the demo scenario', () => {
    const comparison = compareRoutingPolicies(DEMO_SCENARIO);
    const roundRobinSlow = comparison.roundRobin.workers.at(-1)!;
    const thermalmeshSlow = comparison.thermalmesh.workers.at(-1)!;

    expect(thermalmeshSlow.assignedRequests).toBeLessThan(
      roundRobinSlow.assignedRequests,
    );
    expect(comparison.thermalmesh.metrics.completedRequests).toBeGreaterThan(
      comparison.roundRobin.metrics.completedRequests,
    );
    expect(comparison.thermalmesh.metrics.ttftP95Ms).not.toBeNull();
    expect(comparison.roundRobin.metrics.ttftP95Ms).not.toBeNull();
    expect(comparison.thermalmesh.metrics.ttftP95Ms!).toBeLessThan(
      comparison.roundRobin.metrics.ttftP95Ms!,
    );
    expect(comparison.winner).toBe('thermalmesh');
    expect(comparison.improvements.ttftP95Percent!).toBeGreaterThan(0);
    expect(comparison.improvements.queueP95Percent!).toBeGreaterThan(0);
    expect(comparison.improvements.throughputPercent!).toBeGreaterThan(0);
    expect(comparison.improvements.completedDelta).toBeGreaterThan(0);
    expect(
      comparison.roundRobin.workers.reduce(
        (sum, worker) => sum + worker.assignedRequests,
        0,
      ),
    ).toBe(comparison.roundRobin.metrics.totalRequests);
    expect(
      comparison.thermalmesh.workers.reduce(
        (sum, worker) => sum + worker.completedRequests,
        0,
      ),
    ).toBe(comparison.thermalmesh.metrics.completedRequests);
  });

  it('does not force ThermalMesh to win a lightly loaded homogeneous cluster', () => {
    const homogeneous = {
      workers: Array.from({ length: 4 }, (_, index) => ({
        id: `equal-${index}`,
        name: `Equal Worker ${index + 1}`,
        capacity: 80,
      })),
      workload: {
        ...DEMO_SCENARIO.workload,
        requestRate: 2,
        inputTokens: 512,
        outputTokens: 96,
        trafficPattern: 'steady' as const,
      },
    };
    const comparison = compareRoutingPolicies(homogeneous);
    expect(comparison.winner).toBe('tie');
    expect(comparison.roundRobin.metrics.completedRequests).toBe(
      comparison.thermalmesh.metrics.completedRequests,
    );
    const thermalAssignments = comparison.thermalmesh.workers.map(
      (worker) => worker.assignedRequests,
    );
    expect(
      Math.max(...thermalAssignments) - Math.min(...thermalAssignments),
    ).toBeLessThanOrEqual(1);
  });

  it('allows Round Robin to win a valid equal-completion scenario', () => {
    const comparison = compareRoutingPolicies({
      workers: [
        { id: 'worker-a', name: 'Worker A', capacity: 39 },
        { id: 'worker-b', name: 'Worker B', capacity: 86 },
      ],
      workload: {
        requestRate: 14,
        inputTokens: 121,
        outputTokens: 77,
        durationSeconds: 16,
        trafficPattern: 'steady',
        seed: 7_920,
      },
    });
    expect(comparison.roundRobin.metrics.completedRequests).toBe(
      comparison.thermalmesh.metrics.completedRequests,
    );
    expect(comparison.winner).toBe('round_robin');
  });

  it('prefers more completed work over censored latency samples', () => {
    const decodeHeavy = {
      workers: [
        { id: 'fast', name: 'Fast', capacity: 200 },
        { id: 'slow', name: 'Slow', capacity: 10 },
      ],
      workload: {
        requestRate: 1,
        inputTokens: 32,
        outputTokens: 4_096,
        durationSeconds: 5,
        trafficPattern: 'steady' as const,
        seed: 42,
      },
    };
    const comparison = compareRoutingPolicies(decodeHeavy);
    expect(comparison.thermalmesh.metrics.completedRequests).toBeGreaterThan(
      comparison.roundRobin.metrics.completedRequests,
    );
    expect(comparison.winner).toBe('thermalmesh');
  });

  it('keeps the maximum validated scenario lightweight', () => {
    const maximumScenario = {
      workers: [{ id: 'only', name: 'Only Worker', capacity: 10 }],
      workload: {
        requestRate: 80,
        inputTokens: 32_000,
        outputTokens: 4_096,
        durationSeconds: 180,
        trafficPattern: 'steady' as const,
        seed: 99,
      },
    };
    const startedAt = performance.now();
    const comparison = compareRoutingPolicies(maximumScenario);
    const elapsedMs = performance.now() - startedAt;

    expect(comparison.roundRobin.metrics.totalRequests).toBeGreaterThan(14_000);
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it('keeps zero-completion overload metrics and scoring finite', () => {
    const zeroCompletion = simulateScenario(
      {
        workers: [{ id: 'slow', name: 'Slow', capacity: 10 }],
        workload: {
          requestRate: 1,
          inputTokens: 32_000,
          outputTokens: 4_096,
          durationSeconds: 5,
          trafficPattern: 'steady',
          seed: 9,
        },
      },
      'round_robin',
    );
    expect(zeroCompletion.metrics.completedRequests).toBe(0);
    expect(zeroCompletion.metrics.throughput).toBe(0);
    expect(zeroCompletion.metrics.unfinishedRequests).toBeGreaterThan(0);
    expect(zeroCompletion.metrics.ttftP50Ms).toBeNull();
    expect(
      Object.values(zeroCompletion.metrics).every(
        (value) => value === null || Number.isFinite(value),
      ),
    ).toBe(true);
    expect(Number.isFinite(performanceScore(zeroCompletion))).toBe(true);
  });

  it('rejects invalid configuration at the public simulation boundary', () => {
    expect(() =>
      simulateScenario(
        {
          workers: [{ id: 'bad', name: 'Bad', capacity: Number.NaN }],
          workload: DEMO_SCENARIO.workload,
        },
        'round_robin',
      ),
    ).toThrow(/finite/i);
    expect(() =>
      simulateScenario(
        {
          workers: DEMO_SCENARIO.workers,
          workload: { ...DEMO_SCENARIO.workload, durationSeconds: 0 },
        },
        'thermalmesh',
      ),
    ).toThrow(/between/i);
    expect(() =>
      simulateScenario(DEMO_SCENARIO, 'round_robin', [
        { arrivalMs: Number.NaN, prefillWork: 1, decodeWork: 1 },
      ]),
    ).toThrow(/trace entry/i);
  });
});

describe('validation', () => {
  it('rejects invalid domain inputs safely', () => {
    expect(() => validateWorkers([])).toThrow(ValidationError);
    expect(() =>
      validateWorkers([
        { name: 'Same', capacity: 100 },
        { name: ' same ', capacity: 50 },
      ]),
    ).toThrow(/unique/i);
    expect(() =>
      validateWorkload({ ...DEMO_SCENARIO.workload, requestRate: Number.NaN }),
    ).toThrow(/finite/i);
    expect(() =>
      validateWorkload({
        ...DEMO_SCENARIO.workload,
        requestRate: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/finite/i);
    expect(() =>
      validateWorkers([
        { name: 'Invalid', capacity: Number.POSITIVE_INFINITY },
      ]),
    ).toThrow(/finite/i);
  });
});
