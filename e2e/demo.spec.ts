import { expect, test } from '@playwright/test';

test.describe('demo app - basics', () => {
  test('shows initial deep state', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/ngx-deep-signal demo/);
    await expect(page.getByTestId('heading')).toHaveText('ngx-deep-signal demo');
    await expect(page.getByTestId('name')).toHaveText('Ada');
    await expect(page.getByTestId('age')).toHaveText('36');
    await expect(page.getByTestId('label')).toHaveText('Ada · 36');
    await expect(page.getByTestId('snapshot')).toContainText('"name": "Ada"');
  });

  test('updates nested leaf name', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-name').click();
    await expect(page.getByTestId('name')).toHaveText('Bob');
    await expect(page.getByTestId('label')).toHaveText('Bob · 36');
    await expect(page.getByTestId('snapshot')).toContainText('"name": "Bob"');
  });

  test('updates nested leaf age', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-age').click();
    await expect(page.getByTestId('age')).toHaveText('37');
    await expect(page.getByTestId('label')).toHaveText('Ada · 37');
  });

  test('resets whole tree from root', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-name').click();
    await page.getByTestId('btn-age').click();
    await expect(page.getByTestId('name')).toHaveText('Bob');
    await expect(page.getByTestId('age')).toHaveText('37');

    await page.getByTestId('btn-reset').click();
    await expect(page.getByTestId('name')).toHaveText('Ada');
    await expect(page.getByTestId('age')).toHaveText('36');
    await expect(page.getByTestId('label')).toHaveText('Ada · 36');
  });

  test('root update: keep name, reset age to 36', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-name').click();
    await page.getByTestId('btn-age').click();
    await expect(page.getByTestId('age')).toHaveText('37');

    await page.getByTestId('btn-root-update').click();
    await expect(page.getByTestId('name')).toHaveText('Bob');
    await expect(page.getByTestId('age')).toHaveText('36');
    await expect(page.getByTestId('label')).toHaveText('Bob · 36');
  });
});

test.describe('branch snapshot', () => {
  test('state.user() reflects both leaves', async ({ page }) => {
    await page.goto('/');
    const json = page.getByTestId('branch-user');
    await expect(json).toContainText('"name": "Ada"');
    await expect(json).toContainText('"age": 36');

    await page.getByTestId('btn-name').click();
    await page.getByTestId('btn-age').click();
    await expect(json).toContainText('"name": "Bob"');
    await expect(json).toContainText('"age": 37');
  });
});

test.describe('deep path (settings.theme)', () => {
  test('toggles 3-level leaf', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('theme')).toHaveText('light');
    await page.getByTestId('btn-theme').click();
    await expect(page.getByTestId('theme')).toHaveText('dark');
    await page.getByTestId('btn-theme').click();
    await expect(page.getByTestId('theme')).toHaveText('light');
  });
});

test.describe('array and date leaves', () => {
  test('appends items to array leaf', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tags')).toHaveText('alpha');
    await page.getByTestId('btn-tag').click();
    await expect(page.getByTestId('tags')).toHaveText('alpha,x1');
    await page.getByTestId('btn-tag').click();
    await expect(page.getByTestId('tags')).toHaveText('alpha,x1,x2');
  });

  test('updates Date leaf immutably', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('joined')).toHaveText('2020-01-01T00:00:00.000Z');
    await page.getByTestId('btn-joined').click();
    await expect(page.getByTestId('joined')).toHaveText('2021-01-01T00:00:00.000Z');
  });
});

test.describe('computed granularity and untracked', () => {
  test('name-only is unaffected by age changes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('name-only')).toHaveText('only:Ada');
    await page.getByTestId('btn-age').click();
    await expect(page.getByTestId('name-only')).toHaveText('only:Ada');
    await page.getByTestId('btn-name').click();
    await expect(page.getByTestId('name-only')).toHaveText('only:Bob');
  });

  test('untracked keeps stale age until tracked leaf changes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('untracked-line')).toHaveText('Ada:36');

    // age 不是被 track 的依赖，line 不会因其改变而刷新
    await page.getByTestId('btn-age').click();
    await expect(page.getByTestId('untracked-line')).toHaveText('Ada:36');

    // 改 name（被 track 的路径）→ 重新读最新 age
    await page.getByTestId('btn-name').click();
    await expect(page.getByTestId('untracked-line')).toHaveText('Bob:37');
  });
});

test.describe('toSignal + deep read', () => {
  test('mixed-tick reacts to BehaviorSubject and deep name', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('mixed-tick')).toHaveText('Ada×1');

    await page.getByTestId('btn-tick').click();
    await expect(page.getByTestId('mixed-tick')).toHaveText('Ada×2');

    await page.getByTestId('btn-name').click();
    await expect(page.getByTestId('mixed-tick')).toHaveText('Bob×2');
  });
});

test.describe('linkedSignal', () => {
  test('uppercases deep name', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('name-upper')).toHaveText('ADA');
    await page.getByTestId('btn-name').click();
    await expect(page.getByTestId('name-upper')).toHaveText('BOB');
  });
});

