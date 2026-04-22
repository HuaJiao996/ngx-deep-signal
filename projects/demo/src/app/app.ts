import { JsonPipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  Injector,
  isSignal,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, of } from 'rxjs';
import { deepSignal } from 'ngx-deep-signal';
import { IoDemoComponent } from './io-demo';

@Component({
  selector: 'app-root',
  imports: [JsonPipe, IoDemoComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly injector = inject(Injector);

  /** 与 `IoDemoComponent` 上 `model()` 双向绑定。 */
  readonly guestDraft = signal('guest');

  /** 覆盖：用户分支、深层 settings、数组叶子、Date 叶子。 */
  readonly state = deepSignal({
    user: { name: 'Ada', age: 36 },
    settings: { theme: 'light' as 'light' | 'dark' },
    tags: ['alpha'] as string[],
    joined: new Date('2020-01-01T00:00:00.000Z'),
  });

  /** 同时依赖 name + age 的 `computed`。 */
  readonly label = computed(() => `${this.state.user.name()} · ${this.state.user.age()}`);

  /** 只读 `name` 路径 —— 改 age 时文本不变（仍为 only:Ada）。 */
  readonly nameOnly = computed(() => `only:${this.state.user.name()}`);

  /** `untracked`：age 变化不触发重算，直到 name 变化才带上最新 age。 */
  readonly untrackedLine = computed(() => {
    const name = this.state.user.name();
    const age = untracked(() => this.state.user.age());
    return `${name}:${age}`;
  });

  private readonly tick$ = new BehaviorSubject(1);
  /** `toSignal` + 深层读组合在 `computed` 中。 */
  readonly tick = toSignal(this.tick$, { initialValue: 1, injector: this.injector });
  readonly mixedTick = computed(() => `${this.state.user.name()}×${this.tick()}`);

  readonly readonlyName = this.state.user.name.asReadonly();
  readonly rootReadonly = this.state.asReadonly();

  readonly nameUpper = linkedSignal({
    source: () => this.state.user.name(),
    computation: (n) => n.toUpperCase(),
  });

  readonly nameResource = resource({
    params: () => this.state.user.name(),
    loader: ({ params }) => Promise.resolve(`hi:${params}`),
    defaultValue: 'hi:',
    injector: this.injector,
  });

  readonly nameRx = rxResource({
    params: () => this.state.user.name(),
    stream: ({ params }) => of(`rx:${params}`),
    defaultValue: 'rx:',
    injector: this.injector,
  });

  readonly signalBranding = computed(() =>
    JSON.stringify({
      root: isSignal(this.state),
      branch: isSignal(this.state.user),
      leaf: isSignal(this.state.user.name),
    }),
  );

  readonly nameEffectRuns = signal(0);

  constructor() {
    effect(() => {
      void this.state.user.name();
      this.nameEffectRuns.update((n) => n + 1);
    });
  }

  setNameBob(): void {
    this.state.user.name.set('Bob');
  }

  incAge(): void {
    this.state.user.age.update((n) => n + 1);
  }

  reset(): void {
    this.state.set({
      user: { name: 'Ada', age: 36 },
      settings: { theme: 'light' },
      tags: ['alpha'],
      joined: new Date('2020-01-01T00:00:00.000Z'),
    });
    this.guestDraft.set('guest');
  }

  /** 根 `update`：保留当前 name，把 age 拉回 36（演示 `update` 里用普通快照字段）。 */
  rootUpdateKeepNameResetAge(): void {
    this.state.update((d) => ({
      ...d,
      user: { name: d.user.name, age: 36 },
    }));
  }

  flipTheme(): void {
    this.state.settings.theme.set(this.state.settings.theme() === 'light' ? 'dark' : 'light');
  }

  appendTag(): void {
    this.state.tags.update((t) => [...t, `x${t.length}`]);
  }

  bumpJoinedYear(): void {
    this.state.joined.update((d) => new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())));
  }

  incTick(): void {
    this.tick$.next(this.tick() + 1);
  }
}
