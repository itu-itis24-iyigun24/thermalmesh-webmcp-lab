import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  BrainCircuit,
  Check,
  CircleDot,
  Cpu,
  Gauge,
  Info,
  Network,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Route,
  Server,
  Sparkles,
  Trash2,
  UserRound,
  Waypoints,
  Zap,
} from 'lucide-react';
import { useMemo, useState, type ReactNode, type SyntheticEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { policyLabel } from '@/src/domain/analysis';
import { LIMITS } from '@/src/domain/validation';
import { labStore } from '@/src/state/lab-store';
import { useLabState } from '@/src/state/use-lab-store';
import type {
  ActivityEntry,
  ComparisonResult,
  LabState,
  RoutingPolicy,
  SimulationResult,
  WorkerConfig,
  WorkerMetrics,
  WorkloadConfig,
} from '@/src/types';
import { useWebMcp } from '@/src/webmcp/use-webmcp';

const BASE_TOOLS = [
  'get_cluster_state',
  'configure_cluster',
  'configure_workload',
  'run_benchmark',
  'compare_routing_policies',
  'inspect_bottlenecks',
  'apply_routing_policy',
];

function Panel({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`rounded-2xl border border-white/9 bg-card/72 shadow-[0_22px_55px_rgb(0_0_0/14%)] backdrop-blur-sm ${className}`}
    >
      {children}
    </section>
  );
}

function ComparisonPulse({ comparison }: { comparison: ComparisonResult }) {
  const winnerLabel =
    comparison.winner === 'tie'
      ? 'Policies score less than 1% apart'
      : `${policyLabel(comparison.winner)} leads this scenario`;
  const tailChange = comparison.improvements.ttftP95Percent;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-cyan-300/18 bg-cyan-300/[0.055] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-cyan-300/10 text-cyan-200">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-medium text-white">{winnerLabel}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {tailChange === null
              ? 'Tail-latency change is not available for this run.'
              : `ThermalMesh TTFT p95 is ${Math.abs(tailChange).toFixed(1)}% ${tailChange >= 0 ? 'lower' : 'higher'}; ${comparison.improvements.completedDelta >= 0 ? '+' : ''}${comparison.improvements.completedDelta} completed requests.`}
          </p>
        </div>
      </div>
      <a
        href="#benchmark-results"
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] px-3 text-sm font-medium text-white outline-none transition-colors hover:bg-white/[0.07] focus-visible:ring-3 focus-visible:ring-cyan-300/25"
      >
        View comparison
      </a>
    </div>
  );
}

