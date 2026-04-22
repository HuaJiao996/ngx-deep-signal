/**
 * 深层 Signal（Deep Signal）
 *
 * 在普通 `signal({ a: { b: 1 } })` 中，任意嵌套字段变化都会让整个 `signal()` 的依赖方
 * 重新求值。Deep Signal 通过 **Proxy + 按字段划分的 `computed`**，让依赖只订阅
 * 实际读到的路径（例如只读 `state.user.name()` 时，不会因 `state.user.age` 变化而刷新）。
 *
 * **叶子字段可写**：对非「可拆分 record」的值（原始类型、`Date`、数组等），提供与根
 * 一致的 `WritableSignal` 接口，例如 `state.user.name.set('Bob')`，内部通过根
 * `update` 做不可变路径更新，仍保持按路径划分的依赖粒度。
 *
 * 嵌套对象的 **整枝替换** 仍通过根 `state.set(...)` / `state.update(...)` 完成。
 */

import {
  computed,
  isSignal,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';

/**
 * 在类型层面排除「不应按 key 拆成子 signal」的对象形态。
 * 例如 `Array`、`Map`、`Date` 等实现了 `Iterable` 或属于内置非纯字典类型，
 * 应作为 **叶子** 整体由 `WritableSignal<T>` 表示，而不是继续展开。
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

/** `T` 是否为「非 NonRecord 的对象」——即可能参与 Deep 拆分的对象。 */
type IsRecord<T> = T extends object
  ? T extends NonRecord
    ? false
    : true
  : false;

/**
 * 区分「索引签名宽对象」（如 `Record<string, unknown>`）与「键集合已知的模型」。
 * 对前者在类型上不展开子属性，避免把任意 string key 都当成稳定结构，与 NgRx 一致。
 */
type IsUnknownRecord<T> = keyof T extends never
  ? true
  : string extends keyof T
    ? true
    : symbol extends keyof T
      ? true
      : number extends keyof T
        ? true
        : false;

/** 同时满足：是对象、且不是「未知索引签名」的宽对象 → 才按深层 signal 展开。 */
type IsKnownRecord<T> =
  IsRecord<T> extends true
    ? IsUnknownRecord<T> extends true
      ? false
      : true
    : false;

/**
 * 挂在「为某字段懒创建的 `computed`」上的标记。
 * 当根 `signal` 更新后，旧形状里多出来的子 signal 需删除，避免泄漏与陈旧依赖。
 */
const DEEP_SIGNAL = Symbol(
  typeof ngDevMode !== 'undefined' && ngDevMode ? 'DEEP_SIGNAL' : '',
);

/**
 * 深层可写 Signal 的对外类型：
 *
 * - 根是 `WritableSignal<T>`（可 `()` 读取整棵快照、`set` / `update` 做整树替换）；
 * - 若 `T` 是已知普通对象，则每个 `key` 也是 `WritableDeepSignal<T[K]>`，一层层递归；
 * - 对非可拆分叶子（`Date`、数组、原始类型等），结果退化为 `WritableSignal<T[K]>`。
 *
 * 因此 `deepSignal({ user: { name, age } })` 的类型**等价于**：
 *
 * ```ts
 * WritableSignal<{
 *   user: WritableSignal<{
 *     name: WritableSignal<string>;
 *     age: WritableSignal<number>;
 *   }>;
 * }>
 * ```
 *
 * 只是在交叉类型上额外保留了 `()` 读取整棵快照的能力。
 */
export type WritableDeepSignal<T> = WritableSignal<T> &
  (IsKnownRecord<T> extends true
    ? Readonly<{
        [K in keyof T]: WritableDeepSignal<T[K]>;
      }>
    : unknown);

/**
 * 运行时不视为「可递归拆 key」的构造器列表，与 `isRecord` 原型链 walk 配套。
 */
const nonRecords: readonly Function[] = [
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

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || isIterable(value)) {
    return false;
  }

  let proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype) {
    return true;
  }

  while (proto && proto !== Object.prototype) {
    if (nonRecords.includes(proto.constructor as Function)) {
      return false;
    }
    proto = Object.getPrototypeOf(proto);
  }

  return proto === Object.prototype;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof (value as { [Symbol.iterator]?: unknown })?.[Symbol.iterator] ===
    'function';
}

