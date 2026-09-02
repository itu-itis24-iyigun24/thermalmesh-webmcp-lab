import type { LabStore } from '@/src/state/lab-store';
import {
  createBaseToolDefinitions,
  createWinningToolDefinition,
} from '@/src/webmcp/tools';
import type { ModelContext, WebMcpTool } from '@/src/webmcp/types';

export class WebMcpAdapter {
  private baseController: AbortController | null = null;
  private dynamicController: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private dynamicKey: string | null = null;
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
      return;
    }

    const baseController = new AbortController();
    this.baseController = baseController;
    this.unsubscribe = this.store.subscribe(() => this.syncDynamicTool());
    const registrations = createBaseToolDefinitions(this.store).map((tool) =>
      this.register(tool, baseController.signal),
    );

    Promise.all(registrations)
      .then(() => {
        if (!this.disposed && !baseController.signal.aborted)
          this.store.setWebMcpStatus('enabled');
      })
      .catch((error: unknown) => {
        if (this.disposed || baseController.signal.aborted) return;
        baseController.abort();
        this.dynamicController?.abort();
        this.unsubscribe?.();
        this.unsubscribe = null;
        const message =
          error instanceof Error ? error.message : 'Unknown registration error';
        this.store.setWebMcpStatus('error', message);
      });

    this.syncDynamicTool();
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
    const nextKey = state.comparison
      ? `${state.configVersion}:${state.comparison.scenarioSignature}`
      : null;
    if (nextKey === this.dynamicKey) return;

    this.dynamicController?.abort();
    this.dynamicController = null;
    this.dynamicKey = nextKey;
    if (!nextKey) return;

    const controller = new AbortController();
    this.dynamicController = controller;
    this.register(
      createWinningToolDefinition(this.store),
      controller.signal,
    ).catch((error: unknown) => {
      if (this.disposed || controller.signal.aborted) return;
      const message =
        error instanceof Error
          ? error.message
          : 'Dynamic tool registration failed';
      this.store.setWebMcpStatus('error', message);
    });
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.dynamicController?.abort();
    this.baseController?.abort();
    this.dynamicController = null;
    this.baseController = null;
    this.dynamicKey = null;
  }
}
