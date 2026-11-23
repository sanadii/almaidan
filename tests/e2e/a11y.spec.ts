import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('entry has no critical or serious automated accessibility violations', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`); const results = await new AxeBuilder({ page }).analyze(); expect(results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 768 }, { width: 1600, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`Maydan Playful homepage ${viewport.width} ${colorScheme} ${reducedMotion}`, async ({ page, baseURL }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme, reducedMotion });
        await page.goto(`${baseURL}/`);
        await expect(page.getByRole('heading', { name: 'أحلى جمعة تبدأ بلعبة. واللعبة تحلى بأصحابكم. في ميدان.' })).toBeVisible();
        await expect(page.locator('.maydan-header__host')).toBeVisible();
        await expect(page.getByRole('link', { name: 'تسجيل الدخول للاستضافة', exact: true })).toHaveAttribute('href', '/login');
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
        await page.evaluate(() => document.fonts.ready);
        await page.locator('.maydan-hero img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
        if (reducedMotion === 'no-preference') await page.waitForTimeout(900);
        if (viewport.width === 1440) await expect(page.getByRole('link', { name: 'ابدأوا مباراة', exact: true })).toBeInViewport();
        await expect(page.locator('.maydan-honeycomb__cell')).toHaveCount(25);
        await expect(page.locator('.maydan-join-form form')).toHaveCount(1);
        await expect(page.getByRole('link', { name: /إنت صح/ })).toHaveCount(0);
        await page.locator('.maydan-gathering').scrollIntoViewIfNeeded();
        await page.locator('.maydan-home-page img').evaluateAll(images => Promise.all(images.map(async image => { (image as HTMLImageElement).loading = 'eager'; await (image as HTMLImageElement).decode(); })));
        const structure = await page.evaluate(() => {
          const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
          return {
            rails: ['.maydan-setup__inner','.maydan-showcase','.maydan-discovery','.maydan-catalogue','.maydan-gathering','.maydan-faq'].map(rect),
            clientWidth: document.body.clientWidth,
            phones: [...document.querySelectorAll('.maydan-phone')].map(phone => ({bounds: phone.getBoundingClientRect().toJSON(),screen: phone.querySelector('.maydan-phone__screen')!.getBoundingClientRect().toJSON(),label: phone.querySelector('.maydan-phone__label')!.getBoundingClientRect().toJSON(),controls:phone.querySelectorAll('a,button,input,[tabindex]').length})),
            copyAlign: getComputedStyle(document.querySelector('#maydan-hero-title')!).textAlign,
            showcaseCount: document.querySelectorAll('.maydan-showcase__examples > li').length,
            formInSetup: Boolean(document.querySelector('.maydan-setup .maydan-join-form form')),
            formInHero: Boolean(document.querySelector('.maydan-hero form')),
            order: [...document.querySelectorAll('[data-home-region]')].map(element=>element.getAttribute('data-home-region'))
          };
        });
        expect(structure.order).toEqual(['header','hero','create-join-dock','join-form','game-choice','guide','discovery','category-chooser','gathering','account-note','faq','final-action','footer']);
        expect(structure.formInSetup).toBe(true); expect(structure.formInHero).toBe(false); expect(structure.copyAlign).toBe('start');
        expect(structure.showcaseCount).toBe(3); expect(structure.phones).toHaveLength(5);
        expect(structure.phones.every(phone=>phone.controls===0&&phone.label.height>=16)).toBe(true);
        if(viewport.width<768) expect(structure.phones.every(phone=>phone.bounds.left>=16&&phone.bounds.right<=structure.clientWidth-16)).toBe(true);
        expect(structure.rails.every(rail=>Math.abs(rail.left-structure.rails[0].left)<1&&Math.abs(rail.right-structure.rails[0].right)<1)).toBe(true);
        await testInfo.attach('structure', {body:JSON.stringify(structure,null,2),contentType:'application/json'});
        const layout = await page.evaluate(() => {
          const root = document.querySelector<HTMLElement>('.maydan-home-page')!;
          const art = document.querySelector<HTMLElement>('.maydan-hero-cards')!;
          const headline = document.querySelector<HTMLElement>('#maydan-hero-title')!;
          return {
            width: innerWidth, clientWidth: document.documentElement.clientWidth, docWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
            canvas: getComputedStyle(root).backgroundColor,
            headline: { container: headline.getBoundingClientRect().toJSON(), fontSize: getComputedStyle(headline).fontSize,
              textBounds: [...headline.children].map(line => { const range = document.createRange(); range.selectNodeContents(line); return range.getBoundingClientRect().toJSON(); }) },
            artBounds: art.getBoundingClientRect().toJSON(),
            wash: { background: getComputedStyle(art.parentElement!, "::before").backgroundImage, zIndex: getComputedStyle(art.parentElement!, "::before").zIndex },
            fonts: { display: document.fonts.check('700 60px "IBM Plex Sans Arabic"'), body: document.fonts.check('400 16px "IBM Plex Sans Arabic"') },
            loadedFontFaces: [...document.fonts].filter(face=>face.status==='loaded').map(face=>({family:face.family,weight:face.weight})),
            imageTransfers: performance.getEntriesByType('resource').filter(resource=>resource.name.includes('/assets/maydan/')).map(resource=>({name:resource.name,bytes:(resource as PerformanceResourceTiming).encodedBodySize,transferredBytes:(resource as PerformanceResourceTiming).transferSize})),
            themeIcon: getComputedStyle(document.querySelector('.maydan-header .theme-toggle__icon')!).stroke,
            imageGeometry: [...document.querySelectorAll<HTMLImageElement>('.maydan-home-page img')].map(image => ({ loaded: image.complete && image.naturalWidth > 0, width: image.width, height: image.height, source: image.currentSrc, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight })),
            animation: [...art.querySelectorAll<HTMLElement>('a')].map(card => ({name: getComputedStyle(card).animationName, delay: getComputedStyle(card).animationDelay, opacity: getComputedStyle(card).opacity, duration: getComputedStyle(card).animationDuration, playing: card.getAnimations().filter(animation => animation.playState === 'running').length})),
            cards: [...art.querySelectorAll<HTMLElement>('a')].map(card => ({href: card.getAttribute('href'), bounds: card.getBoundingClientRect().toJSON(), label: card.querySelector('span')!.getBoundingClientRect().toJSON(), image: card.querySelector('img')!.getBoundingClientRect().toJSON()})),
            targets: [...document.querySelectorAll<HTMLElement>('.maydan-button, .maydan-join-form button, .maydan-header summary')].map(control=>control.getBoundingClientRect().height),
          };
        });
        expect(layout.docWidth).toBeLessThanOrEqual(layout.width);
        expect(layout.bodyWidth).toBeLessThanOrEqual(layout.width);
        expect(layout.docWidth).toBeLessThanOrEqual(layout.clientWidth);
        expect(layout.bodyWidth).toBeLessThanOrEqual(layout.clientWidth);
        expect(layout.canvas).toBe(colorScheme === 'light' ? 'rgb(246, 241, 237)' : 'rgb(25, 22, 21)');
        expect(layout.fonts).toEqual({display:true,body:true});
        expect(layout.loadedFontFaces.some(face=>face.family==='Lalezar')).toBe(true);
        expect(layout.loadedFontFaces.some(face=>face.family==='IBM Plex Sans Arabic')).toBe(true);
        expect(layout.themeIcon).toBe(colorScheme === 'light' ? 'rgb(31, 31, 31)' : 'rgb(246, 241, 237)');
        expect(layout.imageTransfers.reduce((total,image)=>total+image.bytes,0)).toBeLessThanOrEqual(700_000);
        expect(layout.imageGeometry.every(image=>image.loaded)).toBe(true);
        expect(layout.targets.every(height=>height>=44)).toBe(true);
        expect(layout.animation.every(card=>card.opacity==='1' && card.playing===0)).toBe(true);
        if (reducedMotion === 'reduce') expect(layout.animation.every(card=>card.name==='none')).toBe(true);
        else expect(new Set(layout.animation.map(card=>card.delay)).size).toBe(5);
        expect(layout.cards).toHaveLength(5);
        expect(layout.cards.every(card=>card.bounds.width>=44&&card.bounds.height>=44&&card.label.height>=44)).toBe(true);
        if(viewport.width < 768) {
          expect(layout.cards.every(card=>card.bounds.left>=16&&card.bounds.right<=layout.clientWidth-16)).toBe(true);
          expect(layout.cards.every(card=>card.image.bottom<=card.label.top&&card.label.bottom<=card.bounds.bottom)).toBe(true);
          for(let i=0;i<layout.cards.length;i++) for(let j=i+1;j<layout.cards.length;j++) {
            const a=layout.cards[i].bounds,b=layout.cards[j].bounds;
            expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBe(true);
          }
          expect(layout.cards[4].bounds.width).toBeCloseTo(layout.cards[0].bounds.width, 0);
        }
        for (const card of await page.locator('.maydan-hero-card').all()) {
          await card.scrollIntoViewIfNeeded();
          expect(await card.evaluate(element=>{const label=element.querySelector('span')!.getBoundingClientRect();return element.contains(document.elementFromPoint(label.x+label.width/2,label.y+label.height/2));})).toBe(true);
          await card.focus();
          await page.keyboard.press('Enter');
          await expect(page.locator((await card.getAttribute('href'))!)).toBeFocused();
        }

        const faq = page.locator('.maydan-faq details').first();
        await faq.locator('summary').focus();
        await page.keyboard.press('Enter');
        await expect(faq).toHaveAttribute('open', '');
        await expect(faq.locator('p')).toBeVisible();
        await page.keyboard.press('Space');
        await expect(faq).not.toHaveAttribute('open', '');

        await page.getByRole('link', { name: 'معك رمز غرفة؟' }).click();
        const code = page.getByRole('textbox', {name:'رمز الغرفة',exact:true});
        await expect(code).toBeFocused();
        expect(await page.locator('.maydan-header').evaluate(el=>el.getBoundingClientRect().top)).toBe(0);
        expect(await code.evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThan(84);
        await page.getByRole('button',{name:'الدخول'}).click();
        await expect(code).toBeFocused();
        await expect(page.getByRole('alert')).toHaveText('أدخل رمز الغرفة أولاً.');
        await code.fill('ab-12c');
        await expect(code).toHaveValue('AB12C');
        await expect(code).toHaveAttribute('dir','ltr');
        await code.fill('');
        await page.evaluate(()=>window.scrollTo(0,0));
        const axe = await new AxeBuilder({page}).analyze();
        expect(axe.violations.filter(violation=>violation.impact==='critical'||violation.impact==='serious')).toEqual([]);
        expect(errors).toEqual([]);
        await testInfo.attach('layout', {body:JSON.stringify(layout,null,2),contentType:'application/json'});
        const prefix = `output/int3g-homepage-20261003/${viewport.width}-${colorScheme}-${reducedMotion}`;
        await page.screenshot({path:`${prefix}-first.png`});
        await page.screenshot({path:`${prefix}-full.png`,fullPage:true});

        await page.getByRole('button',{name:'الدخول'}).scrollIntoViewIfNeeded();
        await code.fill('ab-12c');
        await page.getByRole('button',{name:'الدخول'}).click();
        await expect(page).toHaveURL(/\/room\/AB12C\/join$/);
        await expect(page.getByRole('heading',{name:'ما اسمك؟'})).toBeVisible();
      });
    }
  }
}
test('Maydan Playful theme control supports keyboard choice and returns focus', async ({page,baseURL})=>{
  await page.goto(`${baseURL}/`);
  await expect(page.getByRole('link',{name:'تسجيل الدخول للاستضافة',exact:true})).toBeVisible();
  const summary=page.locator('.maydan-header .theme-toggle > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  const dark=page.getByRole('radio',{name:'داكن',exact:true});
  await expect(dark).toBeVisible();
  await dark.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('.maydan-header .theme-toggle')).not.toHaveAttribute('open','');
  await expect(summary).toBeFocused();
});

test('Maydan Playful 1280 measured type, inner rails, native graphics and persistent header', async ({page,baseURL},testInfo)=>{
  await page.setViewportSize({width:1280,height:1000});
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  await page.goto(`${baseURL}/`); await page.evaluate(()=>document.fonts.ready);
  const roles=await page.evaluate(()=>{
    const e=(s:string)=>document.querySelector<HTMLElement>(s)!;
    const heading=e('#maydan-hero-title'),css=getComputedStyle(heading);
    return{headline:{y:heading.getBoundingClientRect().y,font:css.fontFamily,size:css.fontSize,line:css.lineHeight,weight:css.fontWeight,width:heading.getBoundingClientRect().width},
      rails:['.maydan-header__inner','.maydan-hero__inner','.maydan-setup__inner','.maydan-showcase','.maydan-gathering','.maydan-faq'].map(s=>{const n=e(s),r=n.getBoundingClientRect(),c=getComputedStyle(n);return{left:r.left+parseFloat(c.paddingLeft),right:r.right-parseFloat(c.paddingRight),usable:r.width-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight)}}),
      sharing:{title:getComputedStyle(e('.maydan-sharing-illustration__role b')).fontSize,copy:getComputedStyle(e('.maydan-sharing-illustration__role small')).fontSize},emblem:e('.maydan-emblem--closing').getBoundingClientRect().width,
      contentFits:[...document.querySelectorAll<HTMLElement>('.maydan-phone__screen')].every(screen=>[...screen.children].filter(child=>!child.classList.contains('maydan-phone__home')&&!child.classList.contains('maydan-phone__photo')&&getComputedStyle(child).display!=='none').every(child=>(child as HTMLElement).offsetTop+(child as HTMLElement).offsetHeight<=screen.clientHeight-12))};
  });
  expect(roles.headline).toMatchObject({size:'60px',line:'72px',weight:'700',width:704});
  expect(roles.headline.font).toContain('IBM Plex Sans Arabic');expect(roles.headline.y).toBeCloseTo(150.24,0);
  expect(roles.rails.every(r=>Math.abs(r.left-roles.rails[0].left)<1&&Math.abs(r.right-roles.rails[0].right)<1&&r.usable===1072)).toBe(true);
  expect(roles.sharing).toEqual({title:'16px',copy:'14px'});expect(roles.emblem).toBe(88);expect(roles.contentFits).toBe(true);
  await page.getByRole('link',{name:'معك رمز غرفة؟'}).click();await expect(page.locator('#room-code')).toBeFocused();
  expect(await page.locator('.maydan-header').evaluate(el=>el.getBoundingClientRect().top)).toBe(0);
  await testInfo.attach('source-role-measurements',{body:JSON.stringify(roles,null,2),contentType:'application/json'});
});

test('Maydan Playful cards have independent finite motion, hover, press and keyboard order', async ({page,baseURL}) => {
  await page.setViewportSize({width:1600,height:1000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(`${baseURL}/`);
  const cards=page.locator('.maydan-hero-card');
  await expect(cards).toHaveCount(5);
  await expect.poll(()=>cards.first().evaluate(element=>getComputedStyle(element).animationName)).toBe('maydan-card-arrive');
  const timelines=await cards.evaluateAll(elements=>elements.map(element=>{
    const style=getComputedStyle(element);
    return {end:parseFloat(style.animationDuration)*1000+parseFloat(style.animationDelay)*1000, iterations:style.animationIterationCount, name:style.animationName};
  }));
  expect(timelines.every(timeline=>timeline.end<=900&&timeline.iterations==='1'&&timeline.name!=='none')).toBe(true);
  await page.waitForTimeout(900);
  const transforms=()=>cards.evaluateAll(elements=>elements.map(element=>getComputedStyle(element).transform));
  const still=await transforms();
  await cards.nth(2).hover();
  await page.waitForTimeout(200);
  const hovered=await transforms();
  expect(hovered[2]).not.toBe(still[2]);
  for(const index of [0,1,3,4])expect(hovered[index]).toBe(still[index]);
  await page.mouse.down();
  await page.waitForTimeout(200);
  expect((await transforms())[2]).not.toBe(hovered[2]);
  await page.mouse.move(10,10);
  await page.mouse.up();
  await cards.first().focus();
  for(let index=0;index<5;index++) {
    await expect(cards.nth(index)).toBeFocused();
    expect(await cards.nth(index).evaluate(element=>getComputedStyle(element).outlineWidth)).toBe('3px');
    if(index<4)await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await expect(page.locator('#gathering-title')).toBeFocused();
});

test('Maydan Playful phone cards support real touch navigation without overlap', async ({browser,baseURL}) => {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  const page=await context.newPage();
  await page.goto(`${baseURL}/`);
  const cards=page.locator('.maydan-hero-card');
  for(let index=0;index<5;index++) {
    const card=cards.nth(index), target=(await card.getAttribute('href'))!;
    await card.tap();
    await expect(page.locator(target)).toBeFocused();
    await expect(page.locator(target)).toBeInViewport();
  }
  await context.close();
});

test('legacy question routes reach the current protected admin access state without serious violations', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/questions`);
  await expect(page).toHaveURL(/\/admin\/questions$/);
  await expect(page.getByRole('heading', { name: 'لا تملك صلاحية الوصول إلى الاستوديو الإداري.' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
});
