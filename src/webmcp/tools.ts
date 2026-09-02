import type { LabStore } from '@/src/state/lab-store';
import {
  LIMITS,
  validateClusterToolInput,
  validatePolicyToolInput,
} from '@/src/domain/validation';
import type {
  ComparisonResult,
  SimulationResult,
  WorkloadConfig,
} from '@/src/types';
import type { WebMcpTool } from '@/src/webmcp/types';

const noArgumentsSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const policySchema = {
  type: 'object',
  properties: {
    policy: {
      type: 'string',
      enum: ['round_robin', 'thermalmesh'],
      description: 'The routing policy to simulate or activate.',
    },
  },
  required: ['policy'],
  additionalProperties: false,
} as const;

const configureClusterSchema = {
  type: 'object',
  properties: {
    workers: {
      type: 'array',
      minItems: LIMITS.workers.min,
      maxItems: LIMITS.workers.max,
      description:
        'The complete ordered worker list. Round Robin uses this order.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: LIMITS.workerName.min,
            maxLength: LIMITS.workerName.max,
            description: 'A unique, human-readable worker name.',
          },
          capacity: {
            type: 'number',
            minimum: LIMITS.capacity.min,
            maximum: LIMITS.capacity.max,
            description:
              'Abstract simulation capacity units, not a hardware benchmark.',
          },
        },
        required: ['name', 'capacity'],
        additionalProperties: false,
      },
    },
  },
  required: ['workers'],
  additionalProperties: false,
} as const;

const configureWorkloadSchema = {
  type: 'object',
  minProperties: 1,
  properties: {
    request_rate: {
      type: 'number',
      minimum: LIMITS.requestRate.min,
      maximum: LIMITS.requestRate.max,
      description: 'Average incoming requests per simulated second.',
    },
    input_tokens: {
      type: 'integer',
      minimum: LIMITS.inputTokens.min,
      maximum: LIMITS.inputTokens.max,
      description: 'Prompt/input tokens per request.',
    },
    output_tokens: {
      type: 'integer',
      minimum: LIMITS.outputTokens.min,
      maximum: LIMITS.outputTokens.max,
      description: 'Expected generated tokens per request.',
    },
    duration_seconds: {
      type: 'number',
      minimum: LIMITS.durationSeconds.min,
      maximum: LIMITS.durationSeconds.max,
      description: 'Simulated run duration in seconds.',
    },
    traffic_pattern: {
      type: 'string',
      enum: ['steady', 'bursty'],
      description: 'Arrival pattern for the deterministic request trace.',
    },
    seed: {
      type: 'integer',
      minimum: LIMITS.seed.min,
      maximum: LIMITS.seed.max,
      description: 'Optional deterministic random seed.',
    },
  },
  additionalProperties: false,
} as const;

function assertNoArguments(input: unknown): void {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length > 0
  ) {
    throw new Error('This tool accepts an empty object only.');
  }
}

function formatBenchmark(result: SimulationResult) {
  return {
    policy: result.policy,
    seed: result.seed,
    simulated: true,
    metrics: {
      total_requests: result.metrics.totalRequests,
      completed_requests: result.metrics.completedRequests,
      unfinished_requests: result.metrics.unfinishedRequests,
      throughput_rps: result.metrics.throughput,
      ttft_p50_ms: result.metrics.ttftP50Ms,
      ttft_p95_ms: result.metrics.ttftP95Ms,
      queue_latency_p95_ms: result.metrics.queueP95Ms,
      average_utilization_pct: result.metrics.averageUtilization,
      max_queue_depth: Math.max(
        ...result.workers.map((worker) => worker.maxQueueDepth),
        0,
      ),
    },
    workers: result.workers.map((worker) => ({
      worker_id: worker.workerId,
      name: worker.name,
      capacity: worker.capacity,
      utilization_pct: worker.utilization,
      assigned_requests: worker.assignedRequests,
      processed_requests: worker.completedRequests,
      unfinished_requests: worker.unfinishedRequests,
      final_queue_depth: worker.queueDepthAtEnd,
      max_queue_depth: worker.maxQueueDepth,
    })),
  };
}

