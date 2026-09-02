export type RoutingPolicy = 'round_robin' | 'thermalmesh';
export type TrafficPattern = 'steady' | 'bursty';
export type ActivityActor = 'agent' | 'human' | 'system';

export interface WorkerInput {
  name: string;
  capacity: number;
}

export interface WorkerConfig extends WorkerInput {
  id: string;
}

export interface WorkloadConfig {
  requestRate: number;
  inputTokens: number;
  outputTokens: number;
  durationSeconds: number;
  trafficPattern: TrafficPattern;
  seed: number;
}

export interface ScenarioConfig {
  workers: WorkerConfig[];
  workload: WorkloadConfig;
}

export interface WorkerMetrics {
  workerId: string;
  name: string;
  capacity: number;
  assignedRequests: number;
  completedRequests: number;
  unfinishedRequests: number;
  utilization: number;
  maxQueueDepth: number;
  queueDepthAtEnd: number;
  busyMs: number;
}

export interface SimulationMetrics {
  ttftP50Ms: number;
  ttftP95Ms: number;
  throughput: number;
  queueP95Ms: number;
  completedRequests: number;
  unfinishedRequests: number;
  totalRequests: number;
  averageUtilization: number;
}

export interface SimulationResult {
  policy: RoutingPolicy;
  seed: number;
  scenarioSignature: string;
  metrics: SimulationMetrics;
  workers: WorkerMetrics[];
}

export interface ComparisonImprovements {
  ttftP50Percent: number | null;
  ttftP95Percent: number | null;
  queueP95Percent: number | null;
  throughputPercent: number | null;
  completedDelta: number;
}

export interface ComparisonResult {
  scenarioSignature: string;
  roundRobin: SimulationResult;
  thermalmesh: SimulationResult;
  improvements: ComparisonImprovements;
  winner: RoutingPolicy | 'tie';
  scores: Record<RoutingPolicy, number>;
  scoreSummary: string;
}

export interface ActivityEntry {
  id: number;
  actor: ActivityActor;
  action: string;
  detail: string;
  timestamp: string;
}

export type WebMcpStatus = 'checking' | 'enabled' | 'unavailable' | 'error';

export interface LabState {
  workers: WorkerConfig[];
  workload: WorkloadConfig;
  activePolicy: RoutingPolicy;
  latestResultPolicy: RoutingPolicy | null;
  results: Partial<Record<RoutingPolicy, SimulationResult>>;
  comparison: ComparisonResult | null;
  activity: ActivityEntry[];
  webMcpStatus: WebMcpStatus;
  webMcpError: string | null;
  notice: string;
  configVersion: number;
  resultsInvalidated: boolean;
}

export interface BottleneckObservation {
  severity: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
  evidence: Record<string, string | number>;
}
