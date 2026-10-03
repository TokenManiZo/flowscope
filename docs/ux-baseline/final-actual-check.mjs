import {chromium,expect} from '../../frontend/node_modules/@playwright/test/index.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const origin='http://127.0.0.1:18845';
const snapshot=JSON.parse(readFileSync('docs/ux-baseline/snapshot.json','utf8'));
// An artifact-only endpoint makes the neutral observation state reviewable.
snapshot.surface.endpoints.push({key:{service:'https://demo.flowscope.test:443',method:'POST',pathTemplate:'/api/declared-only'},kinds:['ARTIFACT_API'],observedSources:[],observations:[],declarations:[{evidenceId:'ev-declaration-demo',source:'LLM',runId:'demo-llm',type:'JAVASCRIPT',adapter:'fetch',reason:'demo.js:1'}],parameters:[],deltaState:'DECLARED_NOT_OBSERVED'});
const output='docs/ux-baseline/final-actual-captures';mkdirSync(output,{recursive:true});
const report={mockServer:true,actualProductBuild:true,viewports:[1280,1920],themes:['light','dark'],checks:[],captures:[],errors:[],external:[],mutations:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
for(const width of report.viewports)for(const theme of report.themes){
 const context=await browser.newContext({viewport:{width,height:width*9/16},colorScheme:theme});
 await context.addInitScript(theme=>{localStorage.setItem('flowscope-theme',theme);localStorage.setItem('flowscope.sidebar','open')},theme);
 const page=await context.newPage();let failEvidence=false;
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){report.external.push(url.origin);return route.abort()}if(req.method()!=='GET'){report.mutations.push(url.pathname);return route.abort()}if(url.pathname==='/api/snapshot')return route.fulfill({json:snapshot});if(url.pathname==='/api/evidence'&&failEvidence)return route.fulfill({status:503,json:{success:false,message:'예시 조회 실패'}});return route.continue()});
 await page.goto(origin+'/actual/#surface');
 await expect(page.getByRole('heading',{name:'API·입력 차이',exact:true})).toBeVisible();
 await expect(page.getByText('일부 산출물을 완전히 해석하지 못했습니다.',{exact:true})).toHaveCount(0);
 const declared=page.getByRole('row').filter({hasText:'/api/declared-only'});await expect(declared).toContainText('—');await expect(declared).not.toContainText('산출물에서 발견 · 아직 요청 없음');
 const header=page.getByRole('region',{name:'API 비교',exact:true});await expect(header.getByRole('button',{name:'필터',exact:true})).toBeVisible();await expect(header.getByRole('button',{name:'집계',exact:true})).toBeVisible();
 await page.screenshot({path:`${output}/surface-${theme}-${width}.png`,animations:'disabled'});
 const row=page.getByRole('row').filter({hasText:'/api/orders/{id}'}).filter({has:page.getByText('GET',{exact:true})}).first();await row.getByRole('button',{name:'상세 보기',exact:true}).click();
 const inspector=page.getByRole('complementary',{name:'API 상세',exact:true});await expect(inspector).toBeVisible();await expect(inspector.getByLabel('API 입력 필드 비교')).toContainText('PATH');
 await page.screenshot({path:`${output}/api-detail-${theme}-${width}.png`,animations:'disabled'});
 await inspector.getByRole('button',{name:/관측 기록 상세/}).first().click();await expect(inspector.getByRole('button',{name:'Request Lab 열기',exact:true})).toBeVisible();
 await inspector.getByText('정책 편집 · 펼치기/접기',{exact:true}).click();await expect(inspector.getByRole('combobox',{name:'필수 역할 지정',exact:true})).toBeVisible();
 await page.screenshot({path:`${output}/api-record-${theme}-${width}.png`,animations:'disabled'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 report.checks.push(`${width}/${theme}: neutral declaration row, integrated controls, API panel, inputs, exact Evidence selection, no document overflow`);
 await page.goto(origin+'/actual/#evidence');await page.getByRole('button',{name:/GET \/api\/orders\/101 상세 보기/}).first().click();
 await expect(page.getByText('Authorization: ***MASKED***',{exact:false}).first()).toBeVisible();
 const policy=page.getByLabel('정책 작업');await expect(policy).not.toHaveAttribute('open','');await policy.locator('summary').click();
 const role=policy.getByRole('combobox',{name:'필수 역할 지정',exact:true});await role.selectOption('LV2');
 await policy.locator('summary').click();await policy.locator('summary').click();await expect(role).toHaveValue('LV2');
 await expect(policy.getByRole('textbox')).toHaveCount(0);await expect(policy.getByRole('button',{name:'LV2',exact:true})).toHaveCount(0);
 const metrics=await policy.locator('select').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();const button=e.parentElement.querySelector('button');const b=button?.getBoundingClientRect();return {height:r.height,x:r.x,buttonHeight:b?.height,buttonX:b?.x}}));
 expect(metrics.every(m=>m.height===32)).toBe(true);expect(await policy.getByRole('button').evaluateAll(els=>els.every(e=>e.getBoundingClientRect().height===32))).toBe(true);expect(new Set(metrics.map(m=>Math.round(m.x))).size).toBe(1);
 await page.screenshot({path:`${output}/evidence-policy-${theme}-${width}.png`,animations:'disabled'});
 const help=page.getByRole('button',{name:'Request Lab 원문 처리 안내',exact:true});await help.focus();await expect(page.getByRole('tooltip')).toContainText('현재 탭 메모리');
 const tip=await page.getByRole('tooltip').boundingBox();expect(tip.x).toBeGreaterThanOrEqual(0);expect(tip.x+tip.width).toBeLessThanOrEqual(width);expect(tip.y).toBeGreaterThanOrEqual(0);
 await page.screenshot({path:`${output}/help-${theme}-${width}.png`,animations:'disabled'});await page.keyboard.press('Escape');
 await expect(page.getByRole('tooltip')).toHaveCount(0);
 const pathOverflow=await page.getByRole('button',{name:/GET \/api\/orders\/101 상세 보기/}).first().evaluate(el=>el.scrollWidth>el.clientWidth+1);expect(pathOverflow).toBe(false);
 report.checks.push(`${width}/${theme}: selected masked payload, role dropdown, selection across fold, controls aligned at 32px, help inside viewport, no API mutations`);
 failEvidence=true;await page.goto(origin+'/actual/#surface');await page.goto(origin+'/actual/#evidence');await page.getByRole('button',{name:/GET \/api\/orders\/101 상세 보기/}).first().click();
 await expect(page.getByRole('alert').filter({hasText:'예시 조회 실패'})).toBeVisible({timeout:10000});failEvidence=false;await page.getByRole('button',{name:'다시 시도',exact:true}).click();await expect(page.getByText('Authorization: ***MASKED***',{exact:false}).first()).toBeVisible();
 report.checks.push(`${width}/${theme}: payload query failure and explicit retry recovery`);
 report.captures.push(...['surface','api-detail','api-record','evidence-policy','help'].map(name=>`${name}-${theme}-${width}.png`));
 await context.close();
}
expect(report.errors).toEqual([]);expect(report.external).toEqual([]);expect(report.mutations).toEqual([]);report.passed=true;
}finally{await browser.close();writeFileSync('docs/ux-baseline/final-product-verification.json',JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,captures:report.captures.length,errors:report.errors}));
