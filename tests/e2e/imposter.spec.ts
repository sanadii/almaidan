import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Projection } from '../../src/features/imposter/contracts';

async function signInLocalHost(page: Page, baseURL: string) {
  if (baseURL !== 'http://127.0.0.1:5174') throw new Error('ALMAIDAN_LOCAL_BROWSER_ONLY');
  const identity = JSON.parse(await readFile('D:/projects/huroof_wa_oloof/local/almaidan/admin-identity.private.json', 'utf8')) as { projectId: string; email: string; password: string };
  if (identity.projectId !== 'demo-almaidan-local') throw new Error('LOCAL_TEST_IDENTITY_REQUIRED');
  await page.goto(`${baseURL}/login?returnTo=%2Fhost%2Fnew%3Fkind%3Dimposter`);
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(identity.email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'تسجيل الدخول بالبريد', exact: true }).click();
  await expect(page).toHaveURL(/\/host\/new\?kind=imposter$/);
}

async function ownState(page: Page): Promise<Projection> {
  const session = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(value => value.startsWith('imposter:session:'));
    return JSON.parse(sessionStorage.getItem(key!)!) as { roomId: string; token: string };
  });
  const response = await page.request.post(`/api/imposter/rooms/${session.roomId}/resume`, { headers: { authorization: `Bearer ${session.token}`, origin: new URL(page.url()).origin }, data: {} });
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { projection: Projection }).projection;
}