function formatComparison(comparison: ComparisonResult) {
  return {
    winner: comparison.winner,
    scoring_rule: comparison.scoreSummary,
    scores: comparison.scores,
    thermalmesh_vs_round_robin: {
      ttft_p50_reduction_pct: comparison.improvements.ttftP50Percent,
      ttft_p95_reduction_pct: comparison.improvements.ttftP95Percent,
      queue_p95_reduction_pct: comparison.improvements.queueP95Percent,
      throughput_increase_pct: comparison.improvements.throughputPercent,
      completed_requests_delta: comparison.improvements.completedDelta,
    },
    round_robin: formatBenchmark(comparison.roundRobin),
    thermalmesh: formatBenchmark(comparison.thermalmesh),
  };
}

function mapWorkloadInput(
  input: unknown,
  current: WorkloadConfig,
): WorkloadConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Input must be an object.');
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set([
    'request_rate',
    'input_tokens',
    'output_tokens',
    'duration_seconds',
    'traffic_pattern',
    'seed',
  ]);
  const extras = Object.keys(record).filter((key) => !allowed.has(key));
  if (extras.length > 0)
    throw new Error(`Unsupported workload field(s): ${extras.join(', ')}.`);
  if (Object.keys(record).length === 0)
    throw new Error('Provide at least one workload setting.');

  const valueOrCurrent = <T>(key: string, fallback: T): unknown =>
    Object.hasOwn(record, key) ? record[key] : fallback;

  return {
    requestRate: valueOrCurrent('request_rate', current.requestRate) as number,
    inputTokens: valueOrCurrent('input_tokens', current.inputTokens) as number,
    outputTokens: valueOrCurrent(
      'output_tokens',
      current.outputTokens,
    ) as number,
    durationSeconds: valueOrCurrent(
      'duration_seconds',
      current.durationSeconds,
    ) as number,
    trafficPattern: valueOrCurrent(
      'traffic_pattern',
      current.trafficPattern,
    ) as WorkloadConfig['trafficPattern'],
    seed: valueOrCurrent('seed', current.seed) as number,
  };
}

