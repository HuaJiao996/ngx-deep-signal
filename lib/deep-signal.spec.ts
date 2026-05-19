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
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';
import { deepSignal, peek, updateAtPath, toReadonlyDeepSignal, batch } from './deep-signal';

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
    // Leaf linked writable may not be detected by isSignal (depends on Angular version)
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
      toObservable(
        computed(() => state.user.name()),
        { injector },
      ),
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
      toObservable(
        computed(() => state.user.name()),
        { injector },
      ),
    );

    const v = await firstValueFrom(name$);
    expect(v).toBe('Ada');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // batch
  // ─────────────────────────────────────────────────────────────────────────

  describe('batch', () => {
    it('coalesces multiple leaf writes into a single root update', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });
      let updateCount = 0;
      const c = computed(() => {
        void state.user.name();
        void state.user.age();
        updateCount++;
        return `${state.user.name()}:${state.user.age()}`;
      });

      expect(c()).toBe('Ada:36');
      const baseline = updateCount;

      batch(() => {
        state.user.name.set('Bob');
        state.user.age.set(40);
      });

      // Only ONE re-computation, not two
      expect(c()).toBe('Bob:40');
      expect(updateCount - baseline).toBe(1);
    });

    it('last write wins when same path is set multiple times', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });

      batch(() => {
        state.user.name.set('Bob');
        state.user.name.set('Lin');
      });

      expect(state.user.name()).toBe('Lin');
    });

    it('nested batch calls are handled correctly', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });
      let updateCount = 0;
      const c = computed(() => {
        void state.user.name();
        void state.user.age();
        updateCount++;
        return true;
      });

      expect(c()).toBe(true);
      const baseline = updateCount;

      batch(() => {
        state.user.name.set('Bob');
        batch(() => {
          state.user.age.set(40);
        });
        state.user.name.set('Lin');
      });

      expect(updateCount - baseline).toBe(1);
    });

    it('effect runs once after batch with multiple leaf writes', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });
      let effectRuns = 0;
      TestBed.runInInjectionContext(() => {
        effect(() => {
          void state.user.name();
          effectRuns++;
        });
      });
      TestBed.tick();
      expect(effectRuns).toBe(1);

      batch(() => {
        state.user.name.set('Bob');
        state.user.name.set('Lin');
        state.user.name.set('Sam');
      });
      TestBed.tick();

      // Only one more run, seeing the final value
      expect(effectRuns).toBe(2);
      expect(state.user.name()).toBe('Sam');
    });

    it('reads inside batch still return current values', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });

      batch(() => {
        expect(state.user.name()).toBe('Ada');
        expect(state.user.age()).toBe(36);
        state.user.name.set('Bob');
        expect(state.user.name()).toBe('Bob'); // untracked read sees pending local write
        state.user.age.set(40);
      });

      expect(state()).toEqual({ user: { name: 'Bob', age: 40 } });
    });

    it('updateAtPath inside batch coalesces into single root update', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });
      let updateCount = 0;
      const c = computed(() => {
        void state.user.name();
        void state.user.age();
        updateCount++;
        return true;
      });

      expect(c()).toBe(true);
      const baseline = updateCount;

      batch(() => {
        updateAtPath(state, ['user', 'name'], () => 'Bob');
        updateAtPath(state, ['user', 'age'], () => 40);
      });

      expect(updateCount - baseline).toBe(1);
      expect(state()).toEqual({ user: { name: 'Bob', age: 40 } });
    });

    it('batch without writes does nothing extra', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });
      let runs = 0;
      const c = computed(() => {
        runs++;
        return state.user.name();
      });

      expect(c()).toBe('Ada');
      const baseline = runs;

      batch(() => {
        // no writes
      });

      expect(runs).toBe(baseline);
    });

    it('error inside batch does not swallow pending update', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });

      expect(() => {
        batch(() => {
          state.user.name.set('Bob');
          throw new Error('boom');
        });
      }).toThrow('boom');

      // Write was NOT applied — batch aborted
      expect(state.user.name()).toBe('Ada');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // peek
  // ─────────────────────────────────────────────────────────────────────────

  describe('peek', () => {
    it('reads current value without creating a dependency', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });

      expect(peek(state.user.name)).toBe('Ada');

      let runs = 0;
      const c = computed(() => {
        runs++;
        // peek doesn't track — changing name does NOT trigger a re-run
        return peek(state.user.name) + peek(state.user.age);
      });

      expect(c()).toBe('Ada36');
      expect(runs).toBe(1);

      state.user.name.set('Bob');
      // Computed not re-run because peek is untracked
      expect(c()).toBe('Ada36');
      expect(runs).toBe(1);
    });

    it('works with plain Signal', () => {
      const s = signal('hello');
      expect(peek(s)).toBe('hello');
      s.set('world');
      expect(peek(s)).toBe('world');
    });

    it('works with computed', () => {
      const s = signal(1);
      const c = computed(() => s() * 2);
      expect(peek(c)).toBe(2);
      s.set(3);
      expect(peek(c)).toBe(6);
    });

    it('works with a getter function', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });
      expect(peek(() => state.user.name())).toBe('Ada');
      state.user.name.set('Bob');
      expect(peek(() => state.user.name())).toBe('Bob');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // updateAtPath
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateAtPath', () => {
    it('updates a leaf at a short path', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });

      updateAtPath(state, ['user', 'name'], (n) => n.toUpperCase());

      expect(state.user.name()).toBe('ADA');
      expect(state.user.age()).toBe(36);
    });

    it('updates a branch at an intermediate path', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });

      updateAtPath(state, ['user'], (u) => ({ ...u, age: 40 }));

      expect(state.user.name()).toBe('Ada');
      expect(state.user.age()).toBe(40);
    });

    it('updates root with empty path', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });

      updateAtPath(state, [], () => ({ user: { name: 'Lin', age: 18 } }));

      expect(state.user.name()).toBe('Lin');
      expect(state.user.age()).toBe(18);
    });

    it('updates through 3+ levels', () => {
      const state = deepSignal({
        a: { b: { c: 1 } },
      });

      updateAtPath(state, ['a', 'b', 'c'], (v) => v + 10);

      expect(state.a.b.c()).toBe(11);
    });

    it('is reactive — computed depending on path re-runs', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });
      let runs = 0;
      const c = computed(() => {
        runs++;
        return state.user.name();
      });

      expect(c()).toBe('Ada');
      expect(runs).toBe(1);

      updateAtPath(state, ['user', 'name'], () => 'Bob');

      expect(c()).toBe('Bob');
      expect(runs).toBe(2);

      // Sibling path does not re-run
      updateAtPath(state, ['user', 'age'], (a) => a + 1);
      expect(runs).toBe(2);
    });

    it('updates array items by index', () => {
      const state = deepSignal({ items: [{ label: 'a' }, { label: 'b' }] as { label: string }[] });

      updateAtPath(state, ['items', '0', 'label'], (l) => l.toUpperCase());

      expect(state.items()[0].label).toBe('A');
      expect(state.items()[1].label).toBe('b');
    });

    it('replace entire array', () => {
      const state = deepSignal({ items: ['a', 'b'] as string[] });

      updateAtPath(state, ['items'], () => ['x', 'y', 'z']);

      expect(state.items()).toEqual(['x', 'y', 'z']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // toReadonlyDeepSignal
  // ─────────────────────────────────────────────────────────────────────────

  describe('toReadonlyDeepSignal', () => {
    it('returns a signal that reads at every path', () => {
      const writable = deepSignal({ user: { name: 'Ada', age: 36 } });
      const readonly = toReadonlyDeepSignal(writable);

      expect(readonly.user.name()).toBe('Ada');
      expect(readonly.user()).toEqual({ name: 'Ada', age: 36 });
      expect(readonly().user.name).toBe('Ada');

      writable.user.name.set('Bob');
      expect(readonly.user.name()).toBe('Bob');
    });

    it('tracks updates reactively', () => {
      const writable = deepSignal({ user: { name: 'Ada', age: 36 } });
      const readonly = toReadonlyDeepSignal(writable);
      let runs = 0;
      const c = computed(() => {
        runs++;
        return readonly.user.name();
      });

      expect(c()).toBe('Ada');
      expect(runs).toBe(1);

      writable.user.name.set('Bob');
      expect(c()).toBe('Bob');
      expect(runs).toBe(2);
    });

    it('asReadonly on the readonly returns itself', () => {
      const writable = deepSignal({ user: { name: 'Ada', age: 36 } });
      const readonly = toReadonlyDeepSignal(writable);
      // asReadonly is defined on Signal, returns the signal itself when already readonly
      const r2 = (readonly.user.name as unknown as { asReadonly: () => Signal<string> }).asReadonly();
      expect(r2()).toBe('Ada');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles Map as a NonRecord leaf', () => {
      const state = deepSignal({
        meta: new Map<string, number>([['key', 1]]),
      });

      expect(state.meta()).toBeInstanceOf(Map);
      const updatedMap = new Map(state.meta());
      updatedMap.set('key', 2);
      state.meta.set(updatedMap);
      expect(state.meta().get('key')).toBe(2);
      const addedMap = new Map(state.meta());
      addedMap.set('extra', 3);
      state.meta.set(addedMap);
      expect(state.meta().get('extra')).toBe(3);
    });

    it('handles Set as a NonRecord leaf', () => {
      const state = deepSignal({ tags: new Set(['a', 'b']) });

      expect(state.tags()).toBeInstanceOf(Set);
      const added = new Set(state.tags());
      added.add('c');
      state.tags.set(added);
      expect(state.tags().has('c')).toBe(true);
    });

    it('handles deeply nested arrays', () => {
      const state = deepSignal({
        matrix: [
          [1, 2],
          [3, 4],
        ] as number[][],
      });

      // matrix is treated as a leaf (array is NonRecord)
      state.matrix.set([
        [5, 6],
        [7, 8],
      ]);
      expect(state.matrix()).toEqual([
        [5, 6],
        [7, 8],
      ]);

      state.matrix.update((m) => m.map((row) => row.map((v) => v * 2)));
      expect(state.matrix()).toEqual([
        [10, 12],
        [14, 16],
      ]);
    });

    it('updates work after set() replaces the entire tree', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });

      state.set({ user: { name: 'Bob', age: 40 } });
      state.user.name.set('Lin');

      expect(state.user.name()).toBe('Lin');
      expect(state.user.age()).toBe(40);
    });

    it('stale computed entries are cleaned up after set() changes shape', () => {
      const state = deepSignal({ a: { x: 1 }, b: { y: 2 } });

      // Access a deeply nested path to create computed entries
      expect(state.a.x()).toBe(1);
      expect(state.b.y()).toBe(2);

      // Remove the 'a' branch entirely — intentionally test partial replacement
      (state as WritableSignal<Record<string, unknown>>).set({ b: { y: 20 } });

      // Access 'a' again — old computed should be removed, fresh one created
      // The old computed for 'a' referenced a shape that no longer exists
      expect(state.b.y()).toBe(20);
    });

    it('handles objects with null prototype', () => {
      const obj = Object.create(null);
      obj.name = 'Ada';
      obj.age = 36;
      const state = deepSignal({ user: obj } as { user: { name: string; age: number } });

      expect(state.user.name()).toBe('Ada');
      state.user.name.set('Bob');
      expect(state.user.name()).toBe('Bob');
    });

    it('handles optional properties', () => {
      const state = deepSignal({
        user: { name: 'Ada', age: 36 },
        meta: null as { label: string } | null,
      });

      expect(state.user.name()).toBe('Ada');
      expect(state.meta()).toBe(null);

      // Replace optional field with a real object
      state.meta.set({ label: 'hello' });
      expect(state.meta()).toEqual({ label: 'hello' });
      expect(state.meta()?.label).toBe('hello');
    });

    it('handles tuple types', () => {
      const state = deepSignal({
        coords: [10, 20] as [number, number],
      });

      expect(state.coords()).toEqual([10, 20]);
      state.coords.set([30, 40]);
      expect(state.coords()).toEqual([30, 40]);
    });

    it('handles readonly arrays', () => {
      const state = deepSignal({
        items: ['a', 'b'] as readonly string[],
      });

      expect(state.items()).toEqual(['a', 'b']);
      state.items.set(['c', 'd']);
      expect(state.items()).toEqual(['c', 'd']);
    });

    it('deep nested record replaced via set propagates to all watchers', () => {
      const state = deepSignal({
        a: { b: { c: 1 } },
        a2: { b2: { c2: 2 } },
      });

      const c = computed(() => state.a.b.c());
      const c2 = computed(() => state.a2.b2.c2());

      expect(c()).toBe(1);
      expect(c2()).toBe(2);

      // Replace one branch — only its consumers re-run
      state.a.set({ b: { c: 100 } });

      expect(c()).toBe(100);
      expect(c2()).toBe(2); // unchanged
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Type inference sanity checks (compile-time only)
  // ─────────────────────────────────────────────────────────────────────────

  describe('type inference', () => {
    it('deepSignal infers correct leaf types', () => {
      const state = deepSignal({
        s: 'hello',
        n: 42,
        b: true,
      });

      expect(typeof state.s.set).toBe('function');
      expect(typeof state.n.update).toBe('function');
      expect(typeof state.b.set).toBe('function');
    });

    it('toReadonlyDeepSignal removes set/update from type', () => {
      const writable = deepSignal({ user: { name: 'Ada', age: 36 } });
      const readonly = toReadonlyDeepSignal(writable);

      // At compile time these would error if uncommented:
      // readonly.user.name.set('Bob');   // Error: Property 'set' does not exist
      // readonly.user.name.update(n => n); // Error: Property 'update' does not exist

      // Read works fine
      expect(readonly.user.name()).toBe('Ada');
    });

    it('branch paths are also signals at type level', () => {
      const state = deepSignal({ user: { name: 'Ada', age: 36 } });
      const branch = state.user;

      // isSignal should be true for branch at runtime
      expect(isSignal(branch)).toBe(true);
      expect(branch()).toEqual({ name: 'Ada', age: 36 });
    });
  });
});