function PanelHeading({
  index,
  eyebrow,
  title,
  detail,
  action,
}: {
  index: string;
  eyebrow: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 font-mono text-xs text-cyan-300/65">
          {index}
        </span>
        <div className="min-w-0">
          <p className="section-kicker">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-white">
            {title}
          </h2>
          {detail ? (
            <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function WebMcpBadge({ status }: { status: LabState['webMcpStatus'] }) {
  if (status === 'enabled') {
    return (
      <Badge className="h-6 border border-emerald-300/20 bg-emerald-300/10 px-2.5 text-emerald-200">
        <span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgb(110_231_183)]" />
        WebMCP Enabled
      </Badge>
    );
  }
  if (status === 'error') {
    return (
      <Badge className="h-6 border border-rose-300/20 bg-rose-300/10 px-2.5 text-rose-200">
        <AlertTriangle className="size-3" /> WebMCP error
      </Badge>
    );
  }
  if (status === 'checking') {
    return (
      <Badge
        variant="outline"
        className="h-6 border-white/10 px-2.5 text-muted-foreground"
      >
        <RefreshCw className="size-3 animate-spin motion-reduce:animate-none" />{' '}
        Checking WebMCP
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="h-6 border-white/10 px-2.5 text-muted-foreground"
    >
      <CircleDot className="size-3" /> Manual mode
    </Badge>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  accent = false,
}: {
  icon: typeof Cpu;
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className={`summary-card ${accent ? 'summary-card--accent' : ''}`}>
      <div>
        <p className="font-mono text-xl font-semibold tracking-[-0.03em] text-white">
          {value}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      </div>
      <Icon
        className={`size-5 ${accent ? 'text-cyan-200' : 'text-cyan-300/60'}`}
        aria-hidden="true"
      />
    </div>
  );
}

function WorkerEditor({
  worker,
  metrics,
  canRemove,
}: {
  worker: WorkerConfig;
  metrics?: WorkerMetrics;
  canRemove: boolean;
}) {
  const [name, setName] = useState(worker.name);
  const [capacity, setCapacity] = useState(String(worker.capacity));
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const numericCapacity = Number(capacity);
    if (name.trim() === worker.name && numericCapacity === worker.capacity)
      return;
    try {
      labStore.updateWorker(worker.id, {
        name: name.trim(),
        capacity: numericCapacity,
      });
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Invalid worker configuration.',
      );
    }
  };

  const utilization = metrics?.utilization ?? 0;
  const loadTone =
    utilization >= 95 ? 'rose' : utilization >= 80 ? 'amber' : 'cyan';

  return (
    <article className="worker-card">
      <div className="mb-3 flex items-start gap-2">
        <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-lg border border-white/8 bg-black/20">
          <Server className="size-4 text-cyan-200/75" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor={`name-${worker.id}`}>
            Worker name
          </label>
          <Input
            id={`name-${worker.id}`}
            value={name}
            maxLength={LIMITS.workerName.max}
            onChange={(event) => setName(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            className="h-8 border-transparent bg-transparent px-1 text-sm font-medium text-white hover:border-white/10 focus-visible:bg-black/20"
            aria-invalid={Boolean(error)}
          />
          <p className="px-1 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
            abstract worker
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canRemove}
          onClick={() => {
            try {
              labStore.removeWorker(worker.id);
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : 'Could not remove worker.',
              );
            }
          }}
          aria-label={`Remove ${worker.name}`}
          className="text-muted-foreground hover:bg-rose-400/10 hover:text-rose-200"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-3 border-t border-white/7 pt-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Utilization</span>
            <span className="font-mono text-white">
              {metrics ? `${utilization.toFixed(1)}%` : 'Not run'}
            </span>
          </div>
          <progress
            className="sr-only"
            max={100}
            value={metrics ? utilization : 0}
            aria-label={`${worker.name} utilization`}
          >
            {metrics ? `${utilization}%` : 'Not run'}
          </progress>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-white/8"
            aria-hidden="true"
          >
            <div
              className={`h-full rounded-full meter-${loadTone}`}
              style={{ width: `${utilization}%` }}
            />
          </div>
        </div>
        <div>
          <label
            className="mb-1.5 block text-xs text-muted-foreground"
            htmlFor={`capacity-${worker.id}`}
          >
            Capacity
          </label>
          <div className="relative">
            <Input
              id={`capacity-${worker.id}`}
              type="number"
              min={LIMITS.capacity.min}
              max={LIMITS.capacity.max}
              step="any"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              className="h-8 pr-8 font-mono text-sm tabular-nums"
              aria-invalid={Boolean(error)}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
              u
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/7 pt-3 text-center">
        <WorkerDatum
          label="Assigned"
          value={metrics?.assignedRequests ?? '—'}
        />
        <WorkerDatum
          label="Processed"
          value={metrics?.completedRequests ?? '—'}
        />
        <WorkerDatum label="Max queue" value={metrics?.maxQueueDepth ?? '—'} />
      </div>
      {error ? (
        <p className="mt-3 text-xs leading-4 text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function WorkerDatum({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div>
      <p className="font-mono text-sm font-medium text-white">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function WorkloadForm({ workload }: { workload: WorkloadConfig }) {
  const [draft, setDraft] = useState(workload);
  const [error, setError] = useState<string | null>(null);

  const setNumber = (key: keyof WorkloadConfig, value: string) => {
    setDraft((current) => ({ ...current, [key]: Number(value) }));
  };

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      labStore.configureWorkload(draft, { actor: 'human' });
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Invalid workload configuration.',
      );
    }
  };

  return (
    <form onSubmit={submit} className="p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Request rate" unit="req/s" hint="1–80">
          <Input
            type="number"
            min={LIMITS.requestRate.min}
            max={LIMITS.requestRate.max}
            step="any"
            value={draft.requestRate}
            onChange={(event) => setNumber('requestRate', event.target.value)}
            aria-label="Request rate in requests per second"
            className="field-input"
          />
        </Field>
        <Field label="Input size" unit="tokens" hint="32–32k">
          <Input
            type="number"
            min={LIMITS.inputTokens.min}
            max={LIMITS.inputTokens.max}
            step="1"
            value={draft.inputTokens}
            onChange={(event) => setNumber('inputTokens', event.target.value)}
            aria-label="Input size in tokens"
            className="field-input"
          />
        </Field>
        <Field label="Expected output" unit="tokens" hint="16–4k">
          <Input
            type="number"
            min={LIMITS.outputTokens.min}
            max={LIMITS.outputTokens.max}
            step="1"
            value={draft.outputTokens}
            onChange={(event) => setNumber('outputTokens', event.target.value)}
            aria-label="Expected output tokens"
            className="field-input"
          />
        </Field>
        <Field label="Duration" unit="seconds" hint="5–180">
          <Input
            type="number"
            min={LIMITS.durationSeconds.min}
            max={LIMITS.durationSeconds.max}
            step="any"
            value={draft.durationSeconds}
            onChange={(event) =>
              setNumber('durationSeconds', event.target.value)
            }
            aria-label="Simulation duration in seconds"
            className="field-input"
          />
        </Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_8.5rem]">
        <Field label="Traffic pattern" hint="Deterministic">
          <NativeSelect
            value={draft.trafficPattern}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                trafficPattern: event.target
                  .value as WorkloadConfig['trafficPattern'],
              }))
            }
            className="w-full"
            aria-label="Traffic pattern"
          >
            <NativeSelectOption value="steady">Steady</NativeSelectOption>
            <NativeSelectOption value="bursty">Bursty</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field label="Seed" hint="Reproducible">
          <Input
            type="number"
            min={LIMITS.seed.min}
            max={LIMITS.seed.max}
            step="1"
            value={draft.seed}
            onChange={(event) => setNumber('seed', event.target.value)}
            aria-label="Random seed"
            className="field-input"
          />
        </Field>
      </div>
      {error ? (
        <p className="mt-3 text-xs leading-5 text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="outline"
        className="mt-4 h-9 w-full border-white/10 bg-white/[0.035]"
      >
        <Check aria-hidden="true" /> Apply workload
      </Button>
    </form>
  );
}

