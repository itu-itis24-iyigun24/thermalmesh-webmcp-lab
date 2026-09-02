import { describe, expect, it } from 'vitest';

import { LabStore } from '@/src/state/lab-store';
import { WebMcpAdapter } from '@/src/webmcp/adapter';
import type { ModelContext, WebMcpTool } from '@/src/webmcp/types';

class FakeModelContext implements ModelContext {
  readonly tools = new Map<string, WebMcpTool>();

  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): void {
    if (this.tools.has(tool.name))
      throw new Error(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener(
      'abort',
      () => {
        if (this.tools.get(tool.name) === tool) this.tools.delete(tool.name);
      },
      { once: true },
    );
  }
}

class DelayedAbortContext implements ModelContext {
  registerTool(
    _tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!options?.signal) {
        resolve();
        return;
      }
      options.signal.addEventListener(
        'abort',
        () => queueMicrotask(() => reject(new Error('aborted'))),
        { once: true },
      );
    });
  }
}

describe('shared state and invalidation', () => {
  it('invalidates stale comparison results after a configuration change', () => {
    const store = new LabStore();
    store.compare();
    const version = store.getState().configVersion;
    expect(store.getState().comparison).not.toBeNull();

    store.configureWorkload({ requestRate: 17 }, { actor: 'agent' });
    expect(store.getState().configVersion).toBe(version + 1);
    expect(store.getState().comparison).toBeNull();
    expect(store.getState().results).toEqual({});
    expect(store.getState().resultsInvalidated).toBe(true);
  });

  it('does not claim results were invalidated before any benchmark exists', () => {
    const store = new LabStore();
    store.loadDemoScenario();
    expect(store.getState().resultsInvalidated).toBe(false);
  });

  it('chooses an unused default name when adding a human worker', () => {
    const store = new LabStore({
      workers: [
        { id: 'alpha', name: 'Alpha', capacity: 100 },
        { id: 'reserved', name: 'Worker 3', capacity: 50 },
      ],
    });
    store.addWorker();
    expect(store.getState().workers.at(-1)?.name).toBe('Worker 4');
  });

  it('describes a tied comparison without claiming a winner', () => {
    const store = new LabStore({
      workers: [{ id: 'solo', name: 'Solo', capacity: 100 }],
      workload: {
        requestRate: 1,
        inputTokens: 128,
        outputTokens: 32,
        durationSeconds: 10,
        trafficPattern: 'steady',
        seed: 7,
      },
    });
    const comparison = store.compare();
    expect(comparison.winner).toBe('tie');
    expect(store.getState().notice).toMatch(/within 1%/i);
    expect(store.getState().activity[0].detail).toMatch(/resulted in a tie/i);
  });

  it('keeps state atomic when validation fails', () => {
    const store = new LabStore();
    const before = store.getState();
    expect(() => store.configureCluster([])).toThrow();
    expect(store.getState()).toBe(before);
  });

  it('keeps valid comparison results when configuration values are unchanged', () => {
    const store = new LabStore();
    store.compare();
    const before = store.getState();
    store.configureWorkload({ ...before.workload });
    store.configureCluster(before.workers.map((worker) => ({ ...worker })));
    expect(store.getState()).toBe(before);
    expect(store.getState().comparison).not.toBeNull();
  });

  it('reports the most recently run benchmark even when another policy is active', () => {
    const store = new LabStore({ activePolicy: 'thermalmesh' });
    store.runBenchmark('round_robin');
    const snapshot = store.getAgentSnapshot();
    expect(snapshot.latestBenchmark?.policy).toBe('round_robin');
    expect(
      snapshot.workers.every((worker) => worker.utilization !== null),
    ).toBe(true);
  });
});

