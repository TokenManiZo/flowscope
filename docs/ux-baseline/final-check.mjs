import {chromium,expect} from '../../frontend/node_modules/@playwright/test/index.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:18845';
const output='docs/ux-baseline/final-captures';mkdirSync(output,{recursive:true});
const report={mockupOnly:true,productCodeChanged:false,checks:[],captures:[],errors:[],unexpectedRequests:[],measurements:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [1280,1920])for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width,height:width*9/16},colorScheme:theme});
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)||r.method()!=='GET')report.unexpectedRequests.push({url:r.url(),method:r.method()})});
    for(const screen of ['surface','evidence'])for(const variant of ['before','after']){
      const state=screen==='evidence'?'missing':'normal';
      await page.goto(`${base}/final-preview.html?screen=${screen}&variant=${variant}&theme=${theme}&state=${state}`);
      await page.getByRole('heading',{name:screen==='surface'?'API·입력 차이':'관측 기록',exact:true}).waitFor();
      await page.evaluate(()=>document.fonts.ready);
      const path=`${output}/${variant}-${screen}-${theme}-${width}.png`;await page.screenshot({path});report.captures.push(path);
      if(variant==='after'){
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if(screen==='surface'){
          await expect(page.locator('.old-notice,.old-badge')).toHaveCount(0);
          await expect(page.locator('tbody tr')).toHaveCount(10);
          const bounds=await page.locator('.sheet-head').boundingBox();
          await page.getByRole('button',{name:'집계',exact:true}).click();await expect(page.locator('#aggregate-pop')).toBeVisible();
          expect(await page.locator('.sheet-head').boundingBox()).toEqual(bounds);
          await page.screenshot({path:`${output}/aggregate-${theme}-${width}.png`});
          await page.keyboard.press('Escape');await expect(page.locator('#aggregate-pop')).toBeHidden();await expect(page.locator('#aggregate')).toBeFocused();
          await page.getByRole('button',{name:'필터',exact:true}).click();await page.locator('[data-source=L]').uncheck();await expect(page.locator('tbody tr')).toHaveCount(7);
          await page.locator('#comparison').selectOption('declared');await expect(page.locator('tbody tr')).toHaveCount(4);
          await page.keyboard.press('Escape');await page.getByRole('button',{name:/^필터/}).click();await page.locator('#comparison').selectOption('all');await page.locator('[data-source=L]').check();await page.keyboard.press('Escape');await page.getByRole('button',{name:'상세 보기'}).first().click();await expect(page.getByRole('complementary',{name:'API 선택 상세'})).toBeVisible();await page.screenshot({path:`${output}/api-detail-${theme}-${width}.png`});await page.getByRole('button',{name:'API 상세 닫기',exact:true}).click();
          report.checks.push(`${width}/${theme}: API notices removed, filter results, aggregate anchored, Escape focus, row detail`);
        }else{
          await expect(page.locator('.old-policy,.chips,input#role')).toHaveCount(0);
          const select=page.getByLabel('필수 역할 지정',{exact:true});const save=page.getByRole('button',{name:'필수 역할 저장',exact:true});
          await expect(save).toBeDisabled();await select.selectOption('LV2');await expect(save).toBeEnabled();await expect(page.locator('#policy-status')).toBeEmpty();await save.click();await expect(save).toBeDisabled();await expect(page.locator('#policy-status')).toContainText('목업');
          await page.locator('.policy-fold>summary').click();await expect(select).toBeHidden();await page.locator('.policy-fold>summary').click();await expect(select).toHaveValue('LV2');
          await expect(select.locator('option[value=Operator]')).toHaveCount(1);
          await page.locator('[data-record="529"]').first().click();await expect(page.locator('.selected-label')).toContainText('#529');await expect(select).toHaveValue('');
          const overflow=await page.locator('.path-button').evaluateAll(els=>els.filter(e=>e.scrollWidth>e.clientWidth+1).length);expect(overflow).toBe(0);
          const measure=await page.locator('.policy-row').evaluateAll(els=>els.map(e=>{const rect=e.getBoundingClientRect();return {y:rect.y,width:rect.width,heights:[...e.querySelectorAll('select,button')].map(c=>c.getBoundingClientRect().height)}}));report.measurements.push({width,theme,rows:measure});expect(measure.every(r=>r.heights.every(h=>h===32))).toBe(true);
          await page.getByRole('button',{name:'Request Lab 원문 처리 안내'}).focus();await expect(page.getByRole('tooltip')).toBeVisible();const tip=await page.getByRole('tooltip').boundingBox();const panel=await page.locator('.right-panel').boundingBox();expect(tip.x).toBeGreaterThanOrEqual(panel.x);expect(tip.x+tip.width).toBeLessThanOrEqual(panel.x+panel.width);await page.screenshot({path:`${output}/help-${theme}-${width}.png`});
          report.checks.push(`${width}/${theme}: role dropdown, explicit save, fold selection preserved, record reset, long paths contained, control heights 32px`);
        }
      }
    }
    for(const [screen,states] of [['surface',['loading','empty','query-failed']],['evidence',['normal','loading','empty','query-failed']]])for(const state of states){
      await page.goto(`${base}/final-preview.html?screen=${screen}&variant=after&theme=${theme}&state=${state}`);
      if(screen==='evidence'&&state==='normal'){await page.locator('.raw-fold>summary').click();await expect(page.locator('.raw-columns')).toContainText('***MASKED***');await page.screenshot({path:`${output}/raw-${theme}-${width}.png`})}
      if(state==='query-failed'){await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'다시 시도'}).click();await expect(page.getByRole('alert')).toHaveCount(0)}
      if(state==='loading')await expect(page.getByRole('status').filter({hasText:'불러오는 중'})).toContainText('불러오는 중');
      if(state==='empty')await expect(page.getByText(screen==='surface'?'수집된 API와 선언이 없습니다.':'이 API에 연결된 관측 기록이 없습니다.',{exact:true})).toBeVisible();
    }
    report.checks.push(`${width}/${theme}: loading, empty, payload unavailable, masked body, retry states`);
    await context.close();
  }
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  for(const screen of ['surface','evidence']){
    await page.goto(`${base}/final-review.html?screen=${screen}`);await expect(page.locator('iframe')).toHaveCount(4);await page.screenshot({path:`${output}/review-${screen}.png`,fullPage:true});
  }
  expect(report.errors).toEqual([]);expect(report.unexpectedRequests).toEqual([]);report.passed=true;
}finally{await browser.close();writeFileSync('docs/ux-baseline/final-verification.json',JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({passed:report.passed,captures:report.captures.length,checks:report.checks.length,errors:report.errors}));
