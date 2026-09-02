import type { ScenarioConfig, WorkerConfig, WorkloadConfig } from '@/src/types';

export const DEFAULT_WORKERS: WorkerConfig[] = [
  { id: 'fast-worker-a', name: 'Fast Worker A', capacity: 100 },
  { id: 'fast-worker-b', name: 'Fast Worker B', capacity: 90 },
  { id: 'medium-worker', name: 'Medium Worker', capacity: 55 },
  { id: 'slow-worker', name: 'Slow Worker', capacity: 25 },
];

export const DEFAULT_WORKLOAD: WorkloadConfig = {
  requestRate: 18,
  inputTokens: 1_200,
  outputTokens: 320,
  durationSeconds: 45,
  trafficPattern: 'bursty',
  seed: 20_260_903,
};

export const DEMO_SCENARIO: ScenarioConfig = {
  workers: DEFAULT_WORKERS,
  workload: DEFAULT_WORKLOAD,
};

export function scenarioSignature(config: ScenarioConfig): string {
  const workers = config.workers.map(({ name, capacity }) => ({
    name,
    capacity,
  }));
  return JSON.stringify({ workers, workload: config.workload });
}
