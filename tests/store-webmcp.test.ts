import { describe, expect, it } from 'vitest';

import { LabStore } from '@/src/state/lab-store';
import { WebMcpAdapter } from '@/src/webmcp/adapter';
import type { ModelContext, WebMcpTool } from '@/src/webmcp/types';

class FakeModelContext implements ModelContext {
  readonly tools = new Map<string, WebMcpTool>();
  readonly registrationCounts = new Map<string, number>();

  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    if (this.tools.has(tool.name))
      throw new Error(`Duplicate tool: ${tool.name}`);
    this.registrationCounts.set(
      tool.name,
      (this.registrationCounts.get(tool.name) ?? 0) + 1,
    );
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener(
      'abort',
      () => {
        if (this.tools.get(tool.name) === tool) this.tools.delete(tool.name);
      },
      { once: true },
    );
    return Promise.resolve();
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

class PartiallyRejectingContext extends FakeModelContext {
  override registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    const registration = super.registerTool(tool, options);
    return tool.name === 'run_benchmark'
      ? Promise.reject(new Error('registration rejected'))
      : registration;
  }
}

class DeferredModelContext extends FakeModelContext {
  private pending: Array<() => void> = [];

  override registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    void super.registerTool(tool, options);
    return new Promise((resolve, reject) => {
      const finish = () =>
        options?.signal?.aborted ? reject(new Error('aborted')) : resolve();
      this.pending.push(finish);
    });
  }

  resolvePending(): void {
    const pending = this.pending;
    this.pending = [];
    pending.forEach((resolve) => resolve());
  }
}

class RejectDynamicContext extends FakeModelContext {
  override registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    const registration = super.registerTool(tool, options);
    return tool.name === 'apply_winning_configuration'
      ? Promise.reject(new Error('dynamic registration rejected'))
      : registration;
  }
}

const executionOptions = () => ({ signal: new AbortController().signal });

