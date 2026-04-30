import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  isSignal,
  linkedSignal,
  resource,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';
import { deepSignal } from './deep-signal';

describe('deepSignal', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });
  it('exposes nested leaf writables and updates root immutably', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    expect(state.user.name()).toBe('Ada');
    state.user.name.set('Bob');
    expect(state().user.name).toBe('Bob');
    state.user.age.update((n) => n + 1);
    expect(state.user.age()).toBe(37);
  });

  it('supports root / branch / leaf snapshots and root update from plain snapshot', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    state.user.name.set('Bob');
    state.user.age.set(40);

    expect(state()).toEqual({ user: { name: 'Bob', age: 40 } });
    expect(state.user()).toEqual({ name: 'Bob', age: 40 });
    expect(state.user.name()).toBe('Bob');

    state.update((d) => ({ user: { name: d.user.name, age: 36 } }));
    expect(state()).toEqual({ user: { name: 'Bob', age: 36 } });
  });

  it('granular dependency: computed only tracks read path', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    let runs = 0;
    const c = computed(() => {
      runs++;
      return state.user.name();
    });
    expect(c()).toBe('Ada');
    expect(runs).toBe(1);
    state.user.age.set(40);
    expect(c()).toBe('Ada');
    expect(runs).toBe(1);
    state.user.name.set('Bob');
    expect(c()).toBe('Bob');
    expect(runs).toBe(2);
  });

  it('granular dependency: effect only tracks read path', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    let runs = 0;
    TestBed.runInInjectionContext(() => {
      effect(() => {
        runs++;
        void state.user.name();
      });
    });
    TestBed.tick();
    expect(runs).toBe(1);

    state.user.age.set(40);
    TestBed.tick();
    expect(runs).toBe(1);

    state.user.name.set('Bob');
    TestBed.tick();
    expect(runs).toBe(2);
  });

  it('supports leaf asReadonly signal', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    const readonlyName = state.user.name.asReadonly();

    expect(readonlyName()).toBe('Ada');
    state.user.name.set('Bob');
    expect(readonlyName()).toBe('Bob');
  });

  it('supports untracked reads inside computed', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    let runs = 0;
    const c = computed(() => {
      runs++;
      const name = state.user.name();
      const age = untracked(() => state.user.age());
      return `${name}:${age}`;
    });

    expect(c()).toBe('Ada:36');
    expect(runs).toBe(1);

    state.user.age.set(40);
    expect(c()).toBe('Ada:36');
    expect(runs).toBe(1);

    state.user.name.set('Bob');
    expect(c()).toBe('Bob:40');
    expect(runs).toBe(2);
  });

  it('supports root set for whole tree replacement', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });

    state.set({ user: { name: 'Lin', age: 18 } });
    expect(state()).toEqual({ user: { name: 'Lin', age: 18 } });
    expect(state.user.name()).toBe('Lin');
    expect(state.user.age()).toBe(18);
  });

  it('treats arrays as writable leaves', () => {
    const state = deepSignal({ user: { tags: ['a', 'b'] as string[] } });

    state.user.tags.update((tags) => [...tags, 'c']);
    expect(state.user.tags()).toEqual(['a', 'b', 'c']);

    state.user.tags.set(['x']);
    expect(state.user.tags()).toEqual(['x']);
    expect(state().user.tags).toEqual(['x']);
  });

  it('isSignal is true for root and branch proxies; linked leaves may not brand as signals', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    expect(isSignal(state)).toBe(true);
    expect(isSignal(state.user)).toBe(true);
    // 叶子 `createLinkedWritable` 提供 WritableSignal 接口，但实现上未必带 `isSignal` 标记
    expect(isSignal(state.user.name)).toBe(false);
    expect(typeof state.user.name).toBe('function');
    expect(typeof state.user.name.set).toBe('function');
  });

  it('supports root asReadonly snapshot', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    const root = state.asReadonly();

    expect(root()).toEqual({ user: { name: 'Ada', age: 36 } });
    state.user.name.set('Bob');
    expect(root()).toEqual({ user: { name: 'Bob', age: 36 } });
  });

  it('linkedSignal tracks a deep leaf as source', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    const upper = TestBed.runInInjectionContext(() =>
      linkedSignal({
        source: () => state.user.name(),
        computation: (name) => name.toUpperCase(),
      }),
    );

    expect(upper()).toBe('ADA');
    state.user.name.set('bob');
    expect(upper()).toBe('BOB');
    state.user.age.set(40);
    expect(upper()).toBe('BOB');
  });

  it('computed tracks multiple deep leaves', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    let runs = 0;
    const c = computed(() => {
      runs++;
      return `${state.user.name()}:${state.user.age()}`;
    });

    expect(c()).toBe('Ada:36');
    expect(runs).toBe(1);

    state.user.name.set('Bob');
    expect(c()).toBe('Bob:36');
    expect(runs).toBe(2);

    state.user.age.set(40);
    expect(c()).toBe('Bob:40');
    expect(runs).toBe(3);
  });

  it('stops scheduling after EffectRef.destroy', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    let runs = 0;
    const ref = TestBed.runInInjectionContext(() =>
      effect(() => {
        runs++;
        void state.user.name();
      }),
    );
    TestBed.tick();
    expect(runs).toBe(1);

    state.user.name.set('Bob');
    TestBed.tick();
    expect(runs).toBe(2);

    ref.destroy();
    state.user.name.set('Lin');
    TestBed.tick();
    expect(runs).toBe(2);
  });

  it('treats Date as a writable leaf', () => {
    const t0 = new Date('2020-01-01T00:00:00.000Z');
    const t1 = new Date('2021-06-15T00:00:00.000Z');
    const state = deepSignal({ user: { joined: t0 } });

    state.user.joined.set(t1);
    expect(state.user.joined().getTime()).toBe(t1.getTime());
    expect(state().user.joined.getTime()).toBe(t1.getTime());
  });

  it('computed equal can suppress downstream invalidation when derived value unchanged', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    let runs = 0;
    const len = computed(
      () => {
        runs++;
        return state.user.name().length;
      },
      { equal: (a, b) => a === b },
    );

    let consumerRuns = 0;
    const consumer = computed(() => {
      consumerRuns++;
      return len();
    });

    expect(len()).toBe(3);
    expect(consumer()).toBe(3);
    expect(runs).toBe(1);
    expect(consumerRuns).toBe(1);

    state.user.name.set('Bob');
    expect(len()).toBe(3);
    expect(consumer()).toBe(3);
    expect(runs).toBe(2);
    expect(consumerRuns).toBe(1);
  });

  it('resource reloads when deep leaf used as params changes', async () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    const injector = TestBed.inject(Injector);
    const res = TestBed.runInInjectionContext(() =>
      resource({
        params: () => state.user.name(),
        loader: ({ params }) => Promise.resolve(`hi:${params}`),
        defaultValue: 'hi:',
        injector,
      }),
    );

    await vi.waitFor(() => expect(res.value()).toBe('hi:Ada'));

    state.user.name.set('Lin');
    await vi.waitFor(() => expect(res.value()).toBe('hi:Lin'));

    res.destroy();
  });

  it('combines toSignal with deepSignal in computed', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    const n$ = new BehaviorSubject(1);
    const injector = TestBed.inject(Injector);
    const n = TestBed.runInInjectionContext(() => toSignal(n$, { initialValue: 0, injector }));

    const c = computed(() => `${state.user.name()}:${n()}`);
    expect(c()).toBe('Ada:1');

    n$.next(2);
    expect(c()).toBe('Ada:2');

    state.user.name.set('Bob');
    expect(c()).toBe('Bob:2');
  });

  it('runs effect cleanup when EffectRef.destroy is called', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    let cleaned = false;
    const ref = TestBed.runInInjectionContext(() =>
      effect((onCleanup) => {
        void state.user.name();
        onCleanup(() => {
          cleaned = true;
        });
      }),
    );
    TestBed.tick();
    expect(cleaned).toBe(false);

    ref.destroy();
    expect(cleaned).toBe(true);
  });

  it('toObservable emits when deep leaf behind computed changes', () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    const injector = TestBed.inject(Injector);
    const nameFromDeep = computed(() => state.user.name());
    const name$ = TestBed.runInInjectionContext(() => toObservable(nameFromDeep, { injector }));

    const values: string[] = [];
    const sub = name$.subscribe((v) => values.push(v));
    TestBed.tick();
    expect(values.at(-1)).toBe('Ada');

    state.user.name.set('Bob');
    TestBed.tick();
    expect(values.at(-1)).toBe('Bob');

    sub.unsubscribe();
  });

  it('rxResource resolves from Observable stream keyed by deep leaf', async () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    const injector = TestBed.inject(Injector);
    const res = TestBed.runInInjectionContext(() =>
      rxResource({
        params: () => state.user.name(),
        stream: ({ params }) => of(`rx:${params}`),
        defaultValue: 'rx:',
        injector,
      }),
    );

    await vi.waitFor(() => expect(res.value()).toBe('rx:Ada'));

    state.user.name.set('Lin');
    await vi.waitFor(() => expect(res.value()).toBe('rx:Lin'));

    res.destroy();
  });

  it('takeUntilDestroyed completes when host DestroyRef is torn down', () => {
    @Component({ standalone: true, template: '' })
    class Host {
      readonly dr = inject(DestroyRef);
    }

    const fixture = TestBed.createComponent(Host);
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    const injector = TestBed.inject(Injector);
    const name$ = TestBed.runInInjectionContext(() =>
      toObservable(computed(() => state.user.name()), { injector }),
    );

    let completed = false;
    name$.pipe(takeUntilDestroyed(fixture.componentInstance.dr)).subscribe({
      complete: () => {
        completed = true;
      },
    });
    fixture.detectChanges();
    TestBed.tick();

    fixture.destroy();
    expect(completed).toBe(true);
  });

  it('firstValueFrom toObservable reads current deep leaf', async () => {
    const state = deepSignal({ user: { name: 'Ada', age: 36 } });
    const injector = TestBed.inject(Injector);
    const name$ = TestBed.runInInjectionContext(() =>
      toObservable(computed(() => state.user.name()), { injector }),
    );

    const v = await firstValueFrom(name$);
    expect(v).toBe('Ada');
  });
});
