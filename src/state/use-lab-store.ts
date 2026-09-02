'use client';

import { useSyncExternalStore } from 'react';

import { labStore } from '@/src/state/lab-store';

export function useLabState() {
  return useSyncExternalStore(
    labStore.subscribe,
    labStore.getState,
    labStore.getState,
  );
}
