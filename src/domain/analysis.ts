import { coefficientOfVariation, round } from '@/src/simulation/math';
import type {
  BottleneckObservation,
  ComparisonResult,
  SimulationResult,
} from '@/src/types';

function analyzeRun(result: SimulationResult): BottleneckObservation[] {
  const observations: BottleneckObservation[] = [];
  const slowest = [...result.workers].sort(
    (a, b) => a.capacity - b.capacity,
  )[0];
  const busiest = [...result.workers].sort(
    (a, b) => b.maxQueueDepth - a.maxQueueDepth,
  )[0];

  if (slowest.utilization >= 95 && slowest.maxQueueDepth >= 5) {
    observations.push({
      severity: slowest.queueDepthAtEnd > 0 ? 'critical' : 'warning',
      code: 'slow_worker_overloaded',
      message: `${slowest.name} is saturated and accumulated a sustained queue under ${policyLabel(result.policy)}.`,
      evidence: {
        utilizationPercent: slowest.utilization,
        maxQueueDepth: slowest.maxQueueDepth,
        capacity: slowest.capacity,
      },
    });
  }

  if (busiest.maxQueueDepth >= 8 && busiest.workerId !== slowest.workerId) {
    observations.push({
      severity: 'warning',
      code: 'queue_concentration',
      message: `Queued work is concentrated on ${busiest.name}.`,
      evidence: {
        maxQueueDepth: busiest.maxQueueDepth,
        utilizationPercent: busiest.utilization,
      },
    });
  }

  if (
    result.metrics.averageUtilization >= 90 ||
    result.metrics.unfinishedRequests > 0
  ) {
    observations.push({
      severity:
        result.metrics.unfinishedRequests > result.metrics.totalRequests * 0.1
          ? 'critical'
          : 'warning',
      code: 'system_saturation',
      message: `The cluster is operating close to saturation under ${policyLabel(result.policy)}.`,
      evidence: {
        averageUtilizationPercent: result.metrics.averageUtilization,
        unfinishedRequests: result.metrics.unfinishedRequests,
        totalRequests: result.metrics.totalRequests,
      },
    });
  }

  return observations;
}

export function inspectBottlenecks(
  latest: SimulationResult | null,
  comparison: ComparisonResult | null,
): BottleneckObservation[] {
  if (!latest && !comparison) {
    return [
      {
        severity: 'info',
        code: 'no_benchmark',
        message: 'Run a benchmark or comparison before inspecting bottlenecks.',
        evidence: {},
      },
    ];
  }

  const observations: BottleneckObservation[] = [];
  if (comparison) {
    const capacityVariation = coefficientOfVariation(
      comparison.roundRobin.workers.map((worker) => worker.capacity),
    );
    const latencyDifference = comparison.improvements.ttftP95Percent ?? 0;

    observations.push(...analyzeRun(comparison.roundRobin));
    if (capacityVariation < 0.08 && Math.abs(latencyDifference) < 5) {
      observations.push({
        severity: 'info',
        code: 'homogeneous_cluster',
        message:
          'The workers have similar capacities, so both routing policies perform similarly.',
        evidence: {
          capacityVariationPercent: round(capacityVariation * 100, 1),
          ttftP95DifferencePercent: latencyDifference,
        },
      });
    } else if (latencyDifference > 5) {
      observations.push({
        severity: 'info',
        code: 'inference_aware_advantage',
        message:
          'Inference-aware routing reduces tail latency by steering work toward earlier predicted completion times.',
        evidence: {
          ttftP95ReductionPercent: latencyDifference,
          throughputChangePercent:
            comparison.improvements.throughputPercent ?? 0,
        },
      });
    }
  } else if (latest) {
    observations.push(...analyzeRun(latest));
  }

  if (observations.length === 0) {
    observations.push({
      severity: 'info',
      code: 'balanced_run',
      message:
        'No material queue concentration or saturation was detected in the latest results.',
      evidence: {},
    });
  }
  return observations;
}

export function policyLabel(policy: SimulationResult['policy']): string {
  return policy === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin';
}
