import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SearchSelect, SelectOption } from './search-select';

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Attack Jewel [3]', hint: 'Attack Boost 1' },
  { value: 'b', label: 'Expert Jewel [3]', hint: 'Weakness Exploit 1' },
  { value: 'c', label: 'Gore Helm α', keywords: 'Gore α Evade Window' },
  { value: 'd', label: 'Evasion Jewel [1]', hint: 'Evade Window 1' },
];

describe('SearchSelect', () => {
  let fixture: ComponentFixture<SearchSelect>;
  let input: HTMLInputElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(SearchSelect);
    fixture.componentRef.setInput('options', OPTIONS);
    await fixture.whenStable();
    input = fixture.nativeElement.querySelector('input');
  });

  const labels = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('li[role="option"] .label')].map((e) => e.textContent);

  async function type(text: string) {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  async function key(k: string) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    await fixture.whenStable();
  }

  it('opens on click and lists every option', async () => {
    input.click();
    await fixture.whenStable();
    expect(labels()).toHaveLength(4);
  });

  it('matches every term case-insensitively', async () => {
    await type('JEWEL 3');
    expect(labels()).toEqual(['Attack Jewel [3]', 'Expert Jewel [3]']);
  });

  it('matches hints and keywords, listing label matches first', async () => {
    await type('evade');
    expect(labels()).toEqual(['Gore Helm α', 'Evasion Jewel [1]']); // both via hint/keywords
    await type('evasion');
    expect(labels()).toEqual(['Evasion Jewel [1]']);
    await type('weakness');
    expect(labels()).toEqual(['Expert Jewel [3]']);
  });

  it('shows an empty state', async () => {
    await type('zzz');
    expect(fixture.nativeElement.textContent).toContain('No matches');
  });

  it('selects with arrow keys and Enter, then shows the label', async () => {
    await type('jewel');
    await key('ArrowDown');
    await key('Enter');
    expect(fixture.componentInstance.value()).toBe('b');
    expect(labels()).toEqual([]); // closed
    expect(input.value).toBe('Expert Jewel [3]');
  });

  it('Escape closes without changing the value', async () => {
    fixture.componentInstance.value.set('a');
    await type('gore');
    await key('Escape');
    expect(fixture.componentInstance.value()).toBe('a');
    expect(input.value).toBe('Attack Jewel [3]');
  });

  it('clears the selection', async () => {
    fixture.componentInstance.value.set('c');
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('button[aria-label="Clear selection"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('');
  });

  it('shows option icons in the list and the field, and the empty icon with no selection', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const fieldIcon = () => el.querySelector<HTMLImageElement>('img.field-icon')?.getAttribute('src') ?? null;
    fixture.componentRef.setInput('options', OPTIONS.map((o) => ({ ...o, icon: o.value === 'c' ? undefined : `${o.value}.png` })));
    fixture.componentRef.setInput('emptyIcon', 'empty.png');
    await fixture.whenStable();
    expect(fieldIcon()).toBe('empty.png');

    input.click();
    await fixture.whenStable();
    expect([...el.querySelectorAll('li[role="option"] img')].map((i) => i.getAttribute('src'))).toEqual(['a.png', 'b.png', 'd.png']);

    fixture.componentInstance.value.set('b');
    await fixture.whenStable();
    expect(fieldIcon()).toBe('b.png');
    fixture.componentInstance.value.set('c'); // selected option without an icon
    await fixture.whenStable();
    expect(fieldIcon()).toBeNull();
  });
});
