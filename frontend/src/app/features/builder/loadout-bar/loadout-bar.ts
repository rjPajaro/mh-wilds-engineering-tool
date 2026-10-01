import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ImportError } from '../../../core/loadouts/loadout';
import { LoadoutsService } from '../../../data/loadouts.service';
import { SearchSelect, SelectOption } from '../../../shared/search-select/search-select';

type Mode = 'idle' | 'save-as' | 'rename' | 'delete' | 'confirm-load' | 'share' | 'menu';

@Component({
  selector: 'app-loadout-bar',
  imports: [SearchSelect],
  templateUrl: './loadout-bar.html',
  styleUrl: './loadout-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadoutBar {
  protected readonly loadouts = inject(LoadoutsService);

  protected readonly mode = signal<Mode>('idle');
  protected readonly nameDraft = signal('');
  protected readonly pendingLoadId = signal('');
  protected readonly shareUrl = signal('');
  protected readonly notice = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly shareInput = viewChild<ElementRef<HTMLInputElement>>('shareInput');

  protected readonly unsaved = this.loadouts.unsaved;

  protected readonly options = computed<SelectOption[]>(() =>
    [...this.loadouts.loadouts()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((l) => ({ value: l.id, label: l.name, hint: `Saved ${formatDate(l.updatedAt)}` })),
  );

  protected select(id: string): void {
    if (!id || id === this.loadouts.activeId()) return;
    if (this.unsaved()) {
      this.pendingLoadId.set(id);
      this.setMode('confirm-load');
      return;
    }
    this.loadNow(id);
  }

  protected loadNow(id = this.pendingLoadId()): void {
    this.loadouts.load(id);
    this.setMode('idle');
    this.flash('ok', `Loaded "${this.loadouts.active()?.name}".`);
  }

  protected save(): void {
    this.loadouts.save();
    this.flash('ok', `Saved "${this.loadouts.active()?.name}".`);
  }

  protected startSaveAs(): void {
    this.nameDraft.set(this.loadouts.active() ? `${this.loadouts.active()!.name} (copy)` : '');
    this.setMode('save-as');
  }

  protected startRename(): void {
    this.nameDraft.set(this.loadouts.active()?.name ?? '');
    this.setMode('rename');
  }

  protected submitName(): void {
    const name = this.nameDraft().trim();
    if (!name) return;
    if (this.mode() === 'save-as') {
      this.loadouts.saveAs(name);
      this.flash('ok', `Saved as "${name}".`);
    } else {
      this.loadouts.rename(this.loadouts.activeId(), name);
      this.flash('ok', `Renamed to "${name}".`);
    }
    this.setMode('idle');
  }

  protected remove(): void {
    const name = this.loadouts.active()?.name;
    this.loadouts.remove(this.loadouts.activeId());
    this.setMode('idle');
    this.flash('ok', `Deleted "${name}". The build stays in the Builder until you change it.`);
  }

  protected async share(): Promise<void> {
    this.shareUrl.set(this.loadouts.shareUrl());
    this.setMode('share');
    try {
      await navigator.clipboard.writeText(this.shareUrl());
      this.flash('ok', 'Link copied to the clipboard.');
    } catch {
      this.flash('error', 'Could not copy automatically. Select the link and copy it.');
    }
    queueMicrotask(() => this.shareInput()?.nativeElement.select());
  }

  protected exportAll(): void {
    const blob = new Blob([this.loadouts.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mhwilds-loadouts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.setMode('idle');
    this.flash('ok', `Exported ${this.loadouts.loadouts().length} loadout(s) and your Artians.`);
  }

  protected chooseImport(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const result = this.loadouts.importJson(await file.text());
      const skipped = result.skipped ? ` ${result.skipped} invalid entr${result.skipped === 1 ? 'y was' : 'ies were'} skipped.` : '';
      this.flash('ok', `Imported ${result.loadouts} loadout(s) and ${result.artians} new Artian(s).${skipped}`);
    } catch (e) {
      this.flash('error', e instanceof ImportError ? e.message : 'Could not read that file.');
    }
    this.setMode('idle');
  }

  protected setMode(mode: Mode): void {
    this.mode.set(this.mode() === mode && mode === 'menu' ? 'idle' : mode);
    if (mode === 'save-as' || mode === 'rename') queueMicrotask(() => this.nameInput()?.nativeElement.select());
  }

  private flash(kind: 'ok' | 'error', text: string): void {
    this.notice.set({ kind, text });
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
