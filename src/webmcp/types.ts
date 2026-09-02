export interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  // The draft supplies options; current Site tools hosts may still call with input only.
  execute(input: unknown, options?: ToolExecuteOptions): Promise<unknown>;
}

export interface ToolExecuteOptions {
  signal: AbortSignal;
}

export interface ModelContext {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): void | Promise<void>;
}

declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }
}
