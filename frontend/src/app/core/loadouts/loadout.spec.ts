import { newArtianConfig } from '../artian/artian';
import { emptySavedBuild } from '../build/build';
import { createExport, ImportError, isLoadout, Loadout, LoadoutContent, parseExport, sameArtian, sameContent } from './loadout';

const base: LoadoutContent = {
  name: 'A',
  weaponKind: 'hammer',
  build: { ...emptySavedBuild(), weaponId: 'hammer:5', armor: { head: '1:head' } },
  artian: null,
  setup: { monsterId: '7', partIndex: '1', wounded: false, toggles: { Agitator: true } },
};
const loadout = (overrides: Partial<Loadout> = {}): Loadout => ({ ...base, id: 'l1', createdAt: 't', updatedAt: 't', ...overrides });

describe('loadout helpers', () => {
  it('compares content ignoring the name and empty entries', () => {
    expect(sameContent(base, { ...base, name: 'B' })).toBe(true);
    expect(sameContent(base, { ...base, build: { ...base.build, decorations: { head: [] } } })).toBe(true);
    expect(sameContent(base, { ...base, build: { ...base.build, armor: { head: '2:head' } } })).toBe(false);
    expect(sameContent(base, loadout({ name: 'Saved', id: 'x', updatedAt: 'later' }))).toBe(true);
  });

  it('compares Artians ignoring the id', () => {
    const a = newArtianConfig('lance', 'gogma', 'x');
    expect(sameArtian(a, { ...a, id: 'custom:y' })).toBe(true);
    expect(sameArtian(a, { ...a, device: 'element' })).toBe(false);
  });

  it('round-trips an export file', () => {
    const artian = newArtianConfig('lance', 'artian', 'x');
    const talisman = { id: 'custom:t', name: '', rarity: 8, skills: [{ skillId: 1, level: 2 }], slots: [{ level: 1, accepts: 'weapon' as const }] };
    const file = createExport([loadout()], [artian], [talisman], new Date('2026-10-02T00:00:00Z'));
    expect(parseExport(JSON.stringify(file))).toEqual({ loadouts: [loadout()], artians: [artian], talismans: [talisman], skipped: 0 });
  });

  it('skips invalid entries and rejects other files', () => {
    const file = { ...createExport([loadout()], []), loadouts: [loadout(), { name: 3 }] };
    expect(parseExport(JSON.stringify(file)).skipped).toBe(1);
    expect(() => parseExport('{')).toThrow(ImportError);
    expect(() => parseExport('{"format":"other"}')).toThrow(/not a loadout export/);
    expect(() => parseExport(JSON.stringify({ ...file, version: 99 }))).toThrow(/newer version/);
  });

  it('validates stored loadouts', () => {
    expect(isLoadout(loadout())).toBe(true);
    expect(isLoadout({ ...loadout(), weaponKind: 'spear' })).toBe(false);
  });
});
