import { TestBed } from '@angular/core/testing';
import { isString, persistedSignal } from './persisted-signal';

describe('persistedSignal', () => {
  beforeEach(() => localStorage.clear());

  const create = <T>(initial: T, isValid?: (v: unknown) => boolean) =>
    TestBed.runInInjectionContext(() => persistedSignal('test.key', initial, isValid));

  it('starts from the initial value and writes changes', () => {
    const state = create('a');
    expect(state()).toBe('a');
    state.set('b');
    TestBed.tick();
    expect(localStorage.getItem('mhwet.test.key')).toBe('"b"');
  });

  it('restores the stored value on creation (a reload)', () => {
    localStorage.setItem('mhwet.test.key', JSON.stringify({ n: 3 }));
    expect(create({ n: 0 })()).toEqual({ n: 3 });
  });

  it('falls back to the initial value for corrupt or invalid entries', () => {
    localStorage.setItem('mhwet.test.key', '{not json');
    expect(create('x')()).toBe('x');
    localStorage.setItem('mhwet.test.key', '42');
    expect(create('x', isString)()).toBe('x');
  });
});