test.describe('asReadonly', () => {
  test('leaf asReadonly tracks updates', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('readonly-name')).toHaveText('Ada');
    await page.getByTestId('btn-name').click();
    await expect(page.getByTestId('readonly-name')).toHaveText('Bob');
  });

  test('root asReadonly serializes full tree', async ({ page }) => {
    await page.goto('/');
    const pre = page.getByTestId('root-readonly');
    await expect(pre).toContainText('"name": "Ada"');
    await expect(pre).toContainText('"theme": "light"');
    await page.getByTestId('btn-theme').click();
    await expect(pre).toContainText('"theme": "dark"');
  });
});

test.describe('effect granularity', () => {
  test('effect runs only when tracked name changes', async ({ page }) => {
    await page.goto('/');
    const runs = page.getByTestId('name-effect-runs');
    // 初始运行 1 次
    await expect(runs).toHaveText('1');

    // 改 age：effect 只 track name，不应再跑
    await page.getByTestId('btn-age').click();
    await expect(runs).toHaveText('1');

    // 改 name：跑第 2 次
    await page.getByTestId('btn-name').click();
    await expect(runs).toHaveText('2');
  });
});

test.describe('isSignal branding', () => {
  test('root/branch are signals; linked leaf is not', async ({ page }) => {
    await page.goto('/');
    const branding = page.getByTestId('signal-branding');
    await expect(branding).toContainText('"root":true');
    await expect(branding).toContainText('"branch":true');
    await expect(branding).toContainText('"leaf":false');
  });
});

test.describe('resource (experimental) / rxResource', () => {
  test('resource loader resolves and reloads on deep leaf change', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('res-loader')).toHaveText('hi:Ada');
    await page.getByTestId('btn-name').click();
    await expect(page.getByTestId('res-loader')).toHaveText('hi:Bob');
  });

  test('rxResource stream emits and reloads on deep leaf change', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('rx-value')).toHaveText('rx:Ada');
    await page.getByTestId('btn-name').click();
    await expect(page.getByTestId('rx-value')).toHaveText('rx:Bob');
  });
});

test.describe('input / output / model', () => {
  test('input mirrors deep leaf name', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('io-display-name')).toHaveText('Ada');
    await page.getByTestId('btn-name').click();
    await expect(page.getByTestId('io-display-name')).toHaveText('Bob');
  });

  test('output sets deep leaf name', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('io-emit-rename').click();
    await expect(page.getByTestId('name')).toHaveText('Lin');
    await expect(page.getByTestId('io-display-name')).toHaveText('Lin');
  });

  test('model two-way syncs parent and child', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('parent-guest-draft')).toHaveText('guest');
    await expect(page.getByTestId('io-guest-local')).toHaveText('子视图：guest');

    const input = page.getByTestId('io-guest-input');
    await input.fill('playwright');
    await expect(page.getByTestId('parent-guest-draft')).toHaveText('playwright');
    await expect(page.getByTestId('io-guest-local')).toHaveText('子视图：playwright');
  });

  test('reset restores guestDraft from model section', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('io-guest-input').fill('x');
    await expect(page.getByTestId('parent-guest-draft')).toHaveText('x');

    await page.getByTestId('btn-reset').click();
    await expect(page.getByTestId('parent-guest-draft')).toHaveText('guest');
  });
});

test.describe('peek and updateAtPath', () => {
  test('peek increments counter without tracking', async ({ page }) => {
    await page.goto('/');
    const counter = page.getByTestId('peek-count');
    await expect(counter).toHaveText('0');

    await page.getByTestId('btn-peek').click();
    await expect(counter).toHaveText('1');

    await page.getByTestId('btn-peek').click();
    await expect(counter).toHaveText('2');

    // Peek does NOT track — changing name should not affect peek count
    await page.getByTestId('btn-name').click();
    await expect(counter).toHaveText('2');
  });

  test('updateAtPath updates leaf by path', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('name')).toHaveText('Ada');

    await page.getByTestId('btn-update-path').click();
    await expect(page.getByTestId('name')).toHaveText('ADA');
    await expect(page.getByTestId('label')).toHaveText('ADA · 36');
  });

  test('updateAtPath updates branch by path', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-update-branch').click();
    await expect(page.getByTestId('name')).toHaveText('User-Ada');
  });

  test('peek counter resets', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-peek').click();
    await page.getByTestId('btn-peek').click();
    await expect(page.getByTestId('peek-count')).toHaveText('2');

    await page.getByTestId('btn-peek-reset').click();
    await expect(page.getByTestId('peek-count')).toHaveText('0');
  });

  test('batch coalesces two writes into one update', async ({ page }) => {
    await page.goto('/');
    const name = page.getByTestId('name');
    const age = page.getByTestId('age');

    const _unused = await name.textContent();
    const initialAge = await age.textContent();

    await page.getByTestId('btn-batch').click();

    // Both writes applied, name now starts with 'Batch-'
    const newName = await name.textContent();
    expect(newName?.startsWith('Batch-')).toBe(true);
    // Age increased by 10
    expect(Number(await age.textContent())).toBe(Number(initialAge) + 10);
  });
});
