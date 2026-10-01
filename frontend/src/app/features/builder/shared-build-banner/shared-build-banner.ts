import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { infusionLabel } from '../../../core/artian/artian';
import { LoadoutContent } from '../../../core/loadouts/loadout';
import { ShareCodeError } from '../../../core/loadouts/share-code';
import { GameDataService } from '../../../data/game-data.service';
import { LoadoutsService, SHARE_PARAM } from '../../../data/loadouts.service';
import { weaponKindLabel } from '../../../shared/labels';

/** Shown when the Builder is opened from a share link (#/builder?b=<code>). */
@Component({
  selector: 'app-shared-build-banner',
  templateUrl: './shared-build-banner.html',
  styleUrl: './shared-build-banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SharedBuildBanner {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(GameDataService);
  private readonly loadouts = inject(LoadoutsService);

  protected readonly unsaved = this.loadouts.unsaved;

  private readonly code = toSignal(this.route.queryParamMap.pipe(map((p) => p.get(SHARE_PARAM))), { initialValue: null });

  protected readonly shared = computed<{ content: LoadoutContent } | { error: string } | null>(() => {
    const code = this.code();
    if (!code) return null;
    try {
      return { content: this.loadouts.decode(code) };
    } catch (e) {
      return { error: e instanceof ShareCodeError ? e.message : 'This share link is not valid.' };
    }
  });

  protected readonly content = computed(() => {
    const s = this.shared();
    return s && 'content' in s ? s.content : null;
  });
  protected readonly error = computed(() => {
    const s = this.shared();
    return s && 'error' in s ? s.error : null;
  });

  /** "Kyrie Verd · Dragon Attack Infusion" or the weapon's name. */
  protected readonly summary = computed(() => {
    const c = this.content();
    if (!c) return '';
    const parts = [weaponKindLabel(c.weaponKind)];
    if (c.artian) {
      parts.push(`${c.artian.name || (c.artian.tier === 'gogma' ? 'Gogma Artian' : 'Artian')} (${infusionLabel(c.artian)})`);
    } else if (c.build.weaponId) {
      const weapon = this.data.index()?.weapons.get(c.build.weaponId);
      if (weapon) parts.push(weapon.name);
    }
    const pieces = Object.values(c.build.armor).filter(Boolean).length;
    if (pieces) parts.push(`${pieces} armor piece${pieces === 1 ? '' : 's'}`);
    return parts.join(' · ');
  });

  protected load(): void {
    const c = this.content();
    if (c) this.loadouts.loadShared(c);
    this.clear();
  }

  protected save(): void {
    const c = this.content();
    if (c) this.loadouts.saveShared(c);
    this.clear();
  }

  protected clear(): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { [SHARE_PARAM]: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
