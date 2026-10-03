import { chromium, expect } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory=dirname(fileURLToPath(import.meta.url));
const origin='http://127.0.0.1:18843';
function runMessage(){return '응답을 관측 기록으로 보존했습니다.'}
const snapshot=JSON.parse(readFileSync(resolve(directory,'snapshot.json'),'utf8'));
const browser=await chromium.launch({headless:true,channel:'chrome'});
const result={baseline:[],proposals:[],stateCaptures:[],checks:[],errors:[],external:[]};
const routes={accounts:'accounts',human:'inspection',llm:'inspection',surface:'surface',evidence:'evidence'};
const checksOnly=process.argv.includes('--checks-only');
const onlyLlm=process.argv.includes('--llm-only');
const proposalsOnly=process.argv.includes('--proposals-only');

try {
 if(!checksOnly){for(const width of [1280,1920]) for(const theme of ['light','dark']) {
  const context=await browser.newContext({viewport:{width,height:width*9/16},colorScheme:theme});
  await context.addInitScript(({theme})=>{localStorage.setItem('flowscope-theme',theme);localStorage.setItem('flowscope.sidebar','open')},{theme});
  const page=await context.newPage();
  page.on('pageerror',error=>result.errors.push(error.message));
  await page.route('**/*',async route=>{if(new URL(route.request().url()).origin!==origin){result.external.push(route.request().url());await route.abort()}else await route.continue()});
  for(const [screen,route]of Object.entries(routes)) {
   if(onlyLlm&&screen!=='llm')continue;
   const file=`${screen}-${theme}-${width}.png`;
   if(!proposalsOnly){
   await page.goto(`${origin}/baseline/#${route}`);
   if(screen==='human'||screen==='llm')await page.getByRole('tab',{name:screen==='human'?'1 · 직접 둘러보기':'3 · LLM 탐색',exact:true}).click();
   if(screen==='accounts')await expect(page.getByLabel('USER A 연결 상태')).toContainText('ZAP');
   if(screen==='surface')await page.getByRole('button',{name:'상세 보기',exact:true}).first().click();
   if(screen==='evidence')await page.getByRole('button',{name:/GET \/api\/orders\/101 상세 보기/}).first().click();
   if(screen==='graph')await expect(page.locator('svg').first()).toBeVisible();else await expect(page.locator('h1').first()).toBeVisible();
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForTimeout(200);
   await page.screenshot({path:resolve(directory,'captures',file)});
   }else if(!existsSync(resolve(directory,'captures',file)))throw Error('Missing fixed baseline '+file);
   result.baseline.push(file);
   await page.goto(`${origin}/preview.html?screen=${screen}&theme=${theme}&size=${width}${screen==='evidence'?'&policy=open':''}`);
   await expect(page.locator('#app h1')).toBeVisible();
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:resolve(directory,'captures',`proposed-${file}`)});
   result.proposals.push(`proposed-${file}`);
   if(screen==='llm'){await page.goto(`${origin}/preview.html?screen=llm&theme=${theme}&state=running`);await expect(page.locator('.current-message')).toContainText('탐색 중');await page.screenshot({path:resolve(directory,'captures',`running-${file}`)});result.stateCaptures.push(`running-${file}`);await page.locator('#llm-accounts summary').click();await expect(page.locator('.lane-table')).toBeVisible();const loginGeometry=await page.locator('.lane-action button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect(),t=b.querySelector('span').getBoundingClientRect();return {width:r.width,height:r.height,iconX:i.x,iconCenter:Math.abs(i.y+i.height/2-r.y-r.height/2),textCenter:Math.abs(t.y+t.height/2-r.y-r.height/2)}}));if(loginGeometry.some(b=>b.width!==110||b.height!==24||b.iconCenter>.5||b.textCenter>.5)||Math.max(...loginGeometry.map(b=>b.iconX))-Math.min(...loginGeometry.map(b=>b.iconX))>.5)throw Error('Login icon alignment '+JSON.stringify(loginGeometry));await page.screenshot({path:resolve(directory,'captures',`accounts-open-${file}`)});result.stateCaptures.push(`accounts-open-${file}`);await page.locator('#llm-accounts summary').click();await page.locator('#llm-metrics summary').click();await expect(page.locator('#llm-metrics dl')).toBeVisible();await page.screenshot({path:resolve(directory,'captures',`details-open-${file}`)});result.stateCaptures.push(`details-open-${file}`);}

   if(screen==='llm'){const placement=await page.evaluate(()=>{const footer=document.querySelector('.llm-control-footer'),control=document.querySelector('.llm-control'),metrics=document.querySelector('#llm-metrics');return {last:control.lastElementChild===footer,below:footer.getBoundingClientRect().top>=metrics.getBoundingClientRect().bottom,left:Math.abs(document.querySelector('#llm-start').getBoundingClientRect().left-metrics.getBoundingClientRect().left)}});if(!placement.last||!placement.below||placement.left>.5)throw Error('LLM action placement '+JSON.stringify(placement));}
   if(screen==='surface'){const palette=await page.locator('td .method-badge').evaluateAll(elements=>Object.fromEntries(elements.map(e=>[e.textContent,getComputedStyle(e).color])));if(Object.keys(palette).length<3||new Set(Object.values(palette)).size!==Object.keys(palette).length)throw Error('Method colors '+JSON.stringify(palette));const methods=await page.locator('td .method-badge').evaluateAll(elements=>elements.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,delta:Math.abs(e.getBoundingClientRect().x+e.getBoundingClientRect().width/2-(e.closest('td')?.getBoundingClientRect().x??0)-(e.closest('td')?.getBoundingClientRect().width??0)/2)})));if(methods.some(m=>m.w!==60||m.h!==22||m.delta>.5))throw Error('Method alignment '+JSON.stringify(methods));}

   const geometry=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,app:document.querySelector('#app').clientWidth,appScroll:document.querySelector('#app').scrollWidth}));
   if(geometry.scroll>geometry.client||geometry.appScroll>geometry.app)throw Error(`Horizontal overflow ${screen} ${width} ${JSON.stringify(geometry)}`);
  }
  await context.close();
  process.stdout.write(`Captured ${width} ${theme}\n`);
 }
 }else{for(const width of [1280,1920])for(const theme of ['light','dark'])for(const screen of Object.keys(routes)){const file=`${screen}-${theme}-${width}.png`;if(!existsSync(resolve(directory,'captures',file))||!existsSync(resolve(directory,'captures',`proposed-${file}`)))throw Error('Missing captures '+file);result.baseline.push(file);result.proposals.push(`proposed-${file}`);if(screen==='llm')result.stateCaptures.push(`running-${file}`,`accounts-open-${file}`)}}
 if(onlyLlm&&!checksOnly){for(const width of [1280,1920])for(const theme of ['light','dark'])for(const screen of Object.keys(routes).filter(s=>s!=='llm')){const file=`${screen}-${theme}-${width}.png`;if(!existsSync(resolve(directory,'captures',file)))throw Error('Missing prior capture');result.baseline.push(file);result.proposals.push(`proposed-${file}`)}}
 const context=await browser.newContext({viewport:{width:1280,height:720}});
 const page=await context.newPage();
 page.on('pageerror',error=>result.errors.push(error.message));
 await page.goto(origin+'/preview.html?screen=accounts&theme=light');
 for(const account of snapshot.accounts) {
  const card=page.locator('.account-card').filter({hasText:account.label});
  for(const source of ['human','scanner','llm']) {
   const count=snapshot.events.filter(e=>(e.laneAccountId??e.idn)===account.id&&e.source===source&&e.status>0).length;
   await expect(card.locator('.lane').nth(['human','scanner','llm'].indexOf(source))).toContainText(`${count}건`);
  }
 }
 result.checks.push('계정별 H/S/L 건수가 고정 스냅샷과 일치');
 await page.goto(origin+'/preview.html?screen=human');
 await page.getByRole('button',{name:'시작',exact:true}).click();await expect(page.locator('#human-status')).toContainText('기록 중');
 await page.getByRole('button',{name:'종료',exact:true}).click();await expect(page.locator('#human-status')).toContainText('기록 종료');
 await page.locator('#human-traffic [data-event]').first().click();await expect(page.getByRole('dialog')).toContainText('#1');await expect(page.getByRole('dialog')).toContainText(snapshot.events[0].eventId);await page.locator('#raw-close').click();await expect(page.getByRole('dialog')).toHaveCount(0);
 result.checks.push('HUMAN 시작·종료 및 #번호·Evidence ID 원문 보기');
 await page.goto(origin+'/preview.html?screen=llm&state=running');
 await expect(page.locator('.explorer-feed')).toContainText('GET');await expect(page.locator('.explorer-feed')).toContainText(runMessage());await expect(page.locator('.current-message')).toBeVisible();
 await page.getByRole('button',{name:'진행 기록 접기',exact:true}).click();await expect(page.locator('#llm-progress .sheet-body')).toBeHidden();await page.getByRole('button',{name:'진행 기록 펼치기',exact:true}).click();await expect(page.locator('.explorer-feed')).toBeVisible();
 await page.locator('#llm-accounts summary').click();await expect(page.locator('.lane-table')).toBeVisible();await expect(page.getByLabel('USER A 탐색 선택')).toBeChecked();await expect(page.getByRole('button',{name:'다시 로그인',exact:true})).toBeVisible();await page.locator('#llm-accounts summary').click();await expect(page.locator('.lane-table')).toBeHidden();
 await expect(page.locator('#llm-metrics summary')).toContainText('펼치기');await page.locator('#llm-metrics summary').click();await expect(page.locator('#llm-metrics dl')).toBeVisible();await expect(page.locator('#llm-metrics summary')).toContainText('접기');await expect(page.locator('#llm-metrics dd')).toHaveCount(6);await page.locator('#llm-metrics summary').click();await expect(page.locator('#llm-metrics dl')).toBeHidden();
 result.checks.push('LLM 계정·세부정보 펼치기/접기 표시와 6개 정렬 수치');
 await expect(page.getByLabel('실행 중 추가 지시')).toBeInViewport();await expect(page.locator('.explorer-feed .explorer-activity').last()).toBeInViewport();
 await page.getByLabel('실행 중 추가 지시').fill('관측한 GET 경로의 응답을 확인해 주세요.');
 await page.getByRole('button',{name:'보내기'}).click();await expect(page.locator('#steer-status')).toContainText('접수됨');
 await page.locator('#llm-progress [data-event]').first().click();await expect(page.getByRole('dialog')).toContainText('#8');await page.locator('#raw-close').click();
 const hierarchy=await page.evaluate(()=>({message:parseFloat(getComputedStyle(document.querySelector('.current-message')).fontSize),stats:parseFloat(getComputedStyle(document.querySelector('.run-secondary')).fontSize)}));if(hierarchy.message<=hierarchy.stats)throw Error('LLM hierarchy');
 result.checks.push('LLM 기존 진행 기록의 전체 메시지·HTTP 보존, 계정 표·진행 기록 접기, 추가 지시 접수');
 await page.goto(origin+'/preview.html?screen=surface');
 await expect(page.locator('.inspector')).toContainText('응답 관측');
 await page.locator('[data-evidence]').first().click();await expect(page.locator('.inspector')).toContainText('관측 기록');
 const observedIdentity=await page.locator('.observation-meta').textContent();await page.getByText('정책 확인·수정',{exact:true}).click();
 await page.getByRole('button',{name:'LV2',exact:true}).click();await expect(page.getByRole('button',{name:'LV2',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Anony',exact:true}).click();await expect(page.getByRole('button',{name:'Anony',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.observation-meta')).toHaveText(observedIdentity);await page.getByRole('button',{name:'정책 저장'}).click();
 await expect(page.locator('#policy-status')).toContainText('제품에는 저장하지 않았습니다');
 result.checks.push('API 근거 → 같은 Evidence 상세 연결·정책 펼치기');
 result.checks.push('등록 계정과 같은 클릭형 필수 역할 선택, 관측 계정 역할 보존');
 await page.goto(origin+'/preview.html?screen=surface');
 await expect(page.getByRole('columnheader',{name:'Method',exact:true})).toBeVisible();await expect(page.getByRole('columnheader',{name:'API',exact:true})).toBeVisible();
 for(const name of ['H','S','L'])await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
 await expect(page.getByText('실제 응답 있음',{exact:true})).toHaveCount(0);await expect(page.locator('.source-marks').first()).toContainText('HSL');
 const codes=await page.locator('.api-table .http-status').evaluateAll(elements=>Object.fromEntries(elements.map(e=>[e.textContent,getComputedStyle(e).color])));if(codes['200']===codes['403'])throw Error('HTTP status colors');
 result.checks.push('API Method/API 분리, 출처 한 칸의 H S L, HTTP 코드 색상');
 if(!checksOnly)result.checks.push(onlyLlm?'양쪽 테마·해상도의 LLM 실행 버튼 하단 배치 및 로그인 문 아이콘·텍스트 정렬':'양쪽 테마·해상도의 Method별 구분 색상, 60×22 배지 및 가운데 정렬');
 await page.goto(origin+'/preview.html?screen=llm&state=steer-failed');await page.getByLabel('실행 중 추가 지시').fill('응답 확인');await page.getByRole('button',{name:'보내기',exact:true}).click();await expect(page.locator('#steer-status')).toContainText('전송 실패');await expect(page.getByLabel('실행 중 추가 지시')).toHaveValue('응답 확인');
 result.checks.push('추가 지시 전송 실패 시 입력 보존');
 await page.goto(origin+'/preview.html?screen=evidence&state=failed');
 await page.getByRole('button',{name:'다시 시도'}).click();await expect(page.locator('[role=alert]')).toHaveCount(0);
 result.checks.push('조회 실패·재시도 시뮬레이션');
 await page.goto(origin+'/');await expect(page.locator('.comparison article')).toHaveCount(4);
 for(const image of await page.locator('.capture-frame img').all()){await expect(image).toHaveJSProperty('complete',true);await expect(image).not.toHaveJSProperty('naturalWidth',0);}
 result.checks.push('다크·라이트 전후 비교 4개 패널 표시');
 await page.screenshot({path:resolve(directory,'captures','comparison-1280.png'),fullPage:true});
 await page.getByRole('tab',{name:'LLM 탐색',exact:true}).click();await page.locator('#state').selectOption('normal');await expect(page.frameLocator('#after-light').locator('#llm-clear')).toBeVisible();for(const theme of ['light','dark'])await page.frameLocator('#after-'+theme).locator('#llm-accounts summary').click();await expect(page.frameLocator('#after-dark').locator('.lane-table')).toBeVisible();await page.screenshot({path:resolve(directory,'captures','comparison-llm-v6.png'),fullPage:true});
 await page.getByRole('tab',{name:'API·입력 차이',exact:true}).click();await page.locator('#state').selectOption('normal');await expect(page.frameLocator('#after-light').locator('.api-table')).toBeVisible();await page.screenshot({path:resolve(directory,'captures','comparison-api-v2.png'),fullPage:true});

 await context.close();
 if(result.errors.length||result.external.length)throw Error(JSON.stringify({errors:result.errors,external:result.external}));
 writeFileSync(resolve(directory,'verification.json'),JSON.stringify(result,null,2)+'\n');
 process.stdout.write(JSON.stringify({baseline:result.baseline.length,proposals:result.proposals.length,checks:result.checks.length,errors:result.errors.length,external:result.external.length})+'\n');
} finally {await browser.close()}
