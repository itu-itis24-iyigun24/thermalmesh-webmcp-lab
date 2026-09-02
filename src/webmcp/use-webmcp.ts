'use client';

import { useEffect } from 'react';

import type { LabStore } from '@/src/state/lab-store';
import { WebMcpAdapter } from '@/src/webmcp/adapter';

export function useWebMcp(store: LabStore): void {
  useEffect(() => {
    const adapter = new WebMcpAdapter(store);
    adapter.start();
    return () => adapter.dispose();
  }, [store]);
}
