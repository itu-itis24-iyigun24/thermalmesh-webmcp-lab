import type {
  RoutingPolicy,
  TrafficPattern,
  WorkerConfig,
  WorkerInput,
  WorkloadConfig,
} from '@/src/types';

export const LIMITS = {
  workers: { min: 1, max: 12 },
  workerName: { min: 1, max: 40 },
  capacity: { min: 10, max: 200 },
  requestRate: { min: 1, max: 80 },
  inputTokens: { min: 32, max: 32_000 },
  outputTokens: { min: 16, max: 4_096 },
  durationSeconds: { min: 5, max: 180 },
  seed: { min: 1, max: 2_147_483_646 },
} as const;

export class ValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(' '));
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value))
    throw new ValidationError([`${label} must be an object.`]);
}

function assertNoExtraKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new ValidationError([
      `${label} contains unsupported field(s): ${extras.join(', ')}.`,
    ]);
  }
}

function finiteNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError([`${label} must be a finite number.`]);
  }
  if (integer && !Number.isInteger(value)) {
    throw new ValidationError([`${label} must be an integer.`]);
  }
  if (value < min || value > max) {
    throw new ValidationError([`${label} must be between ${min} and ${max}.`]);
  }
  return value;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'worker'
  );
}

export function validateWorkers(input: unknown): WorkerConfig[] {
  if (!Array.isArray(input))
    throw new ValidationError(['workers must be an array.']);
  if (input.length < LIMITS.workers.min || input.length > LIMITS.workers.max) {
    throw new ValidationError([
      `workers must contain between ${LIMITS.workers.min} and ${LIMITS.workers.max} entries.`,
    ]);
  }

  const issues: string[] = [];
  const seenNames = new Set<string>();
  const usedIds = new Set<string>();
  const workers: WorkerConfig[] = [];

  input.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      issues.push(`workers[${index}] must be an object.`);
      return;
    }
    const allowed = ['id', 'name', 'capacity'];
    const extras = Object.keys(candidate).filter(
      (key) => !allowed.includes(key),
    );
    if (extras.length > 0)
      issues.push(
        `workers[${index}] has unsupported field(s): ${extras.join(', ')}.`,
      );

    const rawName = candidate.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (
      name.length < LIMITS.workerName.min ||
      name.length > LIMITS.workerName.max
    ) {
      issues.push(
        `workers[${index}].name must contain ${LIMITS.workerName.min}-${LIMITS.workerName.max} characters.`,
      );
    }
    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName))
      issues.push(`Worker names must be unique; duplicate: ${name}.`);
    seenNames.add(normalizedName);

    let capacity = 0;
    try {
      capacity = finiteNumber(
        candidate.capacity,
        `workers[${index}].capacity`,
        LIMITS.capacity.min,
        LIMITS.capacity.max,
      );
    } catch (error) {
      if (error instanceof ValidationError) issues.push(...error.issues);
      else throw error;
    }

    let id =
      typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : slugify(name);
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${slugify(name)}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    workers.push({ id, name, capacity });
  });

  if (issues.length > 0) throw new ValidationError(issues);
  return workers;
}

export function validateClusterToolInput(input: unknown): WorkerConfig[] {
  assertRecord(input, 'Input');
  assertNoExtraKeys(input, ['workers'], 'Input');
  if (!('workers' in input))
    throw new ValidationError(['workers is required.']);
  if (Array.isArray(input.workers)) {
    const issues: string[] = [];
    input.workers.forEach((worker, index) => {
      if (!isRecord(worker)) return;
      const extras = Object.keys(worker).filter(
        (key) => key !== 'name' && key !== 'capacity',
      );
      if (extras.length > 0) {
        issues.push(
          `workers[${index}] has unsupported field(s): ${extras.join(', ')}.`,
        );
      }
    });
    if (issues.length > 0) throw new ValidationError(issues);
  }
  return validateWorkers(input.workers);
}

export function validateWorkload(
  input: unknown,
  base?: WorkloadConfig,
): WorkloadConfig {
  assertRecord(input, 'Workload');
  const allowed = [
    'requestRate',
    'inputTokens',
    'outputTokens',
    'durationSeconds',
    'trafficPattern',
    'seed',
  ] as const;
  assertNoExtraKeys(input, allowed, 'Workload');
  if (Object.keys(input).length === 0 && !base) {
    throw new ValidationError(['Workload must include configuration values.']);
  }

  const merged = { ...base, ...input } as Partial<WorkloadConfig>;
  const required = allowed.filter((key) => merged[key] === undefined);
  if (required.length > 0) {
    throw new ValidationError([
      `Missing workload field(s): ${required.join(', ')}.`,
    ]);
  }

  const trafficPattern = merged.trafficPattern;
  if (trafficPattern !== 'steady' && trafficPattern !== 'bursty') {
    throw new ValidationError(['trafficPattern must be steady or bursty.']);
  }

  return {
    requestRate: finiteNumber(
      merged.requestRate,
      'requestRate',
      LIMITS.requestRate.min,
      LIMITS.requestRate.max,
    ),
    inputTokens: finiteNumber(
      merged.inputTokens,
      'inputTokens',
      LIMITS.inputTokens.min,
      LIMITS.inputTokens.max,
      true,
    ),
    outputTokens: finiteNumber(
      merged.outputTokens,
      'outputTokens',
      LIMITS.outputTokens.min,
      LIMITS.outputTokens.max,
      true,
    ),
    durationSeconds: finiteNumber(
      merged.durationSeconds,
      'durationSeconds',
      LIMITS.durationSeconds.min,
      LIMITS.durationSeconds.max,
    ),
    trafficPattern,
    seed: finiteNumber(
      merged.seed,
      'seed',
      LIMITS.seed.min,
      LIMITS.seed.max,
      true,
    ),
  };
}

export function validateWorkloadToolInput(
  input: unknown,
  current: WorkloadConfig,
): WorkloadConfig {
  assertRecord(input, 'Input');
  if (Object.keys(input).length === 0) {
    throw new ValidationError(['At least one workload setting is required.']);
  }
  return validateWorkload(input, current);
}

export function validatePolicy(value: unknown): RoutingPolicy {
  if (value !== 'round_robin' && value !== 'thermalmesh') {
    throw new ValidationError(['policy must be round_robin or thermalmesh.']);
  }
  return value;
}

export function validatePolicyToolInput(input: unknown): RoutingPolicy {
  assertRecord(input, 'Input');
  assertNoExtraKeys(input, ['policy'], 'Input');
  if (!('policy' in input)) throw new ValidationError(['policy is required.']);
  return validatePolicy(input.policy);
}

export function workerInputs(workers: readonly WorkerConfig[]): WorkerInput[] {
  return workers.map(({ name, capacity }) => ({ name, capacity }));
}

export function isTrafficPattern(value: string): value is TrafficPattern {
  return value === 'steady' || value === 'bursty';
}