/** 按路径读取；路径无效时返回 `undefined`。 */
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
 * 在不可变前提下替换 `path` 末端的值；路径上的每一层做浅拷贝，兄弟引用保持不变。
 */
function setAtPath<T>(root: T, path: readonly PropertyKey[], value: unknown): T {
  if (path.length === 0) {
    return value as T;
  }

  const [head, ...rest] = path;

  if (rest.length === 0) {
    if (Array.isArray(root)) {
      const i = Number(head);
      const copy = root.slice();
      copy[i] = value as never;
      return copy as T;
    }
    return { ...(root as object), [head]: value } as T;
  }

  const child = (root as Record<PropertyKey, unknown>)[head];
  const newChild = setAtPath(child, rest, value);

  if (Array.isArray(root)) {
    const i = Number(head);
    const copy = root.slice();
    copy[i] = newChild as never;
    return copy as T;
  }

  return { ...(root as object), [head]: newChild } as T;
}

/**
 * 叶子路径上的「链式 WritableSignal」：读走已有 `computed`，写通过根 `update` 合并到整树。
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
    root.update((s) => setAtPath(s, path, value) as typeof s);
  };
  w.update = (updateFn: (v: V) => V) => {
    root.update((s) => {
      const cur = readAtPath(s, path) as V;
      return setAtPath(s, path, updateFn(cur)) as typeof s;
    });
  };
  w.asReadonly = () => readComputed;
  return w;
}

function toDeepSignal<T>(
  source: Signal<T>,
  root: WritableSignal<unknown>,
  path: readonly PropertyKey[],
): WritableDeepSignal<T> {
  const handler: ProxyHandler<WritableSignal<T> & Record<string | symbol, unknown>> = {
    has(target, prop) {
      return !!handler.get!(target, prop, undefined);
    },
    get(target, prop) {
      const value = untracked(target);
      if (!isRecord(value) || !(prop in value)) {
        if (isSignal(target[prop]) && (target[prop] as { [DEEP_SIGNAL]?: boolean })[DEEP_SIGNAL]) {
          delete target[prop];
        }

        return (target as Record<string | symbol, unknown>)[prop];
      }

      if (!isSignal(target[prop])) {
        Object.defineProperty(target, prop, {
          value: computed(() => (target() as Record<string, unknown>)[prop as string]),
          configurable: true,
        });
        (target[prop] as { [DEEP_SIGNAL]: boolean })[DEEP_SIGNAL] = true;
      }

      const childComputed = target[prop] as Signal<unknown>;
      const childVal = (value as Record<string, unknown>)[prop as string];

      if (!isRecord(childVal)) {
        return createLinkedWritable(root, [...path, prop], childComputed as Signal<unknown>) as WritableSignal<
          unknown
        >;
      }

      return toDeepSignal(childComputed as Signal<unknown>, root, [...path, prop]);
    },
  };

  return new Proxy(source as WritableSignal<T> & Record<string | symbol, unknown>, handler) as WritableDeepSignal<T>;
}

/**
 * 从初始对象创建根 `WritableSignal`，并套上深层 Proxy。
 *
 * 任意层级都可像 `Signal` 一样用 `()` 取当前快照；根上仍可用 `set` / `update` 做整树替换。
 * 注意：`update` 回调里收到的是**普通数据快照**（`T`），不是深层 signal，因此用 `d.user.name`
 * 而不是 `d.user.name()`。
 *
 * @example
 * ```ts
 * const state = deepSignal({ user: { name: 'Ada', age: 36 } });
 * state.user.name.set('Bob');
 * state.user.age.update((n) => n + 1);
 * state.set({ user: { name: 'Ada', age: 36 } });
 * state.update((d) => ({ user: { name: d.user.name, age: 36 } }));
 *
 * const root = state();           // { user: { name, age } }
 * const user = state.user();      // { name, age }
 * const name = state.user.name(); // string
 * ```
 */
export function deepSignal<T>(initialValue: T): WritableDeepSignal<T> {
  const s = signal(initialValue);
  return toDeepSignal(s, s as WritableSignal<unknown>, []) as WritableDeepSignal<T>;
}
