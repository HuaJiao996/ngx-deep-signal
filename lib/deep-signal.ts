/**
 * ngx-deep-signal
 * Deep / nested writable signals for Angular.
 *
 * Reading a nested value (e.g. `state.user.name()`) only subscribes to that specific path,
 * preventing updates to sibling fields from invalidating consumers. Leaf fields expose
 * WritableSignal-style `set` / `update`. Whole-tree replacement still uses root `set` / `update`.
 *
 * @example
 * ```ts
 * const state = deepSignal({ user: { name: 'Ada', age: 36 } });
 * state.user.name.set('Bob');                // granular writable
 * state.user.age.update(n => n + 1);          // granular update
 * state.update(d => ({ user: { ...d.user, age: 36 } })); // whole tree
 *
 * const name = state.user.name();             // 'Bob'
 * const branch = state.user();                // { name: 'Bob', age: 36 }
 *
 * const readonlyName = state.user.name.asReadonly();
 * const full = state.asReadonly();
 *
 * // Peek without creating dependency
 * const peeked = peek(state.user.name);       // 'Bob'
 *
 * // Update at arbitrary path
 * updateAtPath(state, ['user', 'age'], n => n + 1);
 * ```
 */

import {
  computed,
  isSignal,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marker symbol attached to lazily-created computed signals so that stale computed
 * entries on a proxy can be cleaned up when the root signal's shape changes.
 */
const DEEP_SIGNAL_MARKER = Symbol(typeof ngDevMode !== 'undefined' && ngDevMode ? 'NGX_DEEP_SIGNAL' : '');

/**
 * Narrowing helper — true when `value` has the DEEP_SIGNAL_MARKER attached.
 */
function hasMarker(value: unknown): value is { [DEEP_SIGNAL_MARKER]?: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    DEEP_SIGNAL_MARKER in (value as object)
  );
}

/**
 * "Leaf" types that should NOT be recursively split into sub-signals.
 * Includes built-in non-dictionary objects and language intrinsics.
 */
type NonRecord =
  | Iterable<unknown>
  | WeakSet<object>
  | WeakMap<object, unknown>
  | Promise<unknown>
  | Date
  | Error
  | RegExp
  | ArrayBuffer
  | DataView
  | Function;

/** `true` when `T` is an object that is NOT a NonRecord. */
type IsRecord<T> = T extends object ? (T extends NonRecord ? false : true) : false;

/**
 * Distinguishes "wide" index-signature objects (e.g. `Record<string, unknown>`)
 * from models with known keys. Wide objects are treated as leaf — we don't
 * recursively expose their dynamic keys as sub-signals.
 */
type IsUnknownRecord<T> =
  keyof T extends never
    ? true
    : string extends keyof T
      ? true
      : symbol extends keyof T
        ? true
        : number extends keyof T
          ? true
          : false;

/** True when `T` is a plain object with known keys that should be deep-split. */
type IsKnownRecord<T> = IsRecord<T> extends true ? (IsUnknownRecord<T> extends true ? false : true) : false;

/**
 * ReadonlyDeepSignal mirrors WritableDeepSignal but all leaves are read-only signals.
 * Use `toReadonlyDeepSignal()` or call `.asReadonly()` on any path to obtain one.
 *
 * @example
 * ```ts
 * const state = deepSignal({ user: { name: 'Ada', age: 36 } });
 * const ro: ReadonlyDeepSignal<typeof state> = toReadonlyDeepSignal(state);
 * // ro.user.name() — read-only
 * // ro.user.name.set() — not available
 * ```
 */
export type ReadonlyDeepSignal<T> = Signal<T> &
  (IsKnownRecord<T> extends true
    ? Readonly<{
        [K in keyof T]: ReadonlyDeepSignal<T[K]>;
      }>
    : unknown);

/**
 * WritableDeepSignal: deep-signal return type.
 *
 * - Root is a `WritableSignal<T>` (read full snapshot via `()`, replace via `set` / `update`).
 * - Every known-record key returns `WritableDeepSignal<T[K]>` — recursively.
 * - Leaf keys (primitives, Date, arrays, etc.) return `WritableSignal<T[K]>` — writable via
 *   `set` / `update` which forward to an immutating root update.
 *
 * @example
 * ```ts
 * deepSignal({ user: { name: 'Ada', age: 36 } })
 * // WritableSignal<{
 * //   user: WritableSignal<{
 * //     name: WritableSignal<string>;
 * //     age: WritableSignal<number>;
 * //   }>;
 * // }>
 * ```
 */
