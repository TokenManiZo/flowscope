import {chromium,expect} from '../../frontend/node_modules/@playwright/test/index.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const directory='docs/ux-baseline/refinement-captures';mkdirSync(directory,{recursive:true});
const report={mockupOnly:true,checks:[],screenshots:[]};
try{for(const width of [1280,1920])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width,height:width*9/16},colorScheme:theme});await context.addInitScript(theme=>{localStorage.setItem('flowscope-theme',theme);localStorage.setItem('flowscope.sidebar','open')},theme);const page=await context.newPage();
 for(const screen of ['llm','zap','surface','evidence']){
  await page.goto('http://127.0.0.1:18843/actual/#'+(['llm','zap'].includes(screen)?'inspection':screen));
  if(screen==='llm'){await page.getByRole('tab',{name:'3 · LLM 탐색',exact:true}).click();await page.getByRole('button',{name:/^실행 세부정보/}).click()}
  if(screen==='zap')await page.getByRole('tab',{name:'2 · ZAP 스캔',exact:true}).click();
  if(screen==='surface'){await page.getByRole('button',{name:'상세 보기',exact:true}).first().click();await page.getByText('전체 8 · 입력 6 · 집계 펼치기').click()}
  if(screen==='evidence')await page.getByRole('button',{name:/GET \/api\/account 상세 보기/}).first().click();
  const before=`before-${screen}-${theme}-${width}.png`;await page.screenshot({path:directory+'/'+before});report.screenshots.push(before);
  await page.goto(`http://127.0.0.1:18844/refinement-preview.html?screen=${screen}&theme=${theme}`);
  if(screen==='llm'){await expect(page.locator('.refine-grid>div')).toHaveCount(6);expect(await page.locator('.refine-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);await page.getByRole('button',{name:'화면 상태 조회 횟수 도움말'}).focus();await expect(page.getByRole('tooltip')).toBeVisible();await page.getByRole('heading',{name:'LLM 탐색',exact:true}).click()}
  if(screen==='zap'){const section=page.locator('.refine-box').first();await section.locator('summary').click();await expect(section.getByRole('checkbox',{name:'USER A',exact:true})).toBeHidden();await section.locator('summary').click();await expect(section.getByRole('checkbox',{name:'USER A',exact:true})).toBeChecked()}
  const after=`after-${screen}-${theme}-${width}.png`;await page.screenshot({path:directory+'/'+after});report.screenshots.push(after);
  if(screen==='surface'){const box=await page.locator('.refine-toolbar').boundingBox();await page.locator('.refine-popup').last().locator('summary').click();expect((await page.locator('.refine-toolbar').boundingBox()).height).toBe(box.height);await page.screenshot({path:`${directory}/after-aggregate-${theme}-${width}.png`})}
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow '+screen);
 }
 report.checks.push(`${width} ${theme}: 3x2 metrics, help, ZAP fold/selection, floating aggregate`);await context.close();
}}finally{await browser.close();writeFileSync('docs/ux-baseline/refinement-verification.json',JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({captures:report.screenshots.length,checks:report.checks.length}));
