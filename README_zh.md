## ngx-deep-signal（中文）

英文说明见同目录 [`README.md`](README.md)。

**深层 / 嵌套可写 Signal**：读 `state.user.name()` 时，依赖方只订阅该路径；改兄弟字段（如 `state.user.age`）不会让只读 `name` 的 `computed` / `effect` 重复执行。叶子字段提供与 `WritableSignal` 一致的 `set` / `update`；整枝替换仍通过根的 `set` / `update` 完成。

对外导出：`deepSignal`、类型 `WritableDeepSignal`（见 `lib/public-api.ts`）。

## 环境

- Node.js 与 npm（版本见根目录 `package.json` 的 `packageManager`）
- Angular CLI 21.x（作为开发依赖）
- E2E：至少安装 Chromium（与默认 `playwright.config.ts` 一致）：

```bash
npx playwright install chromium
```

## 安装

本地可先 `ng build`，再通过 `file:` 指向 `dist/ngx-deep-signal`；或发布到 npm 后直接安装：

```bash
npm install ngx-deep-signal
```

## 用法

```ts
import { computed, effect, linkedSignal, untracked } from '@angular/core';
import { deepSignal } from 'ngx-deep-signal';

const state = deepSignal({ user: { name: 'Ada', age: 36, tags: ['dev'] as string[] } });

// 叶子可写
state.user.name.set('Bob');
state.user.age.update((n) => n + 1);
state.user.tags.update((tags) => [...tags, 'signal']);

// 整棵树替换
state.set({ user: { name: 'Ada', age: 36, tags: ['dev'] } });
state.update((d) => ({ user: { ...d.user, age: 18 } }));
// `update` 回调里的 `d` 是当前值的普通快照（类型 `T`），不是深层 signal，因此写 `d.user.name`，不要写 `d.user.name()`。

// 任意层级用 `()` 取快照
const root = state();           // { user: { name, age, tags } }
const user = state.user();      // { name, age, tags }
const name = state.user.name(); // string

// 与 Angular Signal API 组合使用
const nameView = computed(() => state.user.name());
const ageUntracked = computed(() => `${state.user.name()}-${untracked(() => state.user.age())}`);

effect(() => {
  console.log('name changed:', state.user.name());
});

const readonlyName = state.user.name.asReadonly();
const rootView = state.asReadonly();

// 在应用代码里，`linkedSignal` 需在注入上下文中创建（如构造函数、`inject` 字段初始化器）。
const alias = linkedSignal({
  source: () => state.user.name(),
  computation: (name) => name.toUpperCase(),
});
```

对**普通对象**按 key 拆分；数组、`Date`、`Map` 等视为**叶子**整体（与 NgRx 侧 `DeepSignal` 的常见约定一致）。

### 返回类型

`deepSignal({ user: { name: 'Ada', age: 36 } })` 的类型为：

```ts
WritableSignal<{
  user: WritableSignal<{
    name: WritableSignal<string>;
    age: WritableSignal<number>;
  }>;
}>
```

即根与每个「已知普通对象」分支都是同构的 `WritableSignal`，递归嵌套；叶子（`Date`、数组、原始类型等）是 `WritableSignal<叶子类型>`。

### RxJS 互操作与 `resource`（实验性）

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

`resource` 在 Angular 中仍为**实验性** API；`afterRenderEffect` 偏浏览器渲染周期，本库单测在 **jsdom/Node** 下**未覆盖**。

## 测试已覆盖的 Angular Signal 用法

- `WritableSignal#set`、`WritableSignal#update`（叶子与根）
- `WritableSignal#asReadonly`（根与嵌套叶子）
- `computed`（单路径粒度、多叶子、`equal` 抑制下游无效刷新）
- `effect`（`TestBed.runInInjectionContext` + `TestBed.tick()`），含 `onCleanup` 与 `EffectRef#destroy`
- `EffectRef#destroy` 停止后续调度
- `linkedSignal`，以深层叶子为 `source`
- `untracked`
- `isSignal`：根与分支代理为 `true`；链式叶子具备 `WritableSignal` 接口但**未必**通过 `isSignal`（见单测说明）
- `@angular/core/rxjs-interop` 的 `toSignal`、`toObservable`（必要时用 `computed` 包一层深层读）
- `takeUntilDestroyed` 与宿主 `DestroyRef` + `toObservable` 组合
- `firstValueFrom` 读取 `toObservable` 的首个深层叶子值
- `resource`：深层叶子作为响应式 `params` + 异步 `loader`
- `rxResource`：`stream` 为 `Observable`，由深层叶子驱动 `params`
- 根 / 分支 / 叶子三级 `()` 读取
- `Date` 作为可写叶子（`NonRecord`）

对应示例见 `lib/deep-signal.spec.ts`。

## 构建

```bash
npm run build
# 或
ng build ngx-deep-signal
```

构建结果在目录 `dist/ngx-deep-signal/`。

## 单元测试

使用 **Vitest**（Angular 单元测试构建器）；覆盖率使用 **`@vitest/coverage-v8`**。

```bash
npm test
# 单次执行（CI 模式）
ng test ngx-deep-signal --no-watch
```

覆盖率（终端摘要 + `lcov` + HTML，输出目录 `coverage/ngx-deep-signal/`）：

```bash
npm run test:coverage
```

## 示例应用（演示）

独立应用位于 `projects/demo/`，通过根目录 `tsconfig.json` 的 `paths` 引用已构建的包 `dist/ngx-deep-signal`。

```bash
npm start
```

会先执行 `ng build ngx-deep-signal`，再 `ng serve demo`（见 `package.json` 的 `prestart`）。生产构建：`npm run build:demo`，产物在 `dist/demo/`。

演示里包含子组件 `projects/demo/src/app/io-demo.ts`，使用 **`input()`**、**`output()`**、**`model()`**：`[displayName]` 绑定父级深层 `state.user.name()`，`output` 写回 `state.user.name.set`，`[(guest)]` 与父级 `guestDraft` 信号双向同步。

## E2E 测试（Playwright）

使用 [`playwright-ng-schematics`](https://www.npmjs.com/package/playwright-ng-schematics) 与 [`@playwright/test`](https://playwright.dev/)。用例在 `e2e/`；配置为根目录 `playwright.config.ts`。`angular.json` 里 `demo` 项目的 `e2e` 会拉起 `demo:serve`，对 `http://localhost:4200` 跑 Playwright。

```bash
npm run e2e
```

带 UI 的调试模式：

```bash
npm run e2e:ui
```

## 开发时监听构建

```bash
npm run watch
```

## 发布到 npm

```bash
cd dist/ngx-deep-signal
npm publish
```

发布前请在 `lib/package.json` 设置合适的 `version`。

## 目录结构

| 路径 | 说明 |
|------|------|
| `lib/` | 库源码、单元测试与 ng-packagr / tsconfig 配置 |
| `projects/demo/` | 演示用 Angular 应用（`ng serve demo`） |
| `e2e/` | Playwright 端到端用例 |
| `playwright.config.ts` | Playwright 配置 |
| `dist/ngx-deep-signal/` | `npm run build` / `ng build ngx-deep-signal` 后的库产物 |
| `dist/demo/` | `ng build demo` 后的演示应用产物 |