function Field({
  label,
  unit,
  hint,
  children,
}: {
  label: string;
  unit?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-xs text-muted-foreground/80">
          {unit ?? hint}
        </span>
      </span>
      {children}
    </label>
  );
}

function RoutingControls({ state }: { state: LabState }) {
  const [runError, setRunError] = useState<string | null>(null);
  const run = (policy: RoutingPolicy) => {
    try {
      labStore.runBenchmark(policy, { actor: 'human' });
      setRunError(null);
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : 'Benchmark failed to run.',
      );
    }
  };

  return (
    <div className="p-4 sm:p-5">
      <div className="grid gap-2 sm:grid-cols-2">
        {(['round_robin', 'thermalmesh'] as const).map((policy) => (
          <button
            type="button"
            key={policy}
            aria-pressed={state.activePolicy === policy}
            onClick={() =>
              labStore.applyRoutingPolicy(policy, { actor: 'human' })
            }
            className={`policy-option ${state.activePolicy === policy ? 'policy-option--active' : ''}`}
          >
            {policy === 'round_robin' ? (
              <Waypoints aria-hidden="true" />
            ) : (
              <BrainCircuit aria-hidden="true" />
            )}
            <span>
              <b>{policyLabel(policy)}</b>
              <small>
                {policy === 'round_robin'
                  ? 'Sequential assignment'
                  : 'Predicted completion'}
              </small>
            </span>
            {state.activePolicy === policy ? (
              <Check className="ml-auto text-cyan-200" aria-hidden="true" />
            ) : null}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => run('round_robin')}
          className="h-9 border-white/10 bg-white/[0.025]"
        >
          <Play aria-hidden="true" /> Run RR
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => run('thermalmesh')}
          className="h-9 border-white/10 bg-white/[0.025]"
        >
          <Play aria-hidden="true" /> Run TM
        </Button>
      </div>
      <Button
        type="button"
        onClick={() => labStore.compare({ actor: 'human' })}
        className="mt-2 h-10 w-full bg-cyan-300 text-slate-950 shadow-[0_0_24px_rgb(34_211_238/12%)] hover:bg-cyan-200"
      >
        <BarChart3 aria-hidden="true" /> Compare routing policies
      </Button>
      {runError ? (
        <p className="mt-3 text-xs leading-5 text-rose-300" role="alert">
          {runError}
        </p>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Both policies receive the exact same seeded request trace.
      </p>
    </div>
  );
}

function EmptyResults({
  hasStaleConfiguration,
}: {
  hasStaleConfiguration: boolean;
}) {
  return (
    <div className="grid min-h-56 place-items-center px-5 py-10 text-center">
      <div className="max-w-md">
        <div className="mx-auto grid size-11 place-items-center rounded-xl border border-cyan-300/15 bg-cyan-300/7">
          <BarChart3 className="size-5 text-cyan-200/70" aria-hidden="true" />
        </div>
        <h3 className="mt-4 font-medium text-white">
          {hasStaleConfiguration
            ? 'Scenario changed'
            : 'No simulated metrics yet'}
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {hasStaleConfiguration
            ? 'Previous results were cleared so stale metrics cannot be mistaken for the current configuration.'
            : 'Load the demo or configure the scenario, then compare both routing policies.'}
        </p>
        <Button
          type="button"
          onClick={() => labStore.compare({ actor: 'human' })}
          className="mt-4 h-9 bg-cyan-300 text-slate-950 hover:bg-cyan-200"
        >
          <Play aria-hidden="true" /> Run comparison
        </Button>
      </div>
    </div>
  );
}

type MetricRow = {
  label: string;
  direction: 'lower' | 'higher';
  roundRobin: number | null;
  thermalmesh: number | null;
  unit: string;
  percent?: number | null;
};

function differenceText(row: MetricRow): {
  text: string;
  positive: boolean | null;
} {
  if (row.percent === null || row.percent === undefined)
    return { text: 'N/A', positive: null };
  if (Math.abs(row.percent) < 0.05)
    return { text: 'No change', positive: null };
  const thermalBetter = row.percent > 0;
  const adjective =
    row.direction === 'lower'
      ? thermalBetter
        ? 'lower'
        : 'higher'
      : thermalBetter
        ? 'higher'
        : 'lower';
  return {
    text: `${Math.abs(row.percent).toFixed(1)}% ${adjective}`,
    positive: thermalBetter,
  };
}

function ComparisonTable({ comparison }: { comparison: ComparisonResult }) {
  const rows: MetricRow[] = [
    {
      label: 'TTFT p50',
      direction: 'lower',
      roundRobin: comparison.roundRobin.metrics.ttftP50Ms,
      thermalmesh: comparison.thermalmesh.metrics.ttftP50Ms,
      unit: 'ms',
      percent: comparison.improvements.ttftP50Percent,
    },
    {
      label: 'TTFT p95',
      direction: 'lower',
      roundRobin: comparison.roundRobin.metrics.ttftP95Ms,
      thermalmesh: comparison.thermalmesh.metrics.ttftP95Ms,
      unit: 'ms',
      percent: comparison.improvements.ttftP95Percent,
    },
    {
      label: 'Queue latency p95',
      direction: 'lower',
      roundRobin: comparison.roundRobin.metrics.queueP95Ms,
      thermalmesh: comparison.thermalmesh.metrics.queueP95Ms,
      unit: 'ms',
      percent: comparison.improvements.queueP95Percent,
    },
    {
      label: 'Throughput',
      direction: 'higher',
      roundRobin: comparison.roundRobin.metrics.throughput,
      thermalmesh: comparison.thermalmesh.metrics.throughput,
      unit: 'req/s',
      percent: comparison.improvements.throughputPercent,
    },
  ];

  return (
    <Table>
      <TableCaption className="sr-only">
        Simulated routing policy comparison for the current cluster and
        workload.
      </TableCaption>
      <TableHeader>
        <TableRow className="border-white/8 hover:bg-transparent">
          <TableHead
            scope="col"
            className="h-9 pl-0 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground"
          >
            Metric
          </TableHead>
          <TableHead
            scope="col"
            className="h-9 text-right font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground"
          >
            Round Robin
          </TableHead>
          <TableHead
            scope="col"
            className="h-9 text-right font-mono text-xs uppercase tracking-[0.1em] text-cyan-200/90"
          >
            ThermalMesh
          </TableHead>
          <TableHead
            scope="col"
            className="h-9 pr-0 text-right font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground"
          >
            Difference
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const difference = differenceText(row);
          return (
            <TableRow
              key={row.label}
              className="border-white/7 hover:bg-white/[0.025]"
            >
              <th
                scope="row"
                className="py-3 pl-0 text-left font-normal text-muted-foreground"
              >
                {row.label} {row.direction === 'lower' ? '↓' : '↑'}
              </th>
              <TableCell className="py-3 text-right font-mono tabular-nums text-white">
                {formatMetric(row.roundRobin, row.unit)}
              </TableCell>
              <TableCell className="py-3 text-right font-mono tabular-nums text-cyan-100">
                {formatMetric(row.thermalmesh, row.unit)}
              </TableCell>
              <TableCell
                className={`py-3 pr-0 text-right text-xs ${difference.positive === true ? 'text-emerald-300' : difference.positive === false ? 'text-amber-300' : 'text-muted-foreground'}`}
              >
                {difference.text}
              </TableCell>
            </TableRow>
          );
        })}
        <TableRow className="border-white/7 hover:bg-white/[0.025]">
          <th
            scope="row"
            className="py-3 pl-0 text-left font-normal text-muted-foreground"
          >
            Completed ↑
          </th>
          <TableCell className="py-3 text-right font-mono text-white">
            {comparison.roundRobin.metrics.completedRequests}
          </TableCell>
          <TableCell className="py-3 text-right font-mono text-cyan-100">
            {comparison.thermalmesh.metrics.completedRequests}
          </TableCell>
          <TableCell
            className={`py-3 pr-0 text-right text-xs ${comparison.improvements.completedDelta > 0 ? 'text-emerald-300' : comparison.improvements.completedDelta < 0 ? 'text-amber-300' : 'text-muted-foreground'}`}
          >
            {comparison.improvements.completedDelta > 0 ? '+' : ''}
            {comparison.improvements.completedDelta} requests
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function formatMetric(value: number | null, unit: string): string {
  if (value === null) return 'Not observed';
  const decimals = unit === 'req/s' ? 2 : value >= 1_000 ? 0 : 1;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${unit}`;
}

function WinnerBanner({ comparison }: { comparison: ComparisonResult }) {
  const winner = comparison.winner;
  const appliedPolicy =
    winner === 'tie' ? labStore.getState().activePolicy : winner;
  const label =
    winner === 'tie'
      ? 'Comparable performance'
      : `${policyLabel(winner)} recommended`;
  const icon =
    winner === 'tie' ? (
      <Info className="size-5" aria-hidden="true" />
    ) : (
      <Sparkles className="size-5" aria-hidden="true" />
    );

  return (
    <div className="mb-4 flex flex-col gap-4 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.055] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-300/10 text-cyan-200">
          {icon}
        </div>
        <div>
          <p className="font-medium text-white">{label}</p>
          <p className="mt-1 text-sm leading-5 text-cyan-50/90">
            {comparison.decisionReason}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {comparison.scoreSummary}
          </p>
        </div>
      </div>
      <Button
        type="button"
        onClick={() => labStore.applyWinningConfiguration({ actor: 'human' })}
        className="h-9 shrink-0 bg-cyan-300 text-slate-950 hover:bg-cyan-200"
      >
        <Route aria-hidden="true" /> Apply {policyLabel(appliedPolicy)}
      </Button>
    </div>
  );
}

function SingleBenchmark({ result }: { result: SimulationResult }) {
  const metrics = [
    ['TTFT p50', formatMetric(result.metrics.ttftP50Ms, 'ms')],
    ['TTFT p95', formatMetric(result.metrics.ttftP95Ms, 'ms')],
    ['Queue p95', formatMetric(result.metrics.queueP95Ms, 'ms')],
    ['Throughput', `${result.metrics.throughput.toFixed(2)} req/s`],
    ['Completed', result.metrics.completedRequests.toLocaleString()],
    ['Unfinished', result.metrics.unfinishedRequests.toLocaleString()],
  ];
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">
            {policyLabel(result.policy)} run complete
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Seed {result.seed.toLocaleString()}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => labStore.compare({ actor: 'human' })}
          variant="outline"
          className="h-9 border-white/10 bg-white/[0.025]"
        >
          Compare both
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-white/8 bg-black/15 p-3"
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-mono text-base text-white">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LatencyBars({ comparison }: { comparison: ComparisonResult }) {
  const groups = [
    [
      'TTFT p50',
      comparison.roundRobin.metrics.ttftP50Ms,
      comparison.thermalmesh.metrics.ttftP50Ms,
    ],
    [
      'TTFT p95',
      comparison.roundRobin.metrics.ttftP95Ms,
      comparison.thermalmesh.metrics.ttftP95Ms,
    ],
    [
      'Queue p95',
      comparison.roundRobin.metrics.queueP95Ms,
      comparison.thermalmesh.metrics.queueP95Ms,
    ],
  ] as const;
  const max = Math.max(
    ...groups.flatMap(([, roundRobin, thermalmesh]) => [
      roundRobin ?? 0,
      thermalmesh ?? 0,
    ]),
    1,
  );

  return (
    <div className="space-y-4">
      {groups.map(([label, roundRobin, thermalmesh]) => (
        <div key={label}>
          <p className="mb-2 text-xs text-muted-foreground">{label}</p>
          <div className="space-y-1.5">
            <ComparisonBar
              label="RR"
              value={roundRobin}
              width={roundRobin === null ? 0 : (roundRobin / max) * 100}
              tone="muted"
            />
            <ComparisonBar
              label="TM"
              value={thermalmesh}
              width={thermalmesh === null ? 0 : (thermalmesh / max) * 100}
              tone="cyan"
            />
          </div>
        </div>
      ))}
      <div className="flex gap-4 border-t border-white/7 pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="size-1.5 rounded-full bg-slate-400" /> Round Robin
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-1.5 rounded-full bg-cyan-300" /> ThermalMesh
        </span>
      </div>
    </div>
  );
}

function ComparisonBar({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: number | null;
  width: number;
  tone: 'muted' | 'cyan';
}) {
  return (
    <div className="grid grid-cols-[1.7rem_1fr_5.5rem] items-center gap-2">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-white/7">
        <div
          className={`h-full min-w-0.5 rounded-full ${tone === 'cyan' ? 'bg-cyan-300' : 'bg-slate-400/70'}`}
          style={{ width: value === null ? '0%' : `${Math.max(width, 0.75)}%` }}
        />
      </div>
      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        {value === null
          ? 'N/A'
          : `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ms`}
      </span>
    </div>
  );
}

function WorkerLoadChart({
  comparison,
  single,
}: {
  comparison: ComparisonResult | null;
  single: SimulationResult | null;
}) {
  const workers = comparison?.roundRobin.workers ?? single?.workers ?? [];
  if (workers.length === 0) return null;

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {workers.map((worker, index) => {
        const other = comparison?.thermalmesh.workers[index];
        return (
          <div
            key={worker.workerId}
            className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-white">{worker.name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {worker.capacity} capacity units
              </p>
            </div>
            <div className="space-y-1.5">
              <LoadBar
                label={comparison ? 'RR' : policyLabel(single!.policy)}
                value={worker.utilization}
                maxQueue={worker.maxQueueDepth}
                tone="muted"
              />
              {other ? (
                <LoadBar
                  label="TM"
                  value={other.utilization}
                  maxQueue={other.maxQueueDepth}
                  tone="cyan"
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadBar({
  label,
  value,
  maxQueue,
  tone,
}: {
  label: string;
  value: number;
  maxQueue: number;
  tone: 'muted' | 'cyan';
}) {
  const overloaded = value >= 95 && maxQueue >= 5;
  return (
    <div className="grid grid-cols-[2rem_1fr_4rem] items-center gap-2">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-white/7">
        <div
          className={`h-full rounded-full ${overloaded ? 'bg-rose-400' : tone === 'cyan' ? 'bg-cyan-300' : 'bg-slate-400/70'}`}
          style={{ width: `${Math.max(value, 0.75)}%` }}
        />
      </div>
      <span
        className={`text-right font-mono text-xs ${overloaded ? 'text-rose-300' : 'text-muted-foreground'}`}
      >
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

function ObservationList({ state }: { state: LabState }) {
  const observations = labStore.inspectBottlenecks();
  const hasResults = Boolean(
    state.comparison || state.results.round_robin || state.results.thermalmesh,
  );
  if (!hasResults) return null;
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {observations.slice(0, 4).map((observation) => (
        <div
          key={`${observation.code}-${observation.message}`}
          className="flex gap-2 rounded-lg border border-white/7 bg-black/12 p-3"
        >
          {observation.severity === 'critical' ||
          observation.severity === 'warning' ? (
            <AlertTriangle
              className={`mt-0.5 size-4 shrink-0 ${observation.severity === 'critical' ? 'text-rose-300' : 'text-amber-300'}`}
              aria-hidden="true"
            />
          ) : (
            <Info
              className="mt-0.5 size-4 shrink-0 text-cyan-300/70"
              aria-hidden="true"
            />
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            {observation.message}
          </p>
        </div>
      ))}
    </div>
  );
}

function ActivityPanel({
  entries,
  dynamicStatus,
  baseToolsRegistered,
}: {
  entries: ActivityEntry[];
  dynamicStatus: LabState['dynamicToolStatus'];
  baseToolsRegistered: boolean;
}) {
  const dynamicAvailable = dynamicStatus === 'available';
  const dynamicLabel =
    dynamicStatus === 'available'
      ? 'Available'
      : dynamicStatus === 'registering'
        ? 'Registering'
        : dynamicStatus === 'error'
          ? 'Error'
          : 'Locked';
  return (
    <Panel className="overflow-hidden xl:sticky xl:top-5">
      <PanelHeading
        index="04"
        eyebrow="Shared session"
        title="Agent Activity"
        detail="Semantic actions only — no hidden reasoning."
      />
      <div className="border-b border-white/8 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            Registered tools
          </span>
          <span className="font-mono text-sm text-white">
            {baseToolsRegistered
              ? BASE_TOOLS.length + Number(dynamicAvailable)
              : 0}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            Winning-policy tool
          </span>
          <Badge
            variant="outline"
            className={`border-white/9 ${dynamicStatus === 'available' ? 'text-emerald-300' : dynamicStatus === 'registering' ? 'text-amber-300' : dynamicStatus === 'error' ? 'text-rose-300' : 'text-muted-foreground'}`}
          >
            {dynamicLabel}
          </Badge>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          It registers only after a valid comparison and unregisters when the
          scenario changes.
        </p>
      </div>
      <div className="max-h-[31rem] overflow-y-auto p-4 sm:p-5">
        {entries.length === 0 ? (
          <div className="py-8 text-center">
            <Bot
              className="mx-auto size-5 text-muted-foreground/60"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm text-muted-foreground">
              No actions yet.
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground/70">
              Human and WebMCP operations will appear here.
            </p>
          </div>
        ) : (
          <ol className="space-y-0" aria-live="polite">
            {entries.map((entry, index) => (
              <ActivityItem
                key={entry.id}
                entry={entry}
                last={index === entries.length - 1}
              />
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}

function ActivityItem({
  entry,
  last,
}: {
  entry: ActivityEntry;
  last: boolean;
}) {
  const agent = entry.actor === 'agent';
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(entry.timestamp));
  return (
    <li className="relative grid grid-cols-[1.75rem_1fr] gap-3 pb-5">
      {!last ? (
        <span className="absolute left-[0.86rem] top-7 h-[calc(100%-0.6rem)] w-px bg-white/8" />
      ) : null}
      <span
        className={`relative z-10 grid size-7 place-items-center rounded-full border ${agent ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-200' : 'border-white/10 bg-white/[0.04] text-muted-foreground'}`}
      >
        {agent ? (
          <Bot className="size-3.5" aria-hidden="true" />
        ) : (
          <UserRound className="size-3.5" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge
            variant="outline"
            className={`h-5 border-white/9 px-1.5 text-xs ${agent ? 'text-cyan-200' : 'text-muted-foreground'}`}
          >
            {agent ? 'Agent' : 'Human'}
          </Badge>
          <time className="font-mono text-xs text-muted-foreground/80">
            {time}
          </time>
        </div>
        <p className="mt-1.5 text-sm font-medium capitalize text-white">
          {entry.action}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {entry.detail}
        </p>
      </div>
    </li>
  );
}

function EducationSection() {
  const cards = [
    {
      icon: Network,
      title: 'Why heterogeneity is difficult',
      text: 'Round Robin treats every worker equally even when their service capacities differ, so slower workers can accumulate queues while faster workers sit underused.',
    },
    {
      icon: BrainCircuit,
      title: 'What inference-aware routing does',
      text: 'This educational strategy compares each worker’s capacity and queued finish time, then chooses the earliest predicted completion for every request.',
    },
    {
      icon: Bot,
      title: 'Why WebMCP matters',
      text: 'An agent calls cluster-level operations directly instead of guessing coordinates, button labels, or visual layout. People see the exact same state update.',
    },
  ];
  return (
    <section
      className="mt-5 grid gap-3 md:grid-cols-3"
      aria-labelledby="why-heading"
    >
      <h2 id="why-heading" className="sr-only">
        How ThermalMesh Lab works
      </h2>
      {cards.map(({ icon: Icon, title, text }) => (
        <article
          key={title}
          className="rounded-xl border border-white/8 bg-white/[0.018] p-4"
        >
          <Icon className="size-4 text-cyan-300/70" aria-hidden="true" />
          <h3 className="mt-3 text-sm font-medium text-white">{title}</h3>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{text}</p>
        </article>
      ))}
    </section>
  );
}

export default function App() {
  const state = useLabState();
  useWebMcp(labStore);

  const totalCapacity = state.workers.reduce(
    (sum, worker) => sum + worker.capacity,
    0,
  );
  const currentResult = state.comparison
    ? (state.results[state.activePolicy] ?? null)
    : state.latestResultPolicy
      ? (state.results[state.latestResultPolicy] ?? null)
      : null;
  const metricsById = useMemo(
    () =>
      new Map(
        currentResult?.workers.map((worker) => [worker.workerId, worker]) ?? [],
      ),
    [currentResult],
  );
  const hasAnyResult = Boolean(
    state.results.round_robin || state.results.thermalmesh,
  );
  const activeUtilization = currentResult?.metrics.averageUtilization;

  return (
    <main className="min-h-screen text-foreground">
      <div className="mx-auto max-w-[1640px] px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <header className="mb-4 flex flex-col gap-4 border-b border-white/9 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="logo-mark">
              <RadioTower className="size-5 text-cyan-200" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/85">
                Inference operations
              </p>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                  ThermalMesh Lab
                </h1>
                <span className="text-xs text-muted-foreground sm:text-sm">
                  Agent-Native AI Infrastructure Playground
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WebMcpBadge status={state.webMcpStatus} />
            <Badge
              variant="outline"
              className="h-6 border-white/10 px-2.5 font-mono text-muted-foreground"
            >
              SIMULATED METRICS
            </Badge>
            <Button
              type="button"
              variant="outline"
              onClick={() => labStore.loadDemoScenario()}
              className="h-10 border-white/10 bg-white/[0.03] sm:h-9"
            >
              <Zap aria-hidden="true" /> Load Demo Scenario
            </Button>
            <Button
              type="button"
              onClick={() => labStore.compare({ actor: 'human' })}
              className="h-10 bg-cyan-300 text-slate-950 hover:bg-cyan-200 sm:h-9"
            >
              <Play aria-hidden="true" /> Compare Policies
            </Button>
          </div>
        </header>

        {state.webMcpStatus === 'unavailable' ? (
          <output className="mb-4 flex gap-2 rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            WebMCP is unavailable in this browser. The manual simulator remains
            fully functional.
          </output>
        ) : null}
        {state.webMcpStatus === 'error' ? (
          <div
            role="alert"
            className="mb-4 flex gap-2 rounded-lg border border-rose-300/15 bg-rose-300/[0.045] px-3 py-2 text-xs leading-5 text-rose-200"
          >
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden="true"
            />
            WebMCP registration failed: {state.webMcpError ?? 'unknown error'}.
            Manual controls remain available.
          </div>
        ) : null}

        <section
          className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Cluster summary"
        >
          <StatCard
            icon={Cpu}
            value={String(state.workers.length)}
            label="Active workers"
          />
          <StatCard
            icon={Gauge}
            value={totalCapacity.toLocaleString()}
            label="Total capacity units"
          />
          <StatCard
            icon={Activity}
            value={
              activeUtilization === undefined
                ? '—'
                : `${activeUtilization.toFixed(1)}%`
            }
            label={
              currentResult
                ? `Average utilization · ${policyLabel(currentResult.policy)}`
                : 'Average utilization'
            }
          />
          <StatCard
            icon={Route}
            value={policyLabel(state.activePolicy)}
            label="Active routing policy"
            accent
          />
        </section>

        {state.comparison ? (
          <ComparisonPulse comparison={state.comparison} />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(310px,0.92fr)]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.8fr)]">
              <Panel className="overflow-hidden">
                <PanelHeading
                  index="01"
                  eyebrow="Cluster"
                  title="Heterogeneous workers"
                  detail="Capacity is an abstract simulation unit. Edit a value and leave the field to apply it."
                  action={
                    <div className="flex items-center gap-2">
                      {currentResult ? (
                        <Badge
                          variant="outline"
                          className="hidden border-white/9 text-muted-foreground sm:inline-flex"
                        >
                          Load: {policyLabel(currentResult.policy)}
                        </Badge>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={state.workers.length >= LIMITS.workers.max}
                        onClick={() => labStore.addWorker()}
                        className="border-white/10 bg-white/[0.025]"
                      >
                        <Plus aria-hidden="true" /> Add worker
                      </Button>
                    </div>
                  }
                />
                <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
                  {state.workers.map((worker) => (
                    <WorkerEditor
                      key={`${worker.id}:${worker.name}:${worker.capacity}`}
                      worker={worker}
                      metrics={metricsById.get(worker.id)}
                      canRemove={state.workers.length > 1}
                    />
                  ))}
                </div>
              </Panel>

              <div className="grid content-start gap-4">
                <Panel className="overflow-hidden">
                  <PanelHeading
                    index="02"
                    eyebrow="Workload"
                    title={`${state.workload.trafficPattern === 'bursty' ? 'Bursty' : 'Steady'} traffic`}
                  />
                  <WorkloadForm
                    key={JSON.stringify(state.workload)}
                    workload={state.workload}
                  />
                </Panel>
                <Panel className="overflow-hidden">
                  <PanelHeading
                    index="03"
                    eyebrow="Routing"
                    title="Run the same scenario"
                  />
                  <RoutingControls state={state} />
                </Panel>
              </div>
            </div>

            <Panel
              id="benchmark-results"
              className="scroll-mt-4 overflow-hidden"
            >
              <PanelHeading
                index="05"
                eyebrow="Benchmark results"
                title="Simulated policy comparison"
                detail="Latency is shown in simulated milliseconds; throughput is completed requests per simulated second."
                action={
                  state.comparison ? (
                    <Badge className="border border-emerald-300/15 bg-emerald-300/8 text-emerald-200">
                      Comparison valid
                    </Badge>
                  ) : currentResult ? (
                    <Badge
                      variant="outline"
                      className="border-white/9 text-muted-foreground"
                    >
                      {policyLabel(currentResult.policy)} run complete
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-white/9 text-muted-foreground"
                    >
                      Awaiting run
                    </Badge>
                  )
                }
              />
              {!hasAnyResult ? (
                <EmptyResults
                  hasStaleConfiguration={state.resultsInvalidated}
                />
              ) : (
                <div className="p-4 sm:p-5">
                  {state.comparison ? (
                    <>
                      <WinnerBanner comparison={state.comparison} />
                      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.7fr)]">
                        <ComparisonTable comparison={state.comparison} />
                        <div className="rounded-xl border border-white/8 bg-black/12 p-4">
                          <p className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Latency profile · lower is better
                          </p>
                          <LatencyBars comparison={state.comparison} />
                        </div>
                      </div>
                    </>
                  ) : currentResult ? (
                    <SingleBenchmark result={currentResult} />
                  ) : null}
                  <ObservationList state={state} />
                  <p className="mt-4 border-t border-white/7 pt-3 text-xs leading-5 text-muted-foreground">
                    ThermalMesh Lab uses a browser-based simulation. Results
                    demonstrate routing behavior and are not hardware
                    benchmarks.
                  </p>
                </div>
              )}
            </Panel>

            {currentResult ? (
              <Panel className="overflow-hidden">
                <PanelHeading
                  index="06"
                  eyebrow="Worker load"
                  title="Where requests and queues landed"
                  detail="Red indicates sustained utilization with material queueing."
                />
                <WorkerLoadChart
                  comparison={state.comparison}
                  single={currentResult}
                />
              </Panel>
            ) : null}
          </div>

          <aside className="min-w-0">
            <ActivityPanel
              entries={state.activity}
              dynamicStatus={state.dynamicToolStatus}
              baseToolsRegistered={state.baseToolsRegistered}
            />
          </aside>
        </div>

        <EducationSection />

        <footer className="mt-5 flex flex-col gap-2 border-t border-white/8 py-5 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-3xl">
            ThermalMesh is a simplified educational inference-aware routing
            simulation inspired by the same problem domain. It does not contain
            the private production ThermalMesh implementation.
          </p>
          <p className="shrink-0 font-mono text-muted-foreground/65">
            LOCAL-FIRST · NO BACKEND · FIXED SEED
          </p>
        </footer>

        <output className="sr-only" aria-live="polite" aria-atomic="true">
          {state.notice}
        </output>
      </div>
    </main>
  );
}
