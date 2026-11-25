import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/** Drafts contain setup only, never credentials or hidden answers. Pending starts remain authoritative. */
export function useSetupDraft<T>(key: string, initial: T, validate?: (value: unknown) => boolean, restored?: unknown): [T, Dispatch<SetStateAction<T>>] {
  const fallback = useRef(initial);
  const storageKey = `almaidan:setup:${key}`;
  const valid = (value: unknown): value is T => {
    const shape = (v: unknown, sample: unknown): boolean => {
      if (sample === null) return v === null || typeof v === 'number';
      if (Array.isArray(sample)) return Array.isArray(v) && v.length <= 100 && v.every(item => !sample.length || shape(item, sample[0]));
      if (typeof sample === 'object') return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(sample as object).every(k => shape((v as Record<string, unknown>)[k], (sample as Record<string, unknown>)[k]));
      return typeof v === typeof sample;
    };
    return shape(value, fallback.current) && (!validate || validate(value));
  };
  const save = (value: T) => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Editing remains available when storage is unavailable. */ }
  };
  const read = () => {
    if (valid(restored)) return restored;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw || raw.length > 32768) return fallback.current;
      const value = JSON.parse(raw);
      return valid(value) ? value : fallback.current;
    } catch { return fallback.current; }
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    setValue(read());
    if (valid(restored)) save(restored);
  }, [key]);
  const update: Dispatch<SetStateAction<T>> = next => setValue(previous => {
    const result = typeof next === 'function' ? (next as (v:T)=>T)(previous) : next;
    save(result);
    return result;
  });
  return [value, update];
}
