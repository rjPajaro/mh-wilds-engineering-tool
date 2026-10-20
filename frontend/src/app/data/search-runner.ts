import { computed, signal } from '@angular/core';
import { ArmorSearchOutput, DEFAULT_TIME_LIMIT_MS, SearchProgress } from '../core/search/armor-search';
import { CharmSearchOutput } from '../core/search/charm-search';
import type { ArmorSearchMessage, ArmorSearchRequest } from '../features/armor-search/armor-search.worker';

/** A running search's progress, for the progress bar. */
export interface SearchProgressView<K extends string = string> {
  kind: K;
  /** 0 to 1; an estimate. */
  fraction: number;
  phase: string;
  elapsedMs: number;
  /**
   * Estimated time left: elapsed time scaled by the share still to do, capped by the
   * time limit. Null until there is enough to go on.
   */
  remainingMs: number | null;
}

/** The time-left estimate waits for this much progress and time. */
const ESTIMATE_AFTER_FRACTION = 0.05;
const ESTIMATE_AFTER_MS = 1_000;
const TICK_MS = 250;

type Output = ArmorSearchOutput | CharmSearchOutput;

/**
 * Runs one search at a time in the armor search Web Worker (inline when workers are unavailable,
 * e.g. in tests) and tracks its progress. Starting a search cancels the running one.
 * Shared by the Armor Search and Charm Search tabs.
 */
export class SearchRunner<K extends ArmorSearchRequest['kind']> {
  readonly running = signal(false);
  readonly error = signal<string | null>(null);

  private worker: Worker | null = null;
  private runId = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly runInfo = signal<{ kind: K; startedAt: number; timeLimitMs: number } | null>(null);
  private readonly latest = signal<SearchProgress | null>(null);
  /** Ticks while a search runs so elapsed time and the estimate stay current between messages. */
  private readonly now = signal(Date.now());

  /** Progress of the running search; null when none runs. */
  readonly progress = computed<SearchProgressView<K> | null>(() => {
    const info = this.runInfo();
    if (!this.running() || !info) return null;
    const latest = this.latest();
    const fraction = latest?.fraction ?? 0;
    const elapsedMs = Math.max(0, this.now() - info.startedAt);
    const estimate =
      fraction >= ESTIMATE_AFTER_FRACTION && elapsedMs >= ESTIMATE_AFTER_MS ? (elapsedMs * (1 - fraction)) / fraction : null;
    return {
      kind: info.kind,
      fraction,
      phase: latest?.phase ?? 'Starting',
      elapsedMs,
      remainingMs: estimate === null ? null : Math.max(0, Math.min(estimate, info.timeLimitMs - elapsedMs)),
    };
  });

  /**
   * Starts `request`; `inline` computes the same output without a worker. `done` gets the output
   * unless another search started or this one was cancelled first.
   */
  run(request: ArmorSearchRequest & { kind: K }, inline: () => Output, done: (output: Output) => void): void {
    this.cancel();
    const id = ++this.runId;
    this.running.set(true);
    this.error.set(null);
    this.latest.set(null);
    this.now.set(Date.now());
    this.runInfo.set({ kind: request.kind, startedAt: Date.now(), timeLimitMs: request.input.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS });
    this.ticker = setInterval(() => this.now.set(Date.now()), TICK_MS);
    const finish = (output: Output | null, error?: string) => {
      if (id !== this.runId) return;
      this.stop();
      if (output) done(output);
      else this.error.set(error ?? 'The search failed.');
    };

    if (typeof Worker === 'undefined') {
      setTimeout(() => {
        try {
          finish(inline());
        } catch (e) {
          finish(null, String(e));
        }
      });
      return;
    }
    this.worker = new Worker(new URL('../features/armor-search/armor-search.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<ArmorSearchMessage>) => {
      if (data.type === 'done') finish(data.output);
      else if (id === this.runId) {
        this.latest.set(data.progress);
        this.now.set(Date.now());
      }
    };
    this.worker.onerror = (event) => finish(null, event.message);
    this.worker.postMessage(request);
  }

  cancel(): void {
    this.runId++;
    this.stop();
  }

  private stop(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    this.running.set(false);
  }
}
