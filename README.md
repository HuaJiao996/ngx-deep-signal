# ngx-deep-signal

**[中文说明](README_zh.md)** | **Deep / nested writable signals** for Angular.

Reading `state.user.name()` only subscribes to that specific path — updates to sibling
fields (e.g. `state.user.age`) do **not** invalidate consumers that only read `name`.
Leaf fields expose `WritableSignal`-style `set` / `update`; replacing whole branches
uses the root `set` / `update`.

## Public API

| Export                            | Description                                            |
| --------------------------------- | ------------------------------------------------------ |
| `deepSignal(initialValue)`        | Creates a deep writable signal tree                    |
| `peek(signalRef)`                 | Reads without creating a reactive dependency           |
| `updateAtPath(ds, path, updater)` | Mutates a path via an updater function                 |
| `toReadonlyDeepSignal(ds)`        | Converts a writable deep signal to fully read-only     |
| `batch(fn)`                       | Batches multiple leaf writes into a single root update |
| `WritableDeepSignal<T>`           | Type for writable deep signal trees                    |
| `ReadonlyDeepSignal<T>`           | Type for read-only deep signal trees                   |
| `DeepValue<T, P>`                 | Utility type: value at path `P` from type `T`          |

## Requirements

- Node.js and npm (see `packageManager` in root `package.json`)
- [Angular CLI](https://angular.dev/tools/cli) 21.x (dev dependency)
- For E2E: install Playwright browsers once:

```bash
npx playwright install chromium
```

## Install

After building, consume from `dist/ngx-deep-signal` (`file:../dist/ngx-deep-signal`), or publish to npm:

```bash
npm install ngx-deep-signal
```

## Usage

```ts
import { computed, effect, linkedSignal, untracked } from "@angular/core";
import { deepSignal, peek, updateAtPath, toReadonlyDeepSignal, batch } from "ngx-deep-signal";

const state = deepSignal({ user: { name: "Ada", age: 36, tags: ["dev"] as string[] } });
```

### Writable leaf operations

```ts
state.user.name.set("Bob");
state.user.age.update((n) => n + 1);
state.user.tags.update((tags) => [...tags, "signal"]);
```

### Whole-tree operations

```ts
state.set({ user: { name: "Ada", age: 36, tags: ["dev"] } });
state.update((d) => ({ user: { ...d.user, age: 18 } }));
// In `update`, `d` is a plain snapshot of T, NOT a deep signal — use `d.user.name`, not `d.user.name()`.
```

### Snapshots at any level

```ts
const root = state(); // { user: { name, age, tags } }
const user = state.user(); // { name, age, tags }
const name = state.user.name(); // string
```

### Non-reactive read with `peek`

```ts
const name = peek(state.user.name); // 'Ada' — no dependency tracked
const snapshot = peek(() => state.user()); // { name: 'Ada', ... } — also works with a getter
```

### Path-based updates with `updateAtPath`

```ts
// Update a leaf at an arbitrary path
updateAtPath(state, ["user", "name"], (n) => n.toUpperCase()); // state.user.name() === 'ADA'

// Update a branch at an intermediate path
updateAtPath(state, ["user"], (u) => ({ ...u, age: 40 }));

// Full root update with empty path
updateAtPath(state, [], () => ({ user: { name: "Lin", age: 18 } }));

// Update array items by index
updateAtPath(state, ["items", "0", "label"], (l) => l.toUpperCase());
```

### Readonly conversion

```ts
const readonly = toReadonlyDeepSignal(state);
console.log(readonly.user.name()); // 'Ada'
// readonly.user.name.set('Bob'); // compile error — not available

// also available as `.asReadonly()` on any path
const readonlyName = state.user.name.asReadonly();
const rootReadonly = state.asReadonly();

// batch: coalesce multiple leaf writes into a single root update
batch(() => {
  state.user.name.set("Bob");
  state.user.age.set(40);
  state.user.name.set("Lin"); // last write wins
});
// Only one root update fires — computed/effect sees final snapshot
```

### Angular Signal APIs

```ts
const nameView = computed(() => state.user.name());
const ageUntracked = computed(() => `${state.user.name()}-${untracked(() => state.user.age())}`);

effect(() => {
  console.log("Name changed:", state.user.name());
});

// linkedSignal inside injection context
const alias = linkedSignal({
  source: () => state.user.name(),
  computation: (name) => name.toUpperCase(),
});
```

### RxJS interop and `resource` (experimental)

```ts
import { Injector, computed, inject, resource } from "@angular/core";
import { rxResource, toObservable, toSignal } from "@angular/core/rxjs-interop";
import { BehaviorSubject, of } from "rxjs";

const injector = inject(Injector);
const n$ = new BehaviorSubject(1);
const n = toSignal(n$, { initialValue: 0, injector });

const res = resource({
  params: () => state.user.name(),
  loader: ({ params }) => Promise.resolve(`hi:${params}`),
  defaultValue: "hi:",
  injector,
});

const name$ = toObservable(
  computed(() => state.user.name()),
  { injector },
);
const rxRes = rxResource({
  params: () => state.user.name(),
  stream: ({ params }) => of(`rx:${params}`),
  defaultValue: "rx:",
  injector,
});
```

`resource` is **experimental** in Angular.

## Return type

`deepSignal({ user: { name: 'Ada', age: 36 } })` is typed as:

```ts
WritableSignal<{
  user: WritableSignal<{
    name: WritableSignal<string>;
    age: WritableSignal<number>;
  }>;
}>;
```

`toReadonlyDeepSignal(state)` returns:

```ts
ReadonlyDeepSignal<{
  user: ReadonlyDeepSignal<{
    name: Signal<string>; // no set/update
    age: Signal<number>; // no set/update
  }>;
}>;
```

## Type system: what gets deep-split?

- **Plain objects with known keys** → recursively split into sub-signals
- **Records with index signatures** (`Record<string, unknown>`) → treated as a leaf (not expanded)
- **Non-dictionary built-ins** → treated as leaves: `Array`, `Date`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Promise`, `Error`, `RegExp`, `ArrayBuffer`, `DataView`, `Function`

## Angular Signal APIs covered by tests

- `WritableSignal#set` and `WritableSignal#update` (leaf and root)
- `WritableSignal#asReadonly` (root and nested leaves)
- `computed` (single-path granularity, multiple tracked leaves, and `equal` to suppress downstream updates)
- `effect` (with `TestBed.runInInjectionContext` + `TestBed.tick()`), including `onCleanup` when `EffectRef#destroy` is called
- `EffectRef#destroy` to stop an effect
- `linkedSignal` with a deep leaf as `source`
- `untracked`
- `isSignal` on the root and branch proxies
- `toSignal` / `toObservable` from `@angular/core/rxjs-interop`
- `takeUntilDestroyed` tied to a host `DestroyRef` with `toObservable`
- `firstValueFrom` on `toObservable` for a deep leaf
- `resource` with a deep leaf as reactive `params`
- `rxResource` with `stream` as `Observable` keyed by a deep leaf
- Signal read `()` at root / branch / leaf levels
- `Date`, `Map`, `Set` treated as writable leaves
- `peek` without creating dependencies
- `updateAtPath` at leaf / branch / root levels
- `toReadonlyDeepSignal` reactive tracking

See `lib/deep-signal.spec.ts` for examples.

## Build

```bash
npm run build
# or
ng build ngx-deep-signal
```

Output: `dist/ngx-deep-signal/`.

## Unit tests

[Vitest](https://vitest.dev/) via Angular's unit-test builder; coverage uses [`@vitest/coverage-v8`](https://vitest.dev/guide/coverage.html).

```bash
npm test
# CI-style
ng test ngx-deep-signal --no-watch
```

Coverage (text + summary + `lcov` + HTML under `coverage/ngx-deep-signal/`):

```bash
npm run test:coverage
```

## Demo application

Standalone app under `projects/demo/` that imports the built package `ngx-deep-signal` from `dist/ngx-deep-signal` (path mapping in root `tsconfig.json`).

```bash
npm start
```

Runs `ng build ngx-deep-signal` then `ng serve demo` (see `prestart` in `package.json`). Production bundle: `npm run build:demo` → `dist/demo/`.

The demo includes `projects/demo/src/app/io-demo.ts`, a child component using **`input()`**, **`output()`**, and **`model()`** together with the parent's `deepSignal`.

## E2E tests (Playwright)

Uses [`playwright-ng-schematics`](https://www.npmjs.com/package/playwright-ng-schematics) with [`@playwright/test`](https://playwright.dev/). Specs live in `e2e/`; config is `playwright.config.ts`. The `e2e` target on the `demo` project in `angular.json` starts `demo:serve` and runs Playwright against `http://localhost:4200`.

```bash
npm run e2e
```

Interactive UI mode:

```bash
npm run e2e:ui
```

## Watch build (development)

```bash
npm run watch
```

## Publish (npm)

```bash
cd dist/ngx-deep-signal
npm publish
```

Adjust `version` in `lib/package.json` before building if needed.

## Repository layout

| Path                    | Role                                                      |
| ----------------------- | --------------------------------------------------------- |
| `lib/`                  | Library source, unit tests, ng-packagr / tsconfig configs |
| `projects/demo/`        | Demo Angular app (`ng serve demo`)                        |
| `e2e/`                  | Playwright end-to-end specs                               |
| `playwright.config.ts`  | Playwright configuration                                  |
| `dist/ngx-deep-signal/` | Packaged library after `ng build` / `npm run build`       |
| `dist/demo/`            | Demo app production build after `ng build demo`           |
