import type { LabStore } from '@/src/state/lab-store';
import {
  createBaseToolDefinitions,
  createWinningToolDefinition,
} from '@/src/webmcp/tools';
import type { ModelContext, WebMcpTool } from '@/src/webmcp/types';

const contextOwners = new WeakMap<ModelContext, WebMcpAdapter>();

export class WebMcpAdapter {
  private baseController: AbortController | null = null;
  private dynamicController: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private dynamicScenarioKey: string | null = null;
  private dynamicAttemptVersion = -1;
  private readiness: Promise<void> = Promise.resolve();
  private dynamicReadiness: Promise<void> = Promise.resolve();
  private started = false;
  private disposed = false;

  constructor(
    private readonly store: LabStore,
    private readonly context: ModelContext | undefined = typeof document ===
    'undefined'
      ? undefined
      : document.modelContext,
  ) {}

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    if (!this.context || typeof this.context.registerTool !== 'function') {
      this.store.setWebMcpStatus('unavailable');
      this.store.setBaseToolsRegistered(false);
      this.store.setDynamicToolStatus('unavailable');
      return;
    }

    const previousOwner = contextOwners.get(this.context);
    if (previousOwner && previousOwner !== this) previousOwner.dispose();
    contextOwners.set(this.context, this);

    this.store.setWebMcpStatus('checking');
    this.store.setBaseToolsRegistered(false);
    this.store.setDynamicToolStatus('unavailable');

    const baseController = new AbortController();
    this.baseController = baseController;
    this.unsubscribe = this.store.subscribe(this.syncDynamicTool);
    const registrations = createBaseToolDefinitions(this.store).map((tool) =>
      this.register(tool, baseController.signal),
    );

    this.readiness = Promise.all(registrations)
      .then(() => {
        if (this.disposed || baseController.signal.aborted) return;
        this.store.setBaseToolsRegistered(true);
        if (this.store.getState().webMcpStatus !== 'error') {
          this.store.setWebMcpStatus('enabled');
        }
        this.syncDynamicTool();
      })
      .catch((error: unknown) => {
        if (this.disposed || baseController.signal.aborted) return;
        baseController.abort();
        this.dynamicController?.abort();
        this.dynamicController = null;
        this.dynamicScenarioKey = null;
        this.dynamicAttemptVersion = -1;
        this.store.setBaseToolsRegistered(false);
        this.store.setDynamicToolStatus('unavailable');
        this.unsubscribe?.();
        this.unsubscribe = null;
        const message =
          error instanceof Error ? error.message : 'Unknown registration error';
        this.store.setWebMcpStatus('error', message);
      });
  }

  private register(tool: WebMcpTool, signal: AbortSignal): Promise<void> {
    try {
      return Promise.resolve(this.context!.registerTool(tool, { signal }));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private syncDynamicTool = (): void => {
    if (!this.context || this.disposed) return;
    const state = this.store.getState();

    if (!state.baseToolsRegistered) {
      this.dynamicController?.abort();
      this.dynamicController = null;
      this.dynamicScenarioKey = null;
      this.dynamicAttemptVersion = -1;
      this.store.setDynamicToolStatus('unavailable');
      return;
    }

    const nextScenarioKey = state.comparison
      ? `${state.configVersion}:${state.comparison.scenarioSignature}`
      : null;
    if (!nextScenarioKey) {
      this.dynamicController?.abort();
      this.dynamicController = null;
      this.dynamicScenarioKey = null;
      this.dynamicAttemptVersion = -1;
      this.dynamicReadiness = Promise.resolve();
      this.store.setDynamicToolStatus('unavailable');
      if (this.store.getState().webMcpStatus === 'error') {
        this.store.setWebMcpStatus('enabled');
      }
      return;
    }

    if (nextScenarioKey === this.dynamicScenarioKey) {
      if (
        state.dynamicToolStatus === 'available' ||
        state.dynamicToolStatus === 'registering' ||
        (state.dynamicToolStatus === 'error' &&
          this.dynamicAttemptVersion === state.comparisonVersion)
      ) {
        return;
      }
    }

    this.dynamicController?.abort();
    const controller = new AbortController();
    this.dynamicController = controller;
    this.dynamicScenarioKey = nextScenarioKey;
    this.dynamicAttemptVersion = state.comparisonVersion;
    this.store.setDynamicToolStatus('registering');
    if (this.store.getState().webMcpStatus === 'error') {
      this.store.setWebMcpStatus('enabled');
    }

    this.dynamicReadiness = this.register(
      createWinningToolDefinition(this.store),
      controller.signal,
    )
      .then(() => {
        if (
          !this.disposed &&
          !controller.signal.aborted &&
          this.dynamicController === controller
        ) {
          this.store.setDynamicToolStatus('available');
        }
      })
      .catch((error: unknown) => {
        if (
          this.disposed ||
          controller.signal.aborted ||
          this.dynamicController !== controller
        ) {
          return;
        }
        controller.abort();
        this.dynamicController = null;
        this.store.setDynamicToolStatus('error');
        const message =
          error instanceof Error
            ? error.message
            : 'Dynamic tool registration failed';
        this.store.setWebMcpStatus('error', message);
      });
  };

  whenReady(): Promise<void> {
    return this.readiness;
  }

  whenDynamicReady(): Promise<void> {
    return this.dynamicReadiness;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.context && contextOwners.get(this.context) === this) {
      contextOwners.delete(this.context);
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.dynamicController?.abort();
    this.baseController?.abort();
    this.dynamicController = null;
    this.baseController = null;
    this.dynamicScenarioKey = null;
    this.dynamicAttemptVersion = -1;
    this.store.setBaseToolsRegistered(false);
    this.store.setDynamicToolStatus('unavailable');
  }
}
