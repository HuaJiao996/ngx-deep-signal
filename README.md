## ngx-deep-signal

**中文** [`README_zh.md`](README_zh.md)

**Deep / nested writable signals** for Angular: reading `state.user.name()` only subscribes to that path, so updates to sibling fields (e.g. `state.user.age`) do not invalidate consumers that only read `name`. Leaf fields expose `WritableSignal`-style `set` / `update`; replacing whole branches still uses the root `set` / `update`.

Public API: `deepSignal`, type `WritableDeepSignal` (see `lib/public-api.ts`).

## Requirements

- Node.js and npm (see `packageManager` in root `package.json`)
- [Angular CLI](https://angular.dev/tools/cli) 21.x (dev dependency)
- For E2E: install Playwright browsers once (Chromium is enough for the default config):

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
import { computed, effect, linkedSignal, untracked } from '@angular/core';
import { deepSignal } from 'ngx-deep-signal';

const state = deepSignal({ user: { name: 'Ada', age: 36, tags: ['dev'] as string[] } });

// Writable leaves
state.user.name.set('Bob');
state.user.age.update((n) => n + 1);
state.user.tags.update((tags) => [...tags, 'signal']);

// Whole tree
state.set({ user: { name: 'Ada', age: 36, tags: ['dev'] } });
state.update((d) => ({ user: { ...d.user, age: 18 } }));
// In `update`, `d` is a plain snapshot of `T`, not a deep signal — use `d.user.name`, not `d.user.name()`.

// Snapshots at any level (Signal call)
const root = state();           // { user: { name, age, tags } }
const user = state.user();      // { name, age, tags }
const name = state.user.name(); // string

// Angular Signal usage with deepSignal
const nameView = computed(() => state.user.name());
const ageUntracked = computed(() => `${state.user.name()}-${untracked(() => state.user.age())}`);

effect(() => {
  console.log('Name changed:', state.user.name());
});

const readonlyName = state.user.name.asReadonly();
const rootView = state.asReadonly();

// In app code, create `linkedSignal` inside an injection context (e.g. constructor / `inject` field initializer).
const alias = linkedSignal({
  source: () => state.user.name(),
  computation: (name) => name.toUpperCase(),
});
```

Nested **records** are split by key; arrays, `Date`, `Map`, etc. are treated as **leaf** values (same idea as NgRx deep signals).

### Return type

`deepSignal({ user: { name: 'Ada', age: 36 } })` is typed as:

```ts
WritableSignal<{
  user: WritableSignal<{
    name: WritableSignal<string>;
    age: WritableSignal<number>;
  }>;
}>
```

i.e. the root and every known-record branch are themselves `WritableSignal` of the same shape, recursively. Leaves (`Date`, arrays, primitives) are `WritableSignal<leafType>`.

### RxJS interop and `resource` (experimental)

```ts
import { Injector, computed, inject, resource } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, of } from 'rxjs';

const injector = inject(Injector);
const n$ = new BehaviorSubject(1);
const n = toSignal(n$, { initialValue: 0, injector });

const res = resource({
  params: () => state.user.name(),
  loader: ({ params }) => Promise.resolve(`hi:${params}`),
  defaultValue: 'hi:',
  injector,
});

const name$ = toObservable(computed(() => state.user.name()), { injector });
const rxRes = rxResource({
  params: () => state.user.name(),
  stream: ({ params }) => of(`rx:${params}`),
  defaultValue: 'rx:',
  injector,
});
```

`resource` is **experimental** in Angular; `afterRenderEffect` is browser-oriented and is **not** covered here (unit tests run under jsdom/Node).

## Angular Signal APIs covered by tests

- `WritableSignal#set` and `WritableSignal#update` (leaf and root)
- `WritableSignal#asReadonly` (root and nested leaves)
- `computed` (single-path granularity, multiple tracked leaves, and `equal` to suppress downstream updates)
- `effect` (with `TestBed.runInInjectionContext` + `TestBed.tick()`), including `onCleanup` when `EffectRef#destroy` is called
- `EffectRef#destroy` to stop an effect
- `linkedSignal` with a deep leaf as `source`
- `untracked`
- `isSignal` on the root and branch proxies (linked leaves implement `WritableSignal` but may not pass `isSignal`)
- `toSignal` / `toObservable` from `@angular/core/rxjs-interop` (deep path reads via `computed` bridge where needed)
- `takeUntilDestroyed` tied to a host `DestroyRef` with `toObservable`
- `firstValueFrom` on `toObservable` for a deep leaf
- `resource` with a deep leaf as reactive `params` (async `loader`)
- `rxResource` with `stream` as `Observable` keyed by a deep leaf
- signal read `()` at root / branch / leaf levels
- `Date` treated as a writable leaf (`NonRecord`)

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

The demo includes `projects/demo/src/app/io-demo.ts`, a child component using **`input()`**, **`output()`**, and **`model()`** together with the parent’s `deepSignal` (`[displayName]="state.user.name()"`, `(rename)` → `state.user.name.set`, `[(guest)]` ↔ parent `guestDraft` signal).

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

| Path | Role |
|------|------|
| `lib/` | Library source, unit tests, ng-packagr / tsconfig configs |
| `projects/demo/` | Demo Angular app (`ng serve demo`) |
| `e2e/` | Playwright end-to-end specs |
| `playwright.config.ts` | Playwright configuration |
| `dist/ngx-deep-signal/` | Packaged library after `ng build` / `npm run build` |
| `dist/demo/` | Demo app production build after `ng build demo` |
