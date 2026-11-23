import { useSyncExternalStore } from 'react';
import { ownerGeneration, subscribeOwnerGeneration } from './auth-epoch';
/** Survives React batching that returns to the exact same Firebase User. */
export const useOwnerGeneration = () => useSyncExternalStore(subscribeOwnerGeneration, ownerGeneration, ownerGeneration);