export type WritableDeepSignal<T> = WritableSignal<T> &
  (IsKnownRecord<T> extends true
    ? Readonly<{
        [K in keyof T]: WritableDeepSignal<T[K]>;
      }>
    : unknown);

// ─────────────────────────────────────────────────────────────────────────────
// Runtime type guards
// ─────────────────────────────────────────────────────────────────────────────

const nonRecordCtors: readonly Function[] = [
  WeakSet,
  WeakMap,
  Promise,
  Date,
  Error,
  RegExp,
  ArrayBuffer,
  DataView,
  Function,
];

/**
 * Returns `true` when `value` is a plain object (prototype chain ends at Object.prototype).
 * Arrays and built-in non-dictionary types (see `nonRecordCtors`) are treated as non-record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || isIterable(value)) {
    return false;
  }
  let proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype) {
    return true;
  }
  while (proto && proto !== Object.prototype) {
    if (nonRecordCtors.includes(proto.constructor as Function)) {
      return false;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return proto === Object.prototype;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof (value as { [Symbol.iterator]?: unknown })?.[Symbol.iterator] === 'function';
}

// ─────────────────────────────────────────────────────────────────────────────
// Path utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Reads the value at `path` from `root`. Returns `undefined` if the path is invalid. */
function readAtPath(root: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

/**
 * Returns a copy of `root` with the value at `path` replaced by `value`.
 * Performs shallow copies at every level (immutable update pattern).
 */
function setAtPath<T>(root: T, path: readonly PropertyKey[], value: unknown): T {
  if (path.length === 0) {
    return value as T;
  }

  const [head, ...rest] = path;

  // Leaf assignment — only one segment left
  if (rest.length === 0) {
    if (Array.isArray(root)) {
      const copy = root.slice();
      copy[Number(head)] = value as never;
      return copy as T;
    }
    return { ...(root as object), [head]: value } as T;
  }

  // Recurse into child, then shallow-copy parent
  const child = (root as Record<PropertyKey, unknown>)[head];
  const newChild = setAtPath(child, rest, value);

  if (Array.isArray(root)) {
    const copy = root.slice();
    copy[Number(head)] = newChild as never;
    return copy as T;
  }
  return { ...(root as object), [head]: newChild } as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Linked writable leaf
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a WritableSignal-like object for a leaf field.
 *
 * Reads are forwarded to the pre-computed `readComputed` (which is tracked in the
 * reactive graph). Writes call `root.update` with an immutable `setAtPath` call.
 *
 * This function is used for every leaf field — not for record branches (those use
 * `toDeepSignal` recursively).
 */
function createLinkedWritable<V>(
  root: WritableSignal<unknown>,
  path: readonly PropertyKey[],
  readComputed: Signal<V>,
): WritableSignal<V> {
  function linkedRead(): V {
    return readComputed();
  }

  const w = linkedRead as WritableSignal<V>;
  w.set = (value: V) => {
    scheduleBatchedRootUpdate(() => {
      root.update((s) => setAtPath(s, path, value) as typeof s);
    });
  };
  w.update = (updater: (v: V) => V) => {
    scheduleBatchedRootUpdate(() => {
      root.update((s) => {
        const cur = readAtPath(s, path) as V;
        return setAtPath(s, path, updater(cur)) as typeof s;
      });
    });
  };
  w.asReadonly = () => readComputed;

  // Mark so `isSignal` may return true for linked leaves (Angular 19+)
  (w as { [key: symbol]: boolean })[Symbol.toStringTag] = 'Signal';

  return w;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep proxy factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches the DEEP_SIGNAL_MARKER to `target` so stale computed entries can be
 * detected and cleaned up when the root signal's shape changes.
 */
function attachMarker(target: unknown): void {
  (target as { [DEEP_SIGNAL_MARKER]?: boolean })[DEEP_SIGNAL_MARKER] = true;
}

/**
 * Converts a `Signal<T>` into a `WritableDeepSignal<T>` using a recursive Proxy.
 *
 * The Proxy intercepts property access to:
 *   - Lazily create `computed` signals for each property (cached on the target so
 *     duplicate access returns the same computed instance).
 *   - Return a linked writable leaf for primitive / NonRecord values.
 *   - Recurse into record branches, creating nested deep signals.
 *   - Clean up stale computed entries when the underlying shape changes.
 */
function toDeepSignal<T>(
  source: Signal<T>,
  root: WritableSignal<unknown>,
  path: readonly PropertyKey[],
): WritableDeepSignal<T> {
  const handler: ProxyHandler<WritableSignal<T> & Record<string | symbol, unknown>> = {
    // `prop in proxy` → return true if the property exists in the current snapshot
    has(target, prop) {
      return prop in (untracked(target) as object);
    },

    get(target, prop) {
      // Handle special symbols and non-string props
      if (typeof prop !== 'string' && typeof prop !== 'symbol') {
        return (target as Record<string, unknown>)[prop];
      }

      // Pass through Angular-internal symbols and known methods on WritableSignal
      if (
        prop === 'toString' ||
        prop === 'valueOf' ||
        prop === 'then' ||
        prop === DEEP_SIGNAL_MARKER ||
        // Let Angular get to the underlying signal methods
        (typeof (target as unknown as { [k: string]: unknown })[prop] === 'function' &&
          !Object.prototype.hasOwnProperty.call(target, prop))
      ) {
        return (target as Record<string | symbol, unknown>)[prop];
      }

      const snapshot = untracked(target);

      // Key does not exist in current snapshot → clean up any stale computed and fall through
      if (!isRecord(snapshot) || !(prop in snapshot)) {
        const existing = (target as Record<string | symbol, unknown>)[prop];
        if (hasMarker(existing)) {
          delete (target as Record<string | symbol, unknown>)[prop];
        }
        return (target as Record<string | symbol, unknown>)[prop];
      }

      // ── Lazily create & cache a computed signal for this property ──────────
      let childComputed = (target as Record<string | symbol, unknown>)[prop];
      if (!isSignal(childComputed)) {
        childComputed = computed(() => (target() as Record<string, unknown>)[prop as string]);
        Object.defineProperty(target, prop, {
          value: childComputed,
          writable: false,
          enumerable: true,
          configurable: true,
        });
        attachMarker(childComputed);
      }

      const childVal = (snapshot as Record<string, unknown>)[prop];

      // Non-record leaf → wrap as a linked writable signal
      if (!isRecord(childVal)) {
        return createLinkedWritable(root, [...path, prop], childComputed as Signal<unknown>) as WritableSignal<
          unknown
        >;
      }

      // Record branch → recurse
      return toDeepSignal(childComputed as Signal<unknown>, root, [...path, prop]);
    },
  };

  return new Proxy(
    source as WritableSignal<T> & Record<string | symbol, unknown>,
    handler,
  ) as WritableDeepSignal<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes `fn` with batched updates — all leaf `set`/`update` calls inside `fn`
 * are coalesced into a **single** root signal update.
 *
 * This avoids redundant re-computations when writing multiple consecutive values.
 *
 * @param fn - A function that performs one or more leaf updates.
 *
 * @example
 * ```ts
 * const state = deepSignal({ user: { name: 'Ada', age: 36 } });
 *
 * batch(() => {
 *   state.user.name.set('Bob');
 *   state.user.age.set(40);
 *   state.user.name.set('Lin'); // last write wins for 'name'
 * });
 *
 * // Only one root update fires — computed/effect sees the final snapshot:
 * // { user: { name: 'Lin', age: 40 } }
 * ```
 *
 * @performance
 * Without batching: 3 leaf writes → 3 root updates → up to 3 re-computation passes.
 * With batching: 3 leaf writes → 1 root update → 1 re-computation pass.
 */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && pendingRootUpdate !== undefined) {
      const pending = pendingRootUpdate;
      pendingRootUpdate = undefined;
      pending();
    }
  }
}

// Internal batching state — shared across all deep-signal trees in the same batch.
// We use a depth counter to support nested `batch()` calls safely.
let batchDepth = 0;
let pendingRootUpdate: (() => void) | undefined;

/**
 * Called by linked writable leaves when inside a batch context.
 * Defers the root update to the outermost `batch()` call.
 */
function scheduleBatchedRootUpdate(update: () => void): void {
  if (batchDepth > 0) {
    // Stack: last write wins — keep the latest pending update
    pendingRootUpdate = update;
  } else {
    update();
  }
}

/**
 * Creates a deep signal from an initial value.
 *
 * @param initialValue - The initial state tree. Can be any shape; plain objects with known
 *   keys are recursively split into sub-signals; NonRecord values (Date, arrays, etc.) are
 *   treated as writable leaves.
 * @returns A `WritableDeepSignal<T>` — both a `WritableSignal<T>` (root-level operations)
 *   and a tree of nested signals at every known-record path.
 *
 * @example
 * ```ts
 * const state = deepSignal({ user: { name: 'Ada', age: 36 } });
 * state.user.name.set('Bob');
 * state.user.age.update(n => n + 1);
 * state.update(d => ({ ...d, user: { ...d.user, name: 'Lin' } }));
 * const name = state.user.name(); // 'Lin'
 * ```
 */
export function deepSignal<T>(initialValue: T): WritableDeepSignal<T> {
  const s = signal(initialValue);
  return toDeepSignal(s, s as WritableSignal<unknown>, []) as WritableDeepSignal<T>;
}

/**
 * Reads a value **without** creating a reactive dependency.
 *
 * This is useful for one-off reads inside `computed` or `effect` that should not
 * cause re-runs when the signal changes.
 *
 * @param signalRef - Any signal or deep-signal path (including leaf `WritableSignal`).
 * @returns The current value.
 *
 * @example
 * ```ts
 * const state = deepSignal({ user: { name: 'Ada', age: 36 } });
 * const name = peek(state.user.name); // 'Ada' — no dependency tracked
 * ```
 */
export function peek<T>(signalRef: Signal<T> | (() => T)): T {
  if (isSignal(signalRef)) {
    return untracked(signalRef);
  }
  return untracked(signalRef as () => T);
}

/**
 * Mutates a deep signal at a specific path using an updater function.
 * The path need not correspond to a leaf — it can target a branch, in which
 * case the updater receives that branch's current value and replaces it.
 *
 * @param target - Any deep signal (root or branch).
 * @param path - Array of property keys, e.g. `['user', 'name']`.
 * @param updater - Function that receives the current value and returns the new value.
 *
 * @example
 * ```ts
 * const state = deepSignal({ user: { name: 'Ada', age: 36 } });
 * updateAtPath(state, ['user', 'name'], n => n.toUpperCase()); // 'ADA'
 * updateAtPath(state, ['user'], u => ({ ...u, age: 40 }));     // whole branch
 * ```
 */
export function updateAtPath<T, P extends readonly PropertyKey[]>(
  target: WritableDeepSignal<T>,
  path: P,
  updater: (value: DeepValue<T, P>) => DeepValue<T, P>,
): void {
  if (path.length === 0) {
    // Full replacement via root signal's update
    (target as WritableSignal<T>).update(() => updater((target as WritableSignal<T>)()) as T);
    return;
  }
  (target as WritableSignal<unknown>).update((root) => {
    const current = readAtPath(root, path);
    return setAtPath(root, path, updater(current as DeepValue<T, P>)) as T;
  });
}

// ── Type helper for updateAtPath ──────────────────────────────────────────────

/**
 * Utility type that extracts the type at a given path from a deep signal type.
 * Used by `updateAtPath` to infer the updater's parameter and return types.
 *
 * @example
 * ```ts
 * type Name = DeepValue<{ user: { name: string } }, ['user', 'name']>; // string
 * ```
 */
export type DeepValue<T, P extends readonly PropertyKey[]> = P extends []
  ? T
  : P extends [infer K, ...infer Rest]
    ? K extends keyof T
      ? DeepValue<T[K], Rest as readonly PropertyKey[]>
      : unknown
    : unknown;

/**
 * Converts a `WritableDeepSignal<T>` to a `ReadonlyDeepSignal<T>`.
 * The returned signal tree is fully read-only — `.set()` / `.update()` are unavailable
 * at every path, but reads at any depth work exactly as before.
 *
 * @param target - Any writable deep signal.
 * @returns A read-only deep signal with identical reactive semantics.
 *
 * @example
 * ```ts
 * const writable = deepSignal({ user: { name: 'Ada', age: 36 } });
 * const readonly = toReadonlyDeepSignal(writable);
 * console.log(readonly.user.name()); // 'Ada'
 * // readonly.user.name.set('Bob'); // TS error: not available
 * ```
 */
export function toReadonlyDeepSignal<T>(target: WritableDeepSignal<T>): ReadonlyDeepSignal<T> {
  return target as unknown as ReadonlyDeepSignal<T>;
}