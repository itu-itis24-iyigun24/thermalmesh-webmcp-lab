import { round } from '@/src/simulation/math';
import {
  generateRequestPlan,
  simulateScenario,
} from '@/src/simulation/simulate';
import type {
  ComparisonResult,
  RoutingPolicy,
  ScenarioConfig,
  SimulationResult,
} from '@/src/types';

const SCORE_SUMMARY =
  'More completed requests wins; when completion counts match, lower composite score wins: 55% TTFT p95, 25% queue p95, and 20% inverse throughput.';

const MISSING_METRIC_PENALTY_MS = 1_000_000;

function lowerIsBetterPercent(
  baseline: number | null,
  candidate: number | null,
): number | null {
  if (baseline === null || candidate === null || baseline === 0) return null;
  return round(((baseline - candidate) / baseline) * 100, 1);
}

function higherIsBetterPercent(
  baseline: number,
  candidate: number,
): number | null {
  if (baseline === 0) return null;
  return round(((candidate - baseline) / baseline) * 100, 1);
}

export function performanceScore(result: SimulationResult): number {
  const inverseThroughputMs =
    result.metrics.throughput > 0
      ? 1_000 / result.metrics.throughput
      : MISSING_METRIC_PENALTY_MS;
  const ttftP95Ms = result.metrics.ttftP95Ms ?? MISSING_METRIC_PENALTY_MS;
  const queueP95Ms = result.metrics.queueP95Ms ?? MISSING_METRIC_PENALTY_MS;
  return round(
    ttftP95Ms * 0.55 + queueP95Ms * 0.25 + inverseThroughputMs * 0.2,
    2,
  );
}

export function scoresAreTied(left: number, right: number): boolean {
  const bestScore = Math.min(left, right);
  const scoreGap = Math.abs(left - right);
  return bestScore === 0 ? scoreGap === 0 : scoreGap / bestScore < 0.01;
}

export function compareRoutingPolicies(
  config: ScenarioConfig,
): ComparisonResult {
  const requestPlan = generateRequestPlan(config);
  const roundRobin = simulateScenario(config, 'round_robin', requestPlan);
  const thermalmesh = simulateScenario(config, 'thermalmesh', requestPlan);
  const scores: Record<RoutingPolicy, number> = {
    round_robin: performanceScore(roundRobin),
    thermalmesh: performanceScore(thermalmesh),
  };
  const isTie = scoresAreTied(scores.round_robin, scores.thermalmesh);
  const completionDelta =
    thermalmesh.metrics.completedRequests -
    roundRobin.metrics.completedRequests;
  const winner =
    completionDelta > 0
      ? 'thermalmesh'
      : completionDelta < 0
        ? 'round_robin'
        : isTie
          ? 'tie'
          : scores.round_robin < scores.thermalmesh
            ? 'round_robin'
            : 'thermalmesh';
  const decisionReason =
    completionDelta !== 0
      ? `${winner === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin'} completed ${Math.abs(completionDelta)} more request${Math.abs(completionDelta) === 1 ? '' : 's'} inside the observation window.`
      : winner === 'tie'
        ? 'Completion counts match and composite scores are less than 1% apart.'
        : `${winner === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin'} has the lower composite score with equal completion counts.`;

  return {
    scenarioSignature: roundRobin.scenarioSignature,
    roundRobin,
    thermalmesh,
    winner,
    scores,
    scoreSummary: SCORE_SUMMARY,
    decisionReason,
    improvements: {
      ttftP50Percent: lowerIsBetterPercent(
        roundRobin.metrics.ttftP50Ms,
        thermalmesh.metrics.ttftP50Ms,
      ),
      ttftP95Percent: lowerIsBetterPercent(
        roundRobin.metrics.ttftP95Ms,
        thermalmesh.metrics.ttftP95Ms,
      ),
      queueP95Percent: lowerIsBetterPercent(
        roundRobin.metrics.queueP95Ms,
        thermalmesh.metrics.queueP95Ms,
      ),
      throughputPercent: higherIsBetterPercent(
        roundRobin.metrics.throughput,
        thermalmesh.metrics.throughput,
      ),
      completedDelta: completionDelta,
    },
  };
}