for (const count of [3, 8]) test(`${count} independent devices finish a ${count === 3 ? 'typed caught-imposter' : 'spoken escape'} round`, async ({ browser, baseURL }, testInfo) => {
  const names = ['أحمد', 'بدر', 'خالد', 'ليلى', 'سارة', 'يوسف', 'نورة', 'مريم'];
  const contexts = await Promise.all(Array.from({ length: count }, (_, index) => browser.newContext({ viewport: index ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: index > 0 })));
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const host = pages[0];
    await signInLocalHost(host, baseURL!);
    await host.getByLabel('اسمك في الغرفة').fill(names[0]);
    await host.getByRole('button', { name: 'أنشئ الغرفة', exact: true }).click();
    await expect(host).toHaveURL(/\/room\/D1-[A-Z0-9]{8}\/imposter$/);
    const code = host.url().split('/')[4];
    await host.getByLabel('إيقاع الجولة').selectOption('fast');
    if (count === 3) await host.getByLabel('طريقة التلميح').selectOption('typed');
    for (let index = 1; index < count; index++) {
      if (index === 1) { await pages[index].goto(baseURL!); await expect(pages[index].getByRole('link', { name: 'تسجيل الدخول للاستضافة', exact: true })).toBeVisible(); await pages[index].getByLabel('رمز الغرفة', { exact: true }).fill(code.toLowerCase()); await pages[index].getByRole('button', { name: 'الدخول', exact: true }).click(); } else await pages[index].goto(`${baseURL}/room/${code}/join`);
      await pages[index].getByLabel('اسم اللاعب').fill(names[index]);
      await pages[index].getByRole('button', { name: 'دخول الغرفة' }).click();
      await expect(pages[index]).toHaveURL(new RegExp(`/room/${code}/imposter$`));
    }
    await pages[1].reload();
    await expect(pages[1].getByRole('heading', { name: 'اجمعوا الشلة', exact: true })).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath('lobby-desktop.png') });
    await pages[1].screenshot({ path: testInfo.outputPath('lobby-phone.png'), fullPage: true });
    await Promise.all(pages.map(page => page.getByRole('button', { name: 'أنا مستعد', exact: true }).click()));
    await expect(host.getByRole('button', { name: 'ابدأ الجولة', exact: true })).toBeEnabled();
    await host.getByRole('button', { name: 'ابدأ الجولة', exact: true }).click();
    await Promise.all(pages.map(page => expect(page.getByRole('heading', { name: 'كل واحد وسرّه', exact: true })).toBeVisible()));
    const states = await Promise.all(pages.map(ownState));
    expect(states.filter(state => state.role === 'imposter')).toHaveLength(1);
    const spy = states.findIndex(state => state.role === 'imposter');
    const word = states.find(state => state.role === 'insider')!.word!;
    expect(states[spy].word).toBeUndefined();
    for (const page of pages) {
      await expect(page.locator('.imposter-secret')).toHaveText('سرك مخفي');
      const hold = page.getByRole('button', { name: 'اضغط مطولاً لعرض سرك' });
      await hold.focus(); await page.keyboard.down('Space');
      await expect(page.locator('.imposter-secret')).not.toHaveText('سرك مخفي');
      await page.keyboard.up('Space');
      await expect(page.locator('.imposter-secret')).toHaveText('سرك مخفي');
    }
    const axe = await new AxeBuilder({ page: pages[1] }).include('.imposter-shell').analyze();
    expect(axe.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
    await Promise.all(pages.map(page => page.getByRole('button', { name: 'عرفت دوري — جاهز' }).click()));
    for (let turn = 0; turn < count * 2; turn++) {
      const state = await ownState(host);
      expect(state.turn).toBe(turn);
      const speaker = pages[states.findIndex(value => value.me === state.order[turn % count])];
      if (count === 3) { await speaker.getByLabel('تلميحك — كلمة واحدة').fill('تلميح'); await speaker.getByRole('button', { name: 'أرسل الكلمة', exact: true }).click(); }
      else await speaker.getByRole('button', { name: 'تم — قلت كلمتي', exact: true }).click();
      await expect.poll(async () => (await ownState(host)).turn).toBe(turn + 1);
    }
    await expect(host.getByRole('heading', { name: 'مين تشكون فيه؟', exact: true })).toBeVisible();
    // Real server deadlines; no state injection or client clock acceleration.
    await Promise.all(pages.map(page => expect(page.getByRole('heading', { name: 'صوّت بسرية', exact: true })).toBeVisible({ timeout: 65_000 })));
    const accused = count === 3 ? spy : states.findIndex(state => state.role === 'insider');
    const alternate = (accused + 1) % count;
    await Promise.all(pages.map(async (page, index) => {
      const target = index === accused ? alternate : accused;
      await page.getByRole('button', { name: new RegExp(`${names[target]}$`) }).click();
      await page.getByRole('button', { name: 'تأكيد التصويت', exact: true }).click();
      await expect(page.getByText('تم تثبيت صوتك بسرية. ننتظر انتهاء الوقت.')).toBeVisible();
    }));
    await expect(host.getByRole('heading', { name: 'صوّت بسرية', exact: true })).toBeVisible();
    if (count === 3) {
      await expect(pages[spy].getByLabel('تخمينك النهائي')).toBeVisible({ timeout: 25_000 });
      await expect(pages[spy].locator('.imposter-result-word')).toHaveCount(0);
      await pages[spy].getByLabel('تخمينك النهائي').fill(word);
      await pages[spy].getByRole('button', { name: 'ثبّت التخمين', exact: true }).click();
    }
    await Promise.all(pages.map(page => expect(page.getByRole('heading', { name: 'انكشف السر!', exact: true })).toBeVisible({ timeout: 25_000 })));
    await expect(host.getByRole('heading', { name: 'فاز الدخيل!', exact: true })).toBeVisible();
    await expect(host.locator('.imposter-result-word')).toHaveText(word);
    await host.screenshot({ path: testInfo.outputPath('results-desktop.png') });
    await host.getByRole('button', { name: 'جولة جديدة', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'اجمعوا الشلة', exact: true })).toBeVisible();
    expect((await ownState(host)).settings.pace).toBe('fast');
    await expect(host.getByRole('button', { name: 'أنا مستعد', exact: true })).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('touch cancellation and dark RTL layouts keep secrets concealed', async ({ browser, baseURL }, testInfo) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce' })));
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const host = pages[0];
    await signInLocalHost(host, baseURL!);
    await host.getByLabel('اسمك في الغرفة').fill('أحمد');
    await host.getByRole('button', { name: 'أنشئ الغرفة', exact: true }).click();
    await expect(host).toHaveURL(/\/room\/D1-[A-Z0-9]{8}\/imposter$/);
    const code = host.url().split('/')[4];
    for (let i = 1; i < 3; i++) {
      await pages[i].goto(`${baseURL}/room/${code}/join`);
      await pages[i].getByLabel('اسم اللاعب').fill(i === 1 ? 'بدر' : 'خالد');
      await pages[i].getByRole('button', { name: 'دخول الغرفة' }).click();
      await expect(pages[i]).toHaveURL(new RegExp(`/room/${code}/imposter$`));
    }
    await Promise.all(pages.map(page => page.getByRole('button', { name: 'أنا مستعد', exact: true }).click()));
    await expect(host.getByRole('button', { name: 'ابدأ الجولة', exact: true })).toBeEnabled();
    await host.getByRole('button', { name: 'ابدأ الجولة', exact: true }).click();
    const page = pages[1];
    const control = page.getByRole('button', { name: 'اضغط مطولاً لعرض سرك' });
    await control.scrollIntoViewIfNeeded();
    const bounds = await control.boundingBox(); expect(bounds).not.toBeNull();
    const cdp = await contexts[1].newCDPSession(page);
    const touchPoints = [{ x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
    await expect(page.locator('.imposter-secret')).not.toHaveText('سرك مخفي');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(page.locator('.imposter-secret')).toHaveText('سرك مخفي');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath(`reveal-dark-${width}.png`), fullPage: true });
    }
    const axe = await new AxeBuilder({ page }).include('.imposter-shell').analyze();
    expect(axe.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
    await host.getByRole('button', { name: 'إلغاء الجولة', exact: true }).click();
    await host.getByRole('button', { name: 'تأكيد', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'أُلغيت الجولة', exact: true })).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('Almaidan homepage offers الدخيل beside its existing games', async ({ page, baseURL }, testInfo) => {
  await page.goto(baseURL!);
  await expect(page.getByRole('link', { name: 'ابدأ الدخيل', exact: true })).toHaveAttribute('href', '/host/new?kind=imposter');
  await expect(page.locator('.maydan-game-card--khaliah')).toContainText('الخلية');
  await expect(page.locator('.maydan-game-card--enta')).toContainText('إنت صح');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.maydan-game-cards-grid').screenshot({ path: testInfo.outputPath(`three-games-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});

test('Almaidan keeps verified-host and trusted-origin checks on Dakhil creation', async ({ request, baseURL }) => {
  if (baseURL !== 'http://127.0.0.1:5174') throw new Error('ALMAIDAN_LOCAL_BROWSER_ONLY');
  const anonymous = await request.post('/api/imposter/rooms', { headers: { origin: baseURL }, data: { displayName: 'فحص محلي' } });
  expect(anonymous.status()).toBe(401);
  const foreignOrigin = await request.post('/api/imposter/rooms', { headers: { origin: 'https://example.invalid' }, data: { displayName: 'فحص محلي' } });
  expect(foreignOrigin.status()).toBe(403);
});
