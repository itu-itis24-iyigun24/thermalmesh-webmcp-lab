import { describe, expect, it } from 'vitest';

import { compareRoutingPolicies } from '@/src/domain/comparison';
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
    expect(percentile([], 0.95)).toBe(0);
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
    expect(comparison.thermalmesh.metrics.ttftP95Ms).toBeLessThan(
      comparison.roundRobin.metrics.ttftP95Ms,
    );
    expect(comparison.winner).toBe('thermalmesh');
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
  });

  it('penalizes unfinished work instead of rewarding censored slow requests', () => {
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
    expect(comparison.scores.thermalmesh).toBeLessThan(
      comparison.scores.round_robin,
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
    expect(elapsedMs).toBeLessThan(1_500);
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
  });
});