describe('WebMCP adapter', () => {
  it('registers domain tools with correct read-only hints', () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();

    expect([...context.tools.keys()].sort()).toEqual([
      'apply_routing_policy',
      'compare_routing_policies',
      'configure_cluster',
      'configure_workload',
      'get_cluster_state',
      'inspect_bottlenecks',
      'run_benchmark',
    ]);
    const readOnly = [...context.tools.values()]
      .filter((tool) => tool.annotations?.readOnlyHint)
      .map((tool) => tool.name)
      .sort();
    expect(readOnly).toEqual(['get_cluster_state', 'inspect_bottlenecks']);
    adapter.dispose();
  });

  it('shares state with tool executors and rejects invalid inputs without mutation', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    const configure = context.tools.get('configure_cluster')!;

    await configure.execute({
      workers: [
        { name: 'Alpha', capacity: 120 },
        { name: 'Beta', capacity: 30 },
      ],
    });
    expect(store.getState().workers.map((worker) => worker.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect(store.getState().activity[0].actor).toBe('agent');

    const before = store.getState();
    expect(() => configure.execute({ workers: [] })).toThrow();
    expect(store.getState()).toBe(before);
    adapter.dispose();
  });

  it('adds the winning tool only for a valid comparison and removes all tools on dispose', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    expect(context.tools.has('apply_winning_configuration')).toBe(false);

    await context.tools.get('compare_routing_policies')!.execute({});
    expect(context.tools.has('apply_winning_configuration')).toBe(true);

    await context.tools
      .get('configure_workload')!
      .execute({ request_rate: 16 });
    expect(context.tools.has('apply_winning_configuration')).toBe(false);

    adapter.dispose();
    expect(context.tools.size).toBe(0);
  });

  it('rejects explicit null workload values without changing state', () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    const before = store.getState();

    expect(() =>
      context.tools.get('configure_workload')!.execute({ request_rate: null }),
    ).toThrow(/finite number/i);
    expect(store.getState()).toBe(before);
    adapter.dispose();
  });

  it('enforces cluster schema fields even when the host skips schema validation', () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    const before = store.getState();

    expect(() =>
      context.tools.get('configure_cluster')!.execute({
        workers: [{ id: 'injected', name: 'Worker', capacity: 100 }],
      }),
    ).toThrow(/unsupported field/i);
    expect(store.getState()).toBe(before);
    adapter.dispose();
  });

  it('does not publish an error after disposal aborts pending registrations', async () => {
    const store = new LabStore();
    const adapter = new WebMcpAdapter(store, new DelayedAbortContext());
    adapter.start();
    adapter.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().webMcpStatus).not.toBe('error');
  });

  it('completes the three-prompt agent demo through shared domain tools', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();

    await context.tools.get('configure_cluster')!.execute({
      workers: [
        { name: 'Fast A', capacity: 120 },
        { name: 'Fast B', capacity: 105 },
        { name: 'Medium', capacity: 60 },
        { name: 'Slow', capacity: 30 },
      ],
    });
    await context.tools.get('configure_workload')!.execute({
      request_rate: 21,
      input_tokens: 960,
      output_tokens: 256,
      duration_seconds: 45,
      traffic_pattern: 'bursty',
      seed: 1_337,
    });

    const compared = (await context.tools
      .get('compare_routing_policies')!
      .execute({})) as { comparison: { winner: string } };
    const inspected = (await context.tools
      .get('inspect_bottlenecks')!
      .execute({})) as { observations: unknown[] };
    expect(compared.comparison.winner).toBe('thermalmesh');
    expect(inspected.observations.length).toBeGreaterThan(0);
    expect(context.tools.has('apply_winning_configuration')).toBe(true);

    await context.tools.get('apply_winning_configuration')!.execute({});
    expect(store.getState().activePolicy).toBe('thermalmesh');
    expect(
      store
        .getState()
        .activity.filter((entry) => entry.actor === 'agent')
        .map((entry) => entry.action),
    ).toEqual(
      expect.arrayContaining([
        'configured cluster',
        'configured workload',
        'compared routing policies',
        'applied routing policy',
      ]),
    );

    await context.tools.get('configure_cluster')!.execute({
      workers: [
        { name: 'Fast A', capacity: 120 },
        { name: 'Fast B', capacity: 105 },
        { name: 'Medium', capacity: 60 },
        { name: 'Slow', capacity: 28 },
      ],
    });
    expect(store.getState().comparison).toBeNull();
    expect(context.tools.has('apply_winning_configuration')).toBe(false);
    adapter.dispose();
  });
});