export function createBaseToolDefinitions(store: LabStore): WebMcpTool[] {
  return [
    {
      name: 'get_cluster_state',
      title: 'Get cluster state',
      description:
        'Inspect the live ThermalMesh Lab workers, capacities, workload, active routing policy, and current simulated benchmark state before deciding what to change or run.',
      inputSchema: noArgumentsSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        assertNoArguments(input);
        const snapshot = store.getAgentSnapshot();
        return {
          ok: true,
          summary: `${snapshot.workers.length} workers are configured; ${snapshot.activePolicy} is active.`,
          simulated: true,
          ...snapshot,
          apply_winning_configuration_available: snapshot.comparisonValid,
        };
      },
    },
    {
      name: 'configure_cluster',
      title: 'Configure cluster',
      description:
        'Replace the complete ordered list of simulated inference workers. This updates the visible Cluster panel immediately and invalidates benchmark results for the previous cluster.',
      inputSchema: configureClusterSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const workers = validateClusterToolInput(input);
        const beforeVersion = store.getState().configVersion;
        const hadResults = Object.keys(store.getState().results).length > 0;
        store.configureCluster(workers, {
          actor: 'agent',
          detail: `${workers.length} workers, ${workers.reduce((sum, worker) => sum + worker.capacity, 0)} total capacity units.`,
        });
        return {
          ok: true,
          summary: `Configured ${workers.length} workers in the visible cluster.`,
          changed: store.getState().configVersion !== beforeVersion,
          workers: workers.map(({ name, capacity }) => ({ name, capacity })),
          total_capacity: workers.reduce(
            (sum, worker) => sum + worker.capacity,
            0,
          ),
          invalidated_previous_results:
            hadResults && store.getState().configVersion !== beforeVersion,
        };
      },
    },
    {
      name: 'configure_workload',
      title: 'Configure workload',
      description:
        'Update one or more simulated workload settings while preserving omitted values. This updates the visible Workload controls immediately and invalidates prior benchmark results.',
      inputSchema: configureWorkloadSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const beforeVersion = store.getState().configVersion;
        const hadResults = Object.keys(store.getState().results).length > 0;
        const workload = store.configureWorkload(
          mapWorkloadInput(input, store.getState().workload),
          { actor: 'agent' },
        );
        return {
          ok: true,
          summary: `Configured ${workload.trafficPattern} traffic at ${workload.requestRate} requests per second.`,
          changed: store.getState().configVersion !== beforeVersion,
          workload,
          invalidated_previous_results:
            hadResults && store.getState().configVersion !== beforeVersion,
        };
      },
    },
    {
      name: 'run_benchmark',
      title: 'Run routing benchmark',
      description:
        'Run one routing policy through the deterministic browser simulation and update the visible benchmark results. Use compare_routing_policies for a fair side-by-side decision.',
      inputSchema: policySchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const policy = validatePolicyToolInput(input);
        const benchmark = store.runBenchmark(policy, { actor: 'agent' });
        return {
          ok: true,
          summary: `Completed the ${policy} simulated benchmark.`,
          benchmark: formatBenchmark(benchmark),
        };
      },
    },
    {
      name: 'compare_routing_policies',
      title: 'Compare routing policies',
      description:
        'Run Round Robin and ThermalMesh against the exact same cluster, workload, and seeded request trace, update the visible comparison, and calculate a transparent winner in one operation.',
      inputSchema: noArgumentsSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        assertNoArguments(input);
        const comparison = store.compare({ actor: 'agent' });
        return {
          ok: true,
          summary:
            comparison.winner === 'tie'
              ? 'The two policies are within 1% on the composite score.'
              : `${comparison.winner} has the lower composite score for this simulated scenario.`,
          comparison: formatComparison(comparison),
          apply_winning_configuration_available: true,
        };
      },
    },
    {
      name: 'inspect_bottlenecks',
      title: 'Inspect bottlenecks',
      description:
        'Analyze the current valid comparison, or the latest benchmark, and return evidence-based queue concentration, slow-worker overload, saturation, or homogeneous-cluster observations without changing state.',
      inputSchema: noArgumentsSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        assertNoArguments(input);
        const observations = store.inspectBottlenecks();
        const state = store.getState();
        return {
          ok: true,
          summary: `${observations.length} evidence-based observation${observations.length === 1 ? '' : 's'} available.`,
          source: state.comparison
            ? 'comparison'
            : state.latestResultPolicy
              ? 'latest_benchmark'
              : 'none',
          observations,
        };
      },
    },
    {
      name: 'apply_routing_policy',
      title: 'Apply routing policy',
      description:
        'Set Round Robin or ThermalMesh as the active routing policy and update the visible policy indicator without changing the cluster, workload, or benchmark results.',
      inputSchema: policySchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const policy = validatePolicyToolInput(input);
        store.applyRoutingPolicy(policy, { actor: 'agent' });
        return {
          ok: true,
          summary: `${policy} is now visibly active.`,
          active_routing_policy: policy,
        };
      },
    },
  ];
}

export function createWinningToolDefinition(store: LabStore): WebMcpTool {
  return {
    name: 'apply_winning_configuration',
    title: 'Apply winning configuration',
    description:
      'Apply the routing policy with the lower transparent composite score from the current valid comparison. This tool is available only after comparison and disappears when the scenario changes.',
    inputSchema: noArgumentsSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertNoArguments(input);
      const comparison = store.getState().comparison;
      if (!comparison) {
        throw new Error(
          'The comparison was invalidated. Run compare_routing_policies again.',
        );
      }
      const policy = store.applyWinningConfiguration({ actor: 'agent' });
      return {
        ok: true,
        summary: `${policy} is now visibly active based on the current comparison.`,
        applied_policy: policy,
        comparison_winner: comparison.winner,
        scoring_rule: comparison.scoreSummary,
      };
    },
  };
}

export { formatBenchmark, formatComparison };