function invoke(tool: WebMcpTool, input: unknown): Promise<unknown> {
  return tool.execute(input, executionOptions());
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
    expect(store.getState().notice).toMatch(/less than 1% apart/i);
    expect(store.getState().activity[0].detail).toMatch(/less than 1% apart/i);
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
  it('falls back cleanly when document.modelContext is unavailable', () => {
    const store = new LabStore();
    const adapter = new WebMcpAdapter(store, undefined);
    adapter.start();
    expect(store.getState().webMcpStatus).toBe('unavailable');
    adapter.dispose();
  });

  it('reports registration failures without crashing or leaving active tools', async () => {
    const store = new LabStore();
    const context = new PartiallyRejectingContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();
    expect(store.getState().webMcpStatus).toBe('error');
    expect(store.getState().webMcpError).toMatch(/registration rejected/i);
    expect(store.getState().baseToolsRegistered).toBe(false);
    expect(store.getState().dynamicToolStatus).toBe('unavailable');
    expect(context.tools.size).toBe(0);
    adapter.dispose();
  });

  it('waits for all base registrations before registering the dynamic tool', async () => {
    const store = new LabStore();
    const context = new DeferredModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    store.compare();
    expect(context.tools.has('apply_winning_configuration')).toBe(false);
    expect(store.getState().dynamicToolStatus).toBe('unavailable');

    context.resolvePending();
    await adapter.whenReady();
    expect(context.tools.has('apply_winning_configuration')).toBe(true);
    expect(store.getState().dynamicToolStatus).toBe('registering');
    context.resolvePending();
    await adapter.whenDynamicReady();
    expect(store.getState().dynamicToolStatus).toBe('available');
    adapter.dispose();
  });

  it('keeps base readiness truthful when dynamic registration fails and retries on a new comparison', async () => {
    const store = new LabStore();
    const context = new RejectDynamicContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();
    store.compare();
    await adapter.whenDynamicReady();

    expect(store.getState().baseToolsRegistered).toBe(true);
    expect(store.getState().dynamicToolStatus).toBe('error');
    expect(store.getState().webMcpStatus).toBe('error');
    expect(context.tools.size).toBe(7);
    expect(context.registrationCounts.get('apply_winning_configuration')).toBe(
      1,
    );

    store.compare();
    await adapter.whenDynamicReady();
    expect(context.registrationCounts.get('apply_winning_configuration')).toBe(
      2,
    );
    expect(context.tools.size).toBe(7);
    adapter.dispose();
  });

  it('registers exact domain tools, schemas, and annotations', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    adapter.start();
    await adapter.whenReady();

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
    expect(
      context.tools.get('get_cluster_state')?.annotations?.untrustedContentHint,
    ).toBe(true);
    expect(
      context.tools.get('apply_routing_policy')?.annotations
        ?.untrustedContentHint,
    ).toBe(false);
    expect(
      [...context.tools.values()].every((tool) => tool.description.length > 0),
    ).toBe(true);
    expect(
      [...context.registrationCounts.values()].every((count) => count === 1),
    ).toBe(true);
    expect(context.tools.get('configure_cluster')?.inputSchema).toMatchObject({
      type: 'object',
      required: ['workers'],
      additionalProperties: false,
      properties: {
        workers: {
          minItems: 1,
          maxItems: 12,
          items: {
            required: ['name', 'capacity'],
            additionalProperties: false,
            properties: {
              name: { minLength: 1, maxLength: 40 },
              capacity: { minimum: 10, maximum: 200 },
            },
          },
        },
      },
    });
    expect(context.tools.get('configure_workload')?.inputSchema).toMatchObject({
      type: 'object',
      minProperties: 1,
      additionalProperties: false,
      properties: {
        request_rate: { minimum: 1, maximum: 80 },
        input_tokens: { minimum: 32, maximum: 32_000 },
        output_tokens: { minimum: 16, maximum: 4_096 },
        duration_seconds: { minimum: 5, maximum: 180 },
        traffic_pattern: { enum: ['steady', 'bursty'] },
        seed: { minimum: 1, maximum: 2_147_483_646 },
      },
    });
    expect(context.tools.get('run_benchmark')?.inputSchema).toMatchObject({
      required: ['policy'],
      additionalProperties: false,
      properties: {
        policy: { enum: ['round_robin', 'thermalmesh'] },
      },
    });
    adapter.dispose();
  });

  it('shares state with tool executors and rejects invalid inputs without mutation', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();
    const configure = context.tools.get('configure_cluster')!;

    await invoke(configure, {
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
    await expect(invoke(configure, { workers: [] })).rejects.toThrow();
    expect(store.getState()).toBe(before);
    adapter.dispose();
  });

  it('adds the winning tool only for a valid comparison and removes all tools on dispose', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();
    expect(context.tools.has('apply_winning_configuration')).toBe(false);

    await invoke(context.tools.get('compare_routing_policies')!, {});
    await adapter.whenDynamicReady();
    expect(context.tools.has('apply_winning_configuration')).toBe(true);
    const discoveredWinningTool = context.tools.get(
      'apply_winning_configuration',
    )!;

    await invoke(context.tools.get('compare_routing_policies')!, {});
    expect(
      [...context.tools.keys()].filter(
        (name) => name === 'apply_winning_configuration',
      ),
    ).toHaveLength(1);
    expect(context.registrationCounts.get('apply_winning_configuration')).toBe(
      1,
    );

    await invoke(context.tools.get('configure_workload')!, {
      request_rate: 16,
    });
    expect(context.tools.has('apply_winning_configuration')).toBe(false);
    await expect(invoke(discoveredWinningTool, {})).rejects.toThrow(
      /invalidated/i,
    );

    adapter.dispose();
    expect(context.tools.size).toBe(0);
  });

  it('rejects explicit null workload values without changing state', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();
    const before = store.getState();

    await expect(
      invoke(context.tools.get('configure_workload')!, {
        request_rate: null,
      }),
    ).rejects.toThrow(/finite number/i);
    expect(store.getState()).toBe(before);
    adapter.dispose();
  });

  it('enforces cluster schema fields even when the host skips schema validation', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();
    const before = store.getState();

    await expect(
      invoke(context.tools.get('configure_cluster')!, {
        workers: [{ id: 'injected', name: 'Worker', capacity: 100 }],
      }),
    ).rejects.toThrow(/unsupported field/i);
    expect(store.getState()).toBe(before);
    adapter.dispose();
  });

  it('does not publish an error after disposal aborts pending registrations', async () => {
    const store = new LabStore();
    const adapter = new WebMcpAdapter(store, new DelayedAbortContext());
    adapter.start();
    adapter.dispose();
    await adapter.whenReady();
    expect(store.getState().webMcpStatus).not.toBe('error');
  });

  it('cleans up before a StrictMode-style remount to prevent duplicates', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const first = new WebMcpAdapter(store, context);
    first.start();
    first.dispose();
    const second = new WebMcpAdapter(store, context);
    second.start();
    await second.whenReady();
    expect(context.tools.size).toBe(7);
    second.dispose();
    expect(context.tools.size).toBe(0);
  });

  it('keeps one owner when two adapters initialize the same context concurrently', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const first = new WebMcpAdapter(store, context);
    const second = new WebMcpAdapter(store, context);
    first.start();
    second.start();
    await second.whenReady();
    expect(context.tools.size).toBe(7);
    expect(store.getState().baseToolsRegistered).toBe(true);
    second.dispose();
    expect(context.tools.size).toBe(0);
  });

  it('keeps the active policy when the dynamic comparison result is a tie', async () => {
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
      activePolicy: 'round_robin',
    });
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();
    store.compare();
    await adapter.whenDynamicReady();
    const result = (await invoke(
      context.tools.get('apply_winning_configuration')!,
      {},
    )) as { comparison_winner: string; applied_policy: string };
    expect(result.comparison_winner).toBe('tie');
    expect(result.applied_policy).toBe('round_robin');
    expect(store.getState().activePolicy).toBe('round_robin');
    adapter.dispose();
  });

  it('rejects an already-aborted execution without mutating state', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();
    const before = store.getState();
    const controller = new AbortController();
    controller.abort();
    await expect(
      context.tools
        .get('configure_workload')!
        .execute({ request_rate: 12 }, { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/i);
    expect(store.getState()).toBe(before);
    adapter.dispose();
  });

  it('supports the current Site tools host calling execute with input only', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();
    const result = (await context.tools
      .get('get_cluster_state')!
      .execute({})) as { ok: boolean };
    expect(result.ok).toBe(true);
    adapter.dispose();
  });

  it('completes the three-prompt agent demo through shared domain tools', async () => {
    const store = new LabStore();
    const context = new FakeModelContext();
    const adapter = new WebMcpAdapter(store, context);
    adapter.start();
    await adapter.whenReady();

    const outputs: unknown[] = [];
    const originalStateTool = context.tools.get('get_cluster_state')!;
    outputs.push(await invoke(originalStateTool, {}));

    outputs.push(
      await invoke(context.tools.get('configure_cluster')!, {
        workers: [
          { name: 'Fast A', capacity: 120 },
          { name: 'Fast B', capacity: 105 },
          { name: 'Medium', capacity: 60 },
          { name: 'Slow', capacity: 30 },
        ],
      }),
    );
    outputs.push(
      await invoke(context.tools.get('configure_workload')!, {
        request_rate: 21,
        input_tokens: 960,
        output_tokens: 256,
        duration_seconds: 45,
        traffic_pattern: 'bursty',
        seed: 1_337,
      }),
    );
    outputs.push(
      await invoke(context.tools.get('run_benchmark')!, {
        policy: 'round_robin',
      }),
    );
    outputs.push(
      await invoke(context.tools.get('apply_routing_policy')!, {
        policy: 'round_robin',
      }),
    );

    const compared = (await invoke(
      context.tools.get('compare_routing_policies')!,
      {},
    )) as { comparison: { winner: string } };
    await adapter.whenDynamicReady();
    const inspected = (await invoke(
      context.tools.get('inspect_bottlenecks')!,
      {},
    )) as { observations: unknown[] };
    expect(compared.comparison.winner).toBe('thermalmesh');
    expect(inspected.observations.length).toBeGreaterThan(0);
    expect(context.tools.has('apply_winning_configuration')).toBe(true);
    expect(store.getAgentSnapshot().workerMetricsPolicy).toBe('round_robin');
    expect(store.getAgentSnapshot().latestBenchmark?.policy).toBe(
      'thermalmesh',
    );
    outputs.push(compared, inspected);

    outputs.push(
      await invoke(context.tools.get('apply_winning_configuration')!, {}),
    );
    expect(() => JSON.stringify(outputs)).not.toThrow();
    expect(store.getState().activePolicy).toBe('thermalmesh');
    const latestState = (await invoke(originalStateTool, {})) as {
      activePolicy: string;
      comparisonValid: boolean;
    };
    expect(latestState.activePolicy).toBe('thermalmesh');
    expect(latestState.comparisonValid).toBe(true);
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

    await invoke(context.tools.get('configure_cluster')!, {
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
