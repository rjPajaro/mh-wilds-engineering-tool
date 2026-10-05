import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  createComponent,
  DestroyRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  inject,
  input,
  signal,
} from '@angular/core';
import { Skill, WeaponKind } from '../../core/models/game-data';
import { SkillStatTable, skillStatTable } from '../../core/skills/skill-stats';
import { sourceText } from '../../core/skills/skill-values';

/** What the tooltip is about: a skill, its current level (0: not active) and the weapon type for its numbers. */
export interface SkillTipInput {
  skill: Skill;
  level: number;
  weaponKind: WeaponKind | null;
}

/** The tooltip: a skill's numbers by stat and level, the current level highlighted. */
@Component({
  selector: 'app-skill-tip-panel',
  templateUrl: './skill-tip-panel.html',
  styleUrl: './skill-tip-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'tooltip', '[id]': 'panelId()' },
})
export class SkillTipPanel {
  readonly table = input.required<SkillStatTable>();
  readonly panelId = input.required<string>();
  protected readonly sourceText = sourceText;
}

let nextId = 0;
const GAP = 6;
const MARGIN = 8;

/**
 * Shows a skill's tooltip on hover and keyboard focus. The panel goes on <body> with
 * fixed positioning, so scrolling or clipped containers cannot cut it off; it sits below
 * the element, or above when there is no room.
 */
@Directive({
  selector: '[appSkillTip]',
  host: {
    tabindex: '0',
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
    '(focusin)': 'show()',
    '(focusout)': 'hide()',
    '(keydown.escape)': 'hide()',
    '[attr.aria-describedby]': 'open() ? id : null',
  },
})
export class SkillTip {
  readonly appSkillTip = input.required<SkillTipInput | null>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  protected readonly id = `skill-tip-${nextId++}`;
  private panel: ComponentRef<SkillTipPanel> | null = null;
  protected readonly open = signal(false);
  private readonly onScroll = () => this.hide();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hide());
  }

  show(): void {
    const tip = this.appSkillTip();
    if (!tip || this.panel) return;
    const panel = createComponent(SkillTipPanel, { environmentInjector: this.injector });
    panel.setInput('table', skillStatTable(tip.skill, tip.level, tip.weaponKind));
    panel.setInput('panelId', this.id);
    this.appRef.attachView(panel.hostView);
    const el = panel.location.nativeElement as HTMLElement;
    document.body.appendChild(el);
    panel.changeDetectorRef.detectChanges();
    this.panel = panel;
    this.open.set(true);
    this.place(el);
    // The panel is fixed; it would drift away from its element on scroll.
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
  }

  hide(): void {
    if (!this.panel) return;
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    this.appRef.detachView(this.panel.hostView);
    this.panel.destroy();
    this.panel = null;
    this.open.set(false);
  }

  private place(el: HTMLElement): void {
    const anchor = this.host.nativeElement.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = el;
    const below = anchor.bottom + GAP;
    const top = below + height > window.innerHeight - MARGIN && anchor.top - GAP - height >= MARGIN ? anchor.top - GAP - height : below;
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }
}
