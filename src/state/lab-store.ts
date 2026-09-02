import { inspectBottlenecks } from '@/src/domain/analysis';
import { compareRoutingPolicies } from '@/src/domain/comparison';
import {
  validatePolicy,
  validateWorkers,
  validateWorkload,
} from '@/src/domain/validation';
import { DEFAULT_WORKERS, DEFAULT_WORKLOAD } from '@/src/simulation/scenario';
import { simulateScenario } from '@/src/simulation/simulate';
import type {
  ActivityActor,
  BottleneckObservation,
  LabState,
  RoutingPolicy,
  WebMcpStatus,
  WorkerConfig,
  WorkloadConfig,
} from '@/src/types';

export type StateListener = () => void;

export interface ActionOptions {
  actor?: ActivityActor;
  detail?: string;
}

export interface AgentStateSnapshot {
  workers: Array<{
    name: string;
    capacity: number;
    utilization: number | null;
    queueDepth: number | null;
    processedRequests: number | null;
  }>;
  workload: WorkloadConfig;
  activePolicy: RoutingPolicy;
  latestBenchmark: LabState['results'][RoutingPolicy] | null;
  comparison: LabState['comparison'];
  comparisonValid: boolean;
}

const cloneWorkers = (workers: readonly WorkerConfig[]): WorkerConfig[] =>
  workers.map((worker) => ({ ...worker }));

const cloneWorkload = (workload: WorkloadConfig): WorkloadConfig => ({
  ...workload,
});

export class LabStore {
  private state: LabState;
  private listeners = new Set<StateListener>();
  private activityCounter = 0;

  constructor(
    initial?: Partial<Pick<LabState, 'workers' | 'workload' | 'activePolicy'>>,
  ) {
    this.state = {
      workers: validateWorkers(
        initial?.workers ?? cloneWorkers(DEFAULT_WORKERS),
      ),
      workload: validateWorkload(
        initial?.workload ?? cloneWorkload(DEFAULT_WORKLOAD),
      ),
      activePolicy: validatePolicy(initial?.activePolicy ?? 'round_robin'),
      latestResultPolicy: null,
      results: {},
      comparison: null,
      activity: [],
      webMcpStatus: 'checking',
      webMcpError: null,
      notice: 'Ready to simulate the current scenario.',
      configVersion: 0,
      resultsInvalidated: false,
    };
  }

  getState = (): LabState => this.state;

