# Contributing to ngx-deep-signal

Thank you for your interest in contributing! This guide covers everything you need to know to get started.

## Getting started

### Prerequisites

- Node.js (version matching `package.json`'s `packageManager` field)
- npm
- Angular CLI 21.x (`npm install -g @angular/cli@21`)
- Playwright browsers for E2E: `npx playwright install chromium`

### Setup

```bash
# Clone the repository
git clone https://github.com/HuaJiao996/ngx-deep-signal
cd ngx-deep-signal

# Install dependencies
npm install

# Build the library (required before running demo or tests)
npm run build
```

## Workflow

### Working on the library

Source is in `lib/`. Edit `lib/deep-signal.ts` for the core implementation
and `lib/deep-signal.spec.ts` for unit tests.

```bash
# Run unit tests (Vitest, watch mode)
npm test

# Run once (CI mode)
ng test ngx-deep-signal --no-watch

# Coverage report
npm run test:coverage
```

### Working on the demo

```bash
# Build library + serve demo (dev server on port 4200)
npm start

# Run E2E against the demo
npm run e2e

# Interactive E2E
npm run e2e:ui
```

### Running everything in sequence

```bash
npm run build && npm run test && npm run e2e
```

## Code conventions

- **No `console.log`** in production code (use Angular's `Injector` logging or remove before commit).
- **Prettier** runs on commit (via `package.json` `prettier` overrides for `.html` files).
- **No magic numbers** — extract meaningful constants.
- **Tests must be self-contained** — each `it` block sets up its own state.
- **Descriptive test names** — follow the pattern: "it does X when Y".

## Writing tests

### Unit tests (`lib/deep-signal.spec.ts`)

Use Vitest + Angular's `TestBed`. Every public API function needs a test
covering the happy path and at least one edge case.

```ts
describe("myNewFunction", () => {
  it("behaves correctly in the normal case", () => {
    const state = deepSignal({ user: { name: "Ada", age: 36 } });
    // assert...
  });

  it("handles edge case X", () => {
    // ...
  });
});
```

### E2E tests (`e2e/demo.spec.ts`)

Use Playwright. Each test should:

1. Navigate to `/`
2. Assert initial state
3. Trigger an action
4. Assert the outcome

## Adding new public API

1. Add the implementation to `lib/deep-signal.ts`
2. Export it from `lib/public-api.ts`
3. Write unit tests in `lib/deep-signal.spec.ts`
4. Add a demo section in `projects/demo/src/app/app.ts` + `app.html`
5. Add E2E tests in `e2e/demo.spec.ts`
6. Update `README.md` and `README_zh.md`
7. Add a changelog entry in `CHANGELOG.md`

## Architecture notes

### How deep signals work

`deepSignal(obj)` creates an Angular `signal(obj)` and wraps it in a recursive `Proxy`.
When you access a property:

1. The Proxy `get` handler is called.
2. If the current snapshot value is a **record** (plain object with known keys), a
   new `computed` is lazily created for that property and cached on the proxy target.
   The computed is marked with `DEEP_SIGNAL_MARKER`. The handler then recurses.
3. If the value is a **leaf** (primitive, Date, array, etc.), a linked writable signal
   is created: reads go through the pre-computed signal (tracked), writes call
   `root.update()` with an immutable `setAtPath` call.

This means:

- Reading `state.user.name()` subscribes only to the `name` computed → granular reactivity.
- Writing `state.user.name.set('Bob')` calls `root.update(s => setAtPath(s, ['user', 'name'], 'Bob'))`
  → immutable, efficient.

### Type system

`IsKnownRecord<T>` determines whether `T` should be deep-split:

- `IsRecord<T>` — `T extends object` but not in the `NonRecord` list.
- `IsUnknownRecord<T>` — `T` has an index signature (`string extends keyof T`) or
  `keyof T extends never`. These are treated as opaque leaves.

`WritableDeepSignal<T>` and `ReadonlyDeepSignal<T>` are intersection types that add
nested property access to `Signal<T>` / `WritableSignal<T>`.

## Filing issues

Please include:

- Angular version
- ngx-deep-signal version
- A minimal reproduction (StackBlitz or repo snippet)
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
