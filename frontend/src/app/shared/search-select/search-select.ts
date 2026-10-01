import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary text shown under the label; also searchable. */
  hint?: string;
  /** Extra searchable text that is not displayed (e.g. skill names). */
  keywords?: string;
}

interface IndexedOption extends SelectOption {
  labelText: string;
  searchText: string;
}

let nextId = 0;

/**
 * Dropdown with a search box. Every whitespace-separated term must appear in the
 * option's label, hint or keywords. Options whose label matches every term are
 * listed before options matched through hint/keywords only.
 */
@Component({
  selector: 'app-search-select',
  templateUrl: './search-select.html',
  styleUrl: './search-select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(focusout)': 'onFocusOut($event)',
  },
})
export class SearchSelect {
  readonly options = input.required<readonly SelectOption[]>();
  readonly value = model<string>('');
  readonly placeholder = input('—');
  readonly inputId = input<string>(`search-select-${nextId++}`);
  readonly ariaLabel = input<string | undefined>(undefined);
  /** Show a clear button when a value is selected. */
  readonly clearable = input(true);

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);

  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly listEl = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly listId = computed(() => `${this.inputId()}-list`);

  private readonly indexed = computed<IndexedOption[]>(() =>
    this.options().map((o) => ({
      ...o,
      labelText: normalize(o.label),
      searchText: normalize(`${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`),
    })),
  );

  protected readonly selected = computed(() => this.options().find((o) => o.value === this.value()));

  protected readonly filtered = computed<IndexedOption[]>(() => {
    const terms = normalize(this.query()).split(' ').filter(Boolean);
    const all = this.indexed();
    if (!terms.length) return all;
    const labelHits: IndexedOption[] = [];
    const otherHits: IndexedOption[] = [];
    for (const o of all) {
      if (!terms.every((t) => o.searchText.includes(t))) continue;
      (terms.every((t) => o.labelText.includes(t)) ? labelHits : otherHits).push(o);
    }
    return [...labelHits, ...otherHits];
  });

  /** Text in the box: the query while searching, otherwise the selected label. */
  protected readonly displayText = computed(() => (this.open() ? this.query() : (this.selected()?.label ?? '')));

  constructor() {
    // Keep the highlighted option visible after keyboard moves and re-filtering.
    afterRenderEffect(() => {
      if (!this.open()) return;
      const id = this.optionId(this.activeIndex());
      this.listEl()?.nativeElement.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  protected optionId(i: number): string {
    return `${this.inputId()}-opt-${i}`;
  }

  protected openList(): void {
    if (this.open()) return;
    this.query.set('');
    const selectedIndex = this.filtered().findIndex((o) => o.value === this.value());
    this.activeIndex.set(Math.max(0, selectedIndex));
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
    this.query.set('');
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
    } else {
      this.inputEl().nativeElement.focus();
      this.openList();
    }
  }

  protected onInput(text: string): void {
    this.query.set(text);
    this.activeIndex.set(0);
    this.open.set(true);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.filtered().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) return this.openList();
        this.activeIndex.set(count ? (this.activeIndex() + 1) % count : 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!this.open()) return this.openList();
        this.activeIndex.set(count ? (this.activeIndex() - 1 + count) % count : 0);
        break;
      case 'Home':
      case 'End':
        if (!this.open()) return;
        event.preventDefault();
        this.activeIndex.set(event.key === 'Home' ? 0 : Math.max(0, count - 1));
        break;
      case 'Enter': {
        if (!this.open()) return this.openList();
        event.preventDefault();
        const option = this.filtered()[this.activeIndex()];
        if (option) this.choose(option.value);
        break;
      }
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          this.close();
        }
        break;
    }
  }

  protected choose(value: string): void {
    this.value.set(value);
    this.close();
  }

  protected clear(): void {
    this.value.set('');
    this.close();
    this.inputEl().nativeElement.focus();
  }

  protected onFocusOut(event: FocusEvent): void {
    const host = (event.currentTarget as HTMLElement | null) ?? null;
    if (!host?.contains(event.relatedTarget as Node | null)) this.close();
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