  subscribe = (listener: StateListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(next: LabState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private activity(actor: ActivityActor, action: string, detail: string) {
    this.activityCounter += 1;
    return {
      id: this.activityCounter,
      actor,
      action,
      detail,
      timestamp: new Date().toISOString(),
    };
  }

  private invalidateConfiguration(
    next: Pick<LabState, 'workers' | 'workload'>,
    actor: ActivityActor,
    action: string,
    detail: string,
  ): void {
    const hadResults =
      this.state.comparison !== null ||
      Object.keys(this.state.results).length > 0;
    this.emit({
      ...this.state,
      ...next,
      results: {},
      latestResultPolicy: null,
      comparison: null,
      configVersion: this.state.configVersion + 1,
      resultsInvalidated: hadResults,
      notice:
        'Configuration changed. Run a new comparison for fresh simulated metrics.',
      activity: [
        this.activity(actor, action, detail),
        ...this.state.activity,
      ].slice(0, 20),
    });
  }

  configureCluster(
    input: unknown,
    options: ActionOptions = {},
  ): WorkerConfig[] {
    const workers = validateWorkers(input);
    const unchanged =
      workers.length === this.state.workers.length &&
      workers.every(
        (worker, index) =>
          worker.name === this.state.workers[index].name &&
          worker.capacity === this.state.workers[index].capacity,
      );
    if (unchanged) return cloneWorkers(this.state.workers);
    const actor = options.actor ?? 'human';
    this.invalidateConfiguration(
      { workers, workload: this.state.workload },
      actor,
      'configured cluster',
      options.detail ?? `${workers.length} heterogeneous workers are active.`,
    );
    return workers;
  }

  updateWorker(
    id: string,
    patch: Partial<Pick<WorkerConfig, 'name' | 'capacity'>>,
  ): WorkerConfig[] {
    const workers = this.state.workers.map((worker) =>
      worker.id === id ? { ...worker, ...patch } : worker,
    );
    const current = this.state.workers.find((worker) => worker.id === id);
    return this.configureCluster(workers, {
      actor: 'human',
      detail: `Updated ${patch.name?.trim() || current?.name || 'worker'} configuration.`,
    });
  }

  addWorker(): WorkerConfig[] {
    const usedNames = new Set(
      this.state.workers.map((worker) => worker.name.toLowerCase()),
    );
    let index = this.state.workers.length + 1;
    while (usedNames.has(`worker ${index}`.toLowerCase())) index += 1;
    const name = `Worker ${index}`;
    return this.configureCluster(
      [
        ...this.state.workers,
        {
          id: `manual-worker-${index}`,
          name,
          capacity: 50,
        },
      ],
      { actor: 'human', detail: `Added ${name} at 50 capacity units.` },
    );
  }

  removeWorker(id: string): WorkerConfig[] {
    const worker = this.state.workers.find((candidate) => candidate.id === id);
    return this.configureCluster(
      this.state.workers.filter((candidate) => candidate.id !== id),
      {
        actor: 'human',
        detail: `Removed ${worker?.name ?? 'worker'} from the cluster.`,
      },
    );
  }

  configureWorkload(
    input: unknown,
    options: ActionOptions = {},
  ): WorkloadConfig {
    const workload = validateWorkload(input, this.state.workload);
    const unchanged = (
      Object.keys(workload) as Array<keyof WorkloadConfig>
    ).every((key) => workload[key] === this.state.workload[key]);
    if (unchanged) return cloneWorkload(this.state.workload);
    const actor = options.actor ?? 'human';
    this.invalidateConfiguration(
      { workers: this.state.workers, workload },
      actor,
      'configured workload',
      options.detail ??
        `${workload.trafficPattern} traffic at ${workload.requestRate} requests per second.`,
    );
    return workload;
  }

  loadDemoScenario(): void {
    const hadResults =
      this.state.comparison !== null ||
      Object.keys(this.state.results).length > 0;
    this.emit({
      ...this.state,
      workers: cloneWorkers(DEFAULT_WORKERS),
      workload: cloneWorkload(DEFAULT_WORKLOAD),
      activePolicy: 'round_robin',
      results: {},
      latestResultPolicy: null,
      comparison: null,
      configVersion: this.state.configVersion + 1,
      resultsInvalidated: hadResults,
      notice: 'Demo scenario loaded. Run the policy comparison when ready.',
      activity: [
        this.activity(
          'human',
          'loaded demo scenario',
          '4:1 capacity spread with bursty traffic.',
        ),
        ...this.state.activity,
      ].slice(0, 20),
    });
  }

  runBenchmark(policyInput: unknown, options: ActionOptions = {}) {
    const policy = validatePolicy(policyInput);
    const result = simulateScenario(
      { workers: this.state.workers, workload: this.state.workload },
      policy,
    );
    const actor = options.actor ?? 'human';
    this.emit({
      ...this.state,
      results: { ...this.state.results, [policy]: result },
      latestResultPolicy: policy,
      resultsInvalidated: false,
      notice: `${policy === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin'} benchmark completed.`,
      activity: [
        this.activity(
          actor,
          'ran benchmark',
          options.detail ??
            `${policy === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin'} processed ${result.metrics.completedRequests} requests.`,
        ),
        ...this.state.activity,
      ].slice(0, 20),
    });
    return result;
  }

  compare(options: ActionOptions = {}) {
    const comparison = compareRoutingPolicies({
      workers: this.state.workers,
      workload: this.state.workload,
    });
    const actor = options.actor ?? 'human';
    const winnerLabel =
      comparison.winner === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin';
    const comparisonNotice =
      comparison.winner === 'tie'
        ? 'Comparison complete. Policies are within 1% of the best composite score.'
        : `Comparison complete. ${winnerLabel} has the lower composite score.`;
    const comparisonDetail =
      comparison.winner === 'tie'
        ? 'Comparison resulted in a tie within the 1% decision threshold.'
        : `${winnerLabel} ranked best for this exact seeded scenario.`;
    this.emit({
      ...this.state,
      results: {
        round_robin: comparison.roundRobin,
        thermalmesh: comparison.thermalmesh,
      },
      latestResultPolicy:
        comparison.winner === 'tie'
          ? this.state.activePolicy
          : comparison.winner,
      resultsInvalidated: false,
      comparison,
      notice: comparisonNotice,
      activity: [
        this.activity(
          actor,
          'compared routing policies',
          options.detail ?? comparisonDetail,
        ),
        ...this.state.activity,
      ].slice(0, 20),
    });
    return comparison;
  }

  applyRoutingPolicy(
    policyInput: unknown,
    options: ActionOptions = {},
  ): RoutingPolicy {
    const policy = validatePolicy(policyInput);
    const actor = options.actor ?? 'human';
    this.emit({
      ...this.state,
      activePolicy: policy,
      notice: `${policy === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin'} is now the active policy.`,
      activity: [
        this.activity(
          actor,
          'applied routing policy',
          options.detail ??
            `${policy === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin'} is active.`,
        ),
        ...this.state.activity,
      ].slice(0, 20),
    });
    return policy;
  }

  applyWinningConfiguration(options: ActionOptions = {}): RoutingPolicy {
    const comparison = this.state.comparison;
    if (!comparison)
      throw new Error(
        'Run a comparison before applying the winning configuration.',
      );
    const policy =
      comparison.winner === 'tie' ? this.state.activePolicy : comparison.winner;
    return this.applyRoutingPolicy(policy, {
      ...options,
      detail:
        comparison.winner === 'tie'
          ? `Policies are within 1%; kept ${policy === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin'} active.`
          : `Applied the lower-scoring ${policy === 'thermalmesh' ? 'ThermalMesh' : 'Round Robin'} policy.`,
    });
  }

  inspectBottlenecks(): BottleneckObservation[] {
    const latest = this.state.latestResultPolicy
      ? (this.state.results[this.state.latestResultPolicy] ?? null)
      : null;
    return inspectBottlenecks(latest, this.state.comparison);
  }

  setWebMcpStatus(status: WebMcpStatus, error: string | null = null): void {
    if (this.state.webMcpStatus === status && this.state.webMcpError === error)
      return;
    this.emit({ ...this.state, webMcpStatus: status, webMcpError: error });
  }

  getAgentSnapshot(): AgentStateSnapshot {
    const result = this.state.latestResultPolicy
      ? (this.state.results[this.state.latestResultPolicy] ?? null)
      : null;
    const metricById = new Map(
      result?.workers.map((worker) => [worker.workerId, worker]) ?? [],
    );
    return {
      workers: this.state.workers.map((worker) => {
        const metric = metricById.get(worker.id);
        return {
          name: worker.name,
          capacity: worker.capacity,
          utilization: metric?.utilization ?? null,
          queueDepth: metric?.queueDepthAtEnd ?? null,
          processedRequests: metric?.completedRequests ?? null,
        };
      }),
      workload: cloneWorkload(this.state.workload),
      activePolicy: this.state.activePolicy,
      latestBenchmark: result,
      comparison: this.state.comparison,
      comparisonValid: this.state.comparison !== null,
    };
  }
}

export const labStore = new LabStore();
