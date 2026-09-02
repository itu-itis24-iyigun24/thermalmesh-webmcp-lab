import { round } from '@/src/simulation/math';
import { simulateScenario } from '@/src/simulation/simulate';
import type {
  ComparisonResult,
  RoutingPolicy,
  ScenarioConfig,
  SimulationResult,
} from '@/src/types';

const SCORE_SUMMARY =
  'Lower is better: 45% TTFT p95, 20% queue p95, 20% inverse throughput, and 15% unfinished-work penalty.';

function safePercent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return round((numerator / denominator) * 100, 1);
}

export function performanceScore(result: SimulationResult): number {
  const inverseThroughputMs =
    result.metrics.throughput > 0
      ? 1_000 / result.metrics.throughput
      : 1_000_000;
  const unfinishedRate =
    result.metrics.totalRequests > 0
      ? result.metrics.unfinishedRequests / result.metrics.totalRequests
      : 1;
  return round(
    result.metrics.ttftP95Ms * 0.45 +
      result.metrics.queueP95Ms * 0.2 +
      inverseThroughputMs * 0.2 +
      unfinishedRate * 10_000 * 0.15,
    2,
  );
}

export function compareRoutingPolicies(
  config: ScenarioConfig,
): ComparisonResult {
  const roundRobin = simulateScenario(config, 'round_robin');
  const thermalmesh = simulateScenario(config, 'thermalmesh');
  const scores: Record<RoutingPolicy, number> = {
    round_robin: performanceScore(roundRobin),
    thermalmesh: performanceScore(thermalmesh),
  };
  const bestScore = Math.min(scores.round_robin, scores.thermalmesh);
  const scoreGap = Math.abs(scores.round_robin - scores.thermalmesh);
  const isTie = bestScore === 0 ? scoreGap === 0 : scoreGap / bestScore < 0.01;
  const winner = isTie
    ? 'tie'
    : scores.round_robin < scores.thermalmesh
      ? 'round_robin'
      : 'thermalmesh';

  return {
    scenarioSignature: roundRobin.scenarioSignature,
    roundRobin,
    thermalmesh,
    winner,
    scores,
    scoreSummary: SCORE_SUMMARY,
    improvements: {
      ttftP50Percent: safePercent(
        roundRobin.metrics.ttftP50Ms - thermalmesh.metrics.ttftP50Ms,
        roundRobin.metrics.ttftP50Ms,
      ),
      ttftP95Percent: safePercent(
        roundRobin.metrics.ttftP95Ms - thermalmesh.metrics.ttftP95Ms,
        roundRobin.metrics.ttftP95Ms,
      ),
      queueP95Percent: safePercent(
        roundRobin.metrics.queueP95Ms - thermalmesh.metrics.queueP95Ms,
        roundRobin.metrics.queueP95Ms,
      ),
      throughputPercent: safePercent(
        thermalmesh.metrics.throughput - roundRobin.metrics.throughput,
        roundRobin.metrics.throughput,
      ),
      completedDelta:
        thermalmesh.metrics.completedRequests -
        roundRobin.metrics.completedRequests,
    },
  };
}
