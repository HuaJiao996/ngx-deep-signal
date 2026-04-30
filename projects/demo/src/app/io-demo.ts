import { Component, input, model, output } from '@angular/core';

/**
 * 演示 Angular 的 `input` / `output` / `model` 与父级 `deepSignal` 组合：
 * - `input`：展示父组件深层 `state.user.name()`；
 * - `output`：通过事件让父组件写回 `state.user.name`；
 * - `model`：与父级 `WritableSignal` 双向绑定（父用 `signal`，模板 `[(guest)]`）。
 */
@Component({
  selector: 'app-io-demo',
  standalone: true,
  template: `
    <p>
      <code>input</code>（父级深层 name）→
      <span data-testid="io-display-name">{{ displayName() }}</span>
    </p>
    <button type="button" data-testid="io-emit-rename" (click)="rename.emit('Lin')">
      <code>output</code>：改名为 Lin
    </button>
    <p class="row">
      <label for="io-guest-input"><code>model</code> 双向</label>
      <input
        id="io-guest-input"
        data-testid="io-guest-input"
        type="text"
        [value]="guest()"
        (input)="guest.set($any($event.target).value)"
      />
    </p>
    <p data-testid="io-guest-local">子视图：{{ guest() }}</p>
  `,
  styles: `
    :host {
      display: block;
    }
    .row {
      margin: 0.75rem 0 0.25rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    label {
      font-weight: 600;
    }
    input {
      min-width: 12rem;
      padding: 0.35rem 0.5rem;
    }
  `,
})
export class IoDemoComponent {
  displayName = input.required<string>();
  rename = output<string>();
  guest = model<string>('guest');
}
