import { effect, signal, WritableSignal } from '@angular/core';

/** All app keys share this prefix so they are easy to find and clear. */
export const STORAGE_PREFIX = 'mhwet.';

/**
 * A signal that is restored from localStorage on creation and written back on
 * every change. Must be created in an injection context (e.g. a field initializer).
 * Stored values failing `isValid` are ignored, so a stale or corrupt entry
 * falls back to `initial` instead of breaking the page.
 */
export function persistedSignal<T>(key: string, initial: T, isValid: (value: unknown) => boolean = () => true): WritableSignal<T> {
  const fullKey = STORAGE_PREFIX + key;
  const state = signal<T>(read(fullKey, initial, isValid));
  effect(() => write(fullKey, state()));
  return state;
}

function read<T>(key: string, initial: T, isValid: (value: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return initial;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? (value as T) : initial;
  } catch {
    return initial;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): keep working in memory.
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isString = (v: unknown): v is string => typeof v === 'string';
export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
