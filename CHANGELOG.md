# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `peek(signalRef)` — read a signal's current value without creating a reactive dependency. Useful for logging, conditional reads inside `computed`/`effect`, and one-off snapshots.
- `updateAtPath(target, path, updater)` — mutate a deep signal at an arbitrary path using an updater function. Works on leaf paths, branch paths, and root (empty path).
- `toReadonlyDeepSignal(target)` — converts a writable `WritableDeepSignal<T>` to a fully read-only `ReadonlyDeepSignal<T>`. All `set`/`update` operations are removed from the type.
- `ReadonlyDeepSignal<T>` — new exported type for read-only deep signal trees.
- `DeepValue<T, P>` — utility type that extracts the value type at path `P` from type `T`.
- `DEEP_SIGNAL_MARKER` symbol internal — attached to lazily-created computed signals for stale entry cleanup.
- `hasMarker()` helper — narrows values that have the DEEP_SIGNAL_MARKER attached.
- `attachMarker()` helper — attaches the DEEP_SIGNAL_MARKER to computed signals.
- `peek` unit tests — covers signal, computed, getter function, and non-tracking behavior.
- `updateAtPath` unit tests — covers leaf/branch/root paths, 3+ level nesting, array item updates, reactive tracking, and sibling isolation.
- `batch` unit tests — coalescing behavior, last-write-wins, nested batching, effect runs, error rollback.
- `toReadonlyDeepSignal` unit tests — covers reactive tracking, read at every path, and `asReadonly` chaining.
- Edge case tests — Map, Set, deep nested arrays, null-prototype objects, optional properties, tuple types, readonly arrays, branch replacement propagation, stale computed cleanup after `set()`.
- Type inference tests — compile-time validation of leaf types, readonly surface, branch `isSignal` branding.
- E2E tests for `peek` and `updateAtPath` in the demo app.
- Demo sections showcasing all new APIs with interactive buttons.
- `CONTRIBUTING.md` — contribution guidelines.

### Changed
- Internal refactoring of `deep-signal.ts` — grouped code into logical sections with clear comments (public types, runtime type guards, path utilities, linked writable leaf, deep proxy factory, batching, public API).
- `batch()` function added — coalesces multiple leaf writes into a single root update to avoid redundant re-computations. Supports nested batching and error-safe rollback.
- `scheduleBatchedRootUpdate()` internal helper — routes leaf writes through the batch scheduler.
- `batchDepth` and `pendingRootUpdate` module-level state — supports safe nested batch calls.
- Renamed `DEEP_SIGNAL` symbol to `DEEP_SIGNAL_MARKER` for clarity.
- Updated `lib/public-api.ts` to export `batch`.
- Updated `README.md` and `README_zh.md` with API table, batch usage examples, and expanded Angular Signal coverage list.
- Removed `JsonPipe` import from demo app (unused).

### Fixed
- Stale computed entries are now cleaned up when the root signal's shape changes (via `set()`), preventing memory leaks and stale dependencies.
- Proxy `get` handler now properly passes through Angular-internal symbols and non-string/symbol properties.
- `Object.defineProperty` on proxy target now uses `configurable: true` to allow subsequent cleanup via `delete`.

## [0.0.3] — 2025-05-18

### Added
- Initial release: `deepSignal` and `WritableDeepSignal` for Angular.
- Granular reactive subscriptions per deep path.
- Writable leaf signals with `set` / `update`.
- Root `set` / `update` for whole-tree replacement.
- Snapshots at root / branch / leaf levels via `()`.
- `asReadonly()` at root and leaf levels.
- `linkedSignal` integration with deep leaf sources.
- `computed`, `effect`, `untracked`, `isSignal` coverage.
- `toSignal` / `toObservable` / `resource` / `rxResource` integration.
- `takeUntilDestroyed` integration.
- Angular 21 support with ng-packagr build.
- Demo app under `projects/demo/`.
- Playwright E2E tests under `e2e/`.
- Vitest unit tests with v8 coverage.