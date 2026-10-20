import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SearchProgressView } from '../../data/search-runner';

/** Progress bar of a running search: phase, percent, elapsed time and an estimate of the time left. */
@Component({
  selector: 'app-search-progress',
  template: `
    <div class="progress-head">
      <span>{{ progress().phase }}…</span>
      <strong>{{ percent(progress().fraction) }}%</strong>
    </div>
    <div class="track" role="progressbar" aria-label="Search progress" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="percent(progress().fraction)">
      <div class="fill" [style.width.%]="progress().fraction * 100"></div>
    </div>
    <p class="hint">
      {{ duration(progress().elapsedMs, 'down') }} elapsed ·
      @if (progress().remainingMs !== null) {
        about {{ duration(progress().remainingMs!) }} left
      } @else {
        estimating time left…
      }
    </p>
  `,
  styles: `
    :host {
      display: block;
      margin: 0 0 0.75rem;
    }
    .progress-head {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.3rem;
    }
    .track {
      height: 0.5rem;
      border-radius: 999px;
      background: var(--border);
      overflow: hidden;
    }
    .fill {
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
      transition: width 0.2s ease-out;
    }
    .hint {
      margin: 0.3rem 0 0;
      color: var(--muted);
      font-size: 0.78rem;
    }
  `,
  host: { class: 'progress' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchProgress {
  readonly progress = input.required<SearchProgressView>();

  protected percent(fraction: number): number {
    return Math.floor(fraction * 100);
  }

  /** Whole seconds, with minutes past one minute: "12 s", "1 min 5 s". Rounds up (time left) or down (elapsed). */
  protected duration(ms: number, round: 'up' | 'down' = 'up'): string {
    const total = round === 'up' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    return minutes ? `${minutes} min ${total % 60} s` : `${total} s`;
  }
}
