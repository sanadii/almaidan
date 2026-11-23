/** Read-only local route audit. Never submits forms or creates rooms. */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'local/almaidan/qolbha-width-audit-20261113');
const base = process.env.ALMAIDAN_AUDIT_URL || 'http://127.0.0.1:5175';
if (!['http://127.0.0.1:5175', 'http://127.0.0.1:5174'].includes(base)) throw Error('LOCAL_AUDIT_ONLY');
const source = await readFile(path.join(root, 'src/app/App.tsx'), 'utf8');
const patterns = [...new Set([...source.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1].startsWith('/') || m[1] === '*' ? m[1] : `/admin/${m[1]}`))];
const routes = patterns.map(pattern => ({ pattern, url: pattern === '*' ? '/layout-audit-not-found' : pattern.replace(/:roomCode/g, 'AUDIT-NOT-FOUND').replace(/:code/g, 'AUDIT-NOT-FOUND').replace(/:engine/g, 'classic').replace(/:questionId/g, 'audit-not-found').replace(/:id/g, 'audit-not-found') }));
routes.push({pattern:'/host/new?kind=huroof',url:'/host/new?kind=huroof'},{pattern:'/host/new?kind=imposter',url:'/host/new?kind=imposter'});
const routeFilter=process.env.ALMAIDAN_AUDIT_ROUTES?.split(',');
const auditedRoutes=routeFilter?routes.filter(r=>routeFilter.includes(r.pattern)):routes;
if(!auditedRoutes.length)throw Error('NO_AUDIT_ROUTES');
const widths = process.env.ALMAIDAN_AUDIT_WIDTHS?.split(',').map(Number) || [320,390,768,1024,1440,1920];
if (widths.some(n => !Number.isInteger(n) || n < 320 || n > 2560)) throw Error('INVALID_AUDIT_WIDTH');
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
const results = [];
// Geometry observed in Qolbha's public stylesheet and verified in its live user tab.
function referenceLayout(width,height) {
  let unit=Math.max(16,Math.min(60,16+(width-1920)*0.014651));
  if(width>=1280)unit=Math.max(unit,17);
  if(width>=1536)unit=Math.max(unit,19);
  if(width>height&&width<=1023&&height>=501.5)unit=14;
  if(width>height&&height<=501)unit=12;
  return {unit,cap:80.063*unit,gutter:unit*(width>=576?1.5:1)};
}
try {
  for (const theme of ['light','dark']) {
    const context = await browser.newContext({colorScheme:theme, reducedMotion:'reduce', locale:'ar-KW'});
    const page = await context.newPage();
    for (const width of widths) {
      await page.setViewportSize({width,height:1000});
      for (const route of auditedRoutes) {
        await page.goto(base + route.url, {waitUntil:'domcontentloaded'});
        await page.locator('main').first().waitFor({state:'visible'});
        await page.waitForFunction(() => !document.querySelector('[data-state="loading"]'), null, {timeout:2500}).catch(()=>{});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(60);
        const metrics = await page.evaluate(() => {
          const main = document.querySelector('main');
          const heading = main?.querySelector('h1');
          const card = document.querySelector('.auth-panel>.page-readable,.maydan-join-card>.page-readable,.local-admin-sign-in');
          const rail = main?.getBoundingClientRect();
          const headingStyle = heading && getComputedStyle(heading);
          const header=document.querySelector('.app-header.stable-header.maydan-app-header');
          const homeRail=document.querySelector('.maydan-showcase');
          return {title:heading?.textContent?.trim()||'',pathname:location.pathname,viewport:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,layoutWidth:document.body.getBoundingClientRect().width,documentWidth:document.documentElement.scrollWidth,mainWidth:rail?.width||0,mainLeft:rail?.left||0,mainPadding:main?parseFloat(getComputedStyle(main).paddingInlineStart):0,homeRailWidth:homeRail?.getBoundingClientRect().width||null,homeRailPadding:homeRail?parseFloat(getComputedStyle(homeRail).paddingInlineStart):null,headerWidth:header?.getBoundingClientRect().width||null,cardWidth:card?.getBoundingClientRect().width||null,headingSize:headingStyle?.fontSize||null,bodyImage:getComputedStyle(document.body).backgroundImage,kind:main?.getAttribute('data-page-kind'),classes:main?.className||'',loading:Boolean(document.querySelector('[data-state="loading"]'))};
        });
        const issues=[];
        const expected=referenceLayout(metrics.viewport,metrics.height);
        if(metrics.documentWidth>width+1)issues.push('document-overflow');
        if(route.url!=='/'&&metrics.mainWidth>Math.min(metrics.layoutWidth,expected.cap)+1)issues.push('rail-over-cap');
        if(metrics.headerWidth>Math.min(metrics.layoutWidth,expected.cap)+1)issues.push('header-over-cap');
        if(metrics.homeRailWidth&&Math.abs(metrics.homeRailWidth-Math.min(metrics.layoutWidth,expected.cap))>1)issues.push('home-reference-width');
        if(metrics.homeRailPadding!==null&&Math.abs(metrics.homeRailPadding-expected.gutter)>0.5)issues.push('home-reference-gutter');
        if(route.url!=='/'&&metrics.bodyImage!=='none')issues.push('inner-background-image');
        let contrast=null;
        if(['/','/login','/how-to-play','/local-admin','/host/new?kind=huroof','/enta/new'].includes(route.url)&&[390,1440].includes(width)) {
          const audit=await new AxeBuilder({page}).withRules(['color-contrast']).analyze();
          contrast={violations:audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:audit.incomplete.length};
          if(contrast.violations.length)issues.push('color-contrast');
        }
        results.push({theme,width,route:route.pattern,...metrics,expected,contrast,issues});
        if(['/','/login','/how-to-play','/local-admin','/host/new?kind=huroof','/enta/new'].includes(route.url)&&[390,1440].includes(width)) {
          await page.screenshot({path:path.join(output,`${theme}-${width}-${route.url.replace(/[^a-z0-9]+/gi,'_')||'home'}.png`)});
        }
      }
    }
    await context.close();
  }
} finally {await browser.close();}
const reportPath=path.join(output,routeFilter?'routes-filtered.json':'routes.json');
await writeFile(reportPath,JSON.stringify({generatedAt:new Date().toISOString(),base,patterns:patterns.length,results},null,2));
const failures=results.filter(r=>r.issues.length);
console.log(JSON.stringify({patterns:patterns.length,checks:results.length,failures:failures.map(({route,width,theme,issues,documentWidth,mainWidth})=>({route,width,theme,issues,documentWidth,mainWidth})),loading:results.filter(r=>r.loading).length,report:reportPath},null,2));
process.exitCode=failures.length?1:0;
