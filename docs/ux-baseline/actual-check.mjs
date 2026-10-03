import { chromium, expect } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory=dirname(fileURLToPath(import.meta.url));
const origin='http://127.0.0.1:18843';
const snapshot=JSON.parse(readFileSync(resolve(directory,'snapshot.json'),'utf8'));
const explorer=await (await fetch(origin+'/api/explorer-run')).json();
const captures=resolve(directory,'actual-captures');mkdirSync(captures,{recursive:true});
const result={viewports:[[1280,720],[1920,1080]],themes:['light','dark'],captures:[],checks:[],errors:[],external:[],mutations:[]};
const browser=await chromium.launch({headless:true,channel:'chrome'});
const screens={accounts:'accounts',human:'inspection',llm:'inspection',surface:'surface',evidence:'evidence'};
const counts=id=>Object.fromEntries(['human','scanner','llm'].map(source=>[source,snapshot.events.filter(e=>(e.laneAccountId?.trim()||e.idn)===id&&e.source===source&&e.status>=100&&e.status<=599).length]));
try {
 for(const [width,height] of result.viewports) for(const theme of result.themes) {
  const context=await browser.newContext({viewport:{width,height},colorScheme:theme});
  await context.addInitScript(theme=>{localStorage.setItem('flowscope-theme',theme);localStorage.setItem('flowscope.sidebar','open')},theme);
  const page=await context.newPage();
  page.on('pageerror',error=>result.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')result.errors.push(message.text())});
  await page.route('**/*',async route=>{
    const request=route.request();
    if(new URL(request.url()).origin!==origin){result.external.push(new URL(request.url()).origin);return route.abort()}
    if(request.method()==='POST'){result.mutations.push(new URL(request.url()).pathname);return route.abort()}
    return route.continue();
  });
  for(const [screen,hash] of Object.entries(screens)) {
   await page.goto(`${origin}/actual/#${hash}`);
   if(screen==='human'||screen==='llm')await page.getByRole('tab',{name:screen==='human'?'1 · 직접 둘러보기':'3 · LLM 탐색',exact:true}).click();
   if(screen==='accounts')for(const account of snapshot.accounts){const lane=page.getByLabel(account.label+' 연결 상태');for(const [source,value]of Object.entries(counts(account.id))){const label=source==='scanner'?'ZAP':source.toUpperCase();await expect(lane).toContainText(new RegExp(`${label}[\\s\\S]*?${value}건`))}}
   if(screen==='human'){
     await expect(page.getByLabel('HUMAN 상태')).toContainText('완료');
     await expect(page.getByText('계정 선택 → 시작 → 서비스 탐색 → 종료.',{exact:false})).toBeVisible();
   }
   if(screen==='llm'){
     await expect(page.getByLabel('LLM 진행 메시지 및 수집 트래픽')).toContainText('탐색 요약');
     await expect(page.getByText('탐색 종료 · 일부 화면과 입력은 확인하지 못했습니다.')).toBeVisible();
     await expect(page.getByRole('progressbar')).toHaveCount(0);
     const box=await page.getByLabel('Explorer에게 추가 지시').boundingBox();if(box.y+box.height>height)throw new Error('LLM instruction input below initial viewport');
     await page.getByRole('button',{name:/^탐색할 계정/}).click();
     const buttons=page.getByRole('button',{name:/브라우저 로그인/});
     const geometry=await buttons.evaluateAll(elements=>elements.map(el=>{const rect=el.getBoundingClientRect(),icon=el.querySelector('svg').getBoundingClientRect();return {width:rect.width,height:rect.height,iconX:icon.x-rect.x,iconCenter:icon.y+icon.height/2-rect.y-rect.height/2}}));
     for(const rect of geometry){expect(rect.width).toBe(110);expect(rect.height).toBe(24);expect(Math.abs(rect.iconCenter)).toBeLessThan(0.6)}
     expect(new Set(geometry.map(rect=>rect.iconX)).size).toBe(1);
     await page.getByRole('button',{name:/^탐색할 계정/}).click();
   }
   if(screen==='surface'){
     await expect(page.getByRole('columnheader',{name:'Method',exact:true})).toBeVisible();
     const row=page.getByRole('row').filter({hasText:'/api/orders/{id}'}).filter({has:page.getByText('GET',{exact:true})}).first();
     await row.getByRole('button',{name:'상세 보기',exact:true}).click();
     await expect(page.getByLabel('API 입력 필드 비교')).toContainText('PATH');
     await expect(page.getByText('실제 응답 있음',{exact:false})).toHaveCount(0);
   }
   if(screen==='evidence'){
     await expect(page.getByRole('columnheader',{name:'Method',exact:true})).toBeVisible();
     await page.getByRole('button',{name:/GET \/api\/orders\/101 상세 보기/}).first().click();
     await expect(page.getByRole('heading',{name:'관측 기록 상세',exact:true})).toBeVisible();
     await expect(page.getByText('Authorization: ***MASKED***',{exact:false}).first()).toBeVisible();
     await expect(page.getByLabel('정책 작업')).not.toHaveAttribute('open','');
   }
   await page.evaluate(()=>document.fonts.ready);
   const file=`${screen}-${theme}-${width}.png`;await page.screenshot({path:resolve(captures,file)});result.captures.push(file);
   if(screen==='llm'){
     await page.getByRole('button',{name:/^실행 세부정보/}).click();
     await expect(page.getByText('브라우저 탐색 중',{exact:true})).toHaveCount(0);
     await expect(page.getByText('화면 상태 조회 횟수',{exact:true})).toBeVisible();
     await page.screenshot({path:resolve(captures,`llm-details-${theme}-${width}.png`)});
   }
   if(screen==='evidence'){
     const summary=page.getByText('정책 편집 · 펼치기/접기',{exact:true});await summary.click();
     await page.getByRole('button',{name:'LV2',exact:true}).click();await expect(page.getByLabel('필수 역할',{exact:true})).toHaveValue('LV2');
     await page.screenshot({path:resolve(captures,`evidence-policy-${theme}-${width}.png`)});
   }
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error(`${screen} document horizontal overflow`);
  }
  await page.goto(origin+'/actual/#inspection');await page.getByRole('tab',{name:'4 · 결과 비교',exact:true}).click();
  await page.getByRole('link',{name:'계정·세션',exact:true}).click();
  await page.getByRole('article',{name:'USER A 계정',exact:true}).getByRole('button',{name:'이 계정으로 수집',exact:true}).click();
  await expect(page.getByRole('tab',{name:'1 · 직접 둘러보기',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('combobox',{name:'HUMAN pass 계정',exact:true})).toContainText('USER A');
  result.checks.push(`${width} ${theme}: completed-run account handoff opens HUMAN`);
  result.checks.push(`${width} ${theme}: counts, layouts, terminal LLM, disclosures, icons, API inputs, masked Evidence, role choice`);
  await context.close();
 }
 // Real UI controls, simulated HTTP responses only. No provider/collector is invoked.
 const context=await browser.newContext({viewport:{width:1280,height:720}});
 const page=await context.newPage();let failed=true;let submitted=0;
 await page.route('**/api/explorer-run',async route=>{
   const running={...explorer,run:{...explorer.run,status:'RUNNING',message:'프로젝트 상세 탐색 중',endedAt:null}};
   if(route.request().method()==='POST'){submitted++;return route.fulfill({status:failed?400:200,contentType:'application/json',body:JSON.stringify(failed?{message:'예시 전송 실패'}:{run:running.run})})}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(running)});
 });
 await page.goto(origin+'/actual/#inspection');await page.getByRole('tab',{name:'3 · LLM 탐색',exact:true}).click();
 await expect(page.getByText('프로젝트 상세 탐색 중')).toBeVisible();
 await page.getByLabel('Explorer에게 추가 지시').fill('다음 화면 확인');await page.getByRole('button',{name:'메시지 전송',exact:true}).click();
 await expect(page.getByText('전송 실패 · 내용을 확인하고 다시 전송하세요.')).toBeVisible();await expect(page.getByLabel('Explorer에게 추가 지시')).toHaveValue('다음 화면 확인');
 await page.screenshot({path:resolve(captures,'llm-steer-failed-light-1280.png')});
 failed=false;await page.getByRole('button',{name:'메시지 전송',exact:true}).click();await expect(page.getByText('서버 전송 완료')).toBeVisible();await expect(page.getByLabel('Explorer에게 추가 지시')).toHaveValue('');expect(submitted).toBe(2);
 await page.getByRole('button',{name:'진행 기록 접기',exact:true}).click();await expect(page.getByLabel('LLM 진행 메시지 및 수집 트래픽')).toHaveCount(0);await expect(page.getByText('프로젝트 상세 탐색 중')).toBeVisible();
 result.checks.push('Running messages, failed transmission retention, retry success, collapse without losing current state (mocked HTTP)');
 await context.close();
 expect(result.errors).toEqual([]);expect(result.external).toEqual([]);expect(result.mutations).toEqual([]);
 result.checks.push('No browser errors, external requests or real mutations');
} finally {await browser.close();writeFileSync(resolve(directory,'actual-verification.json'),JSON.stringify(result,null,2)+'\n')}
process.stdout.write(JSON.stringify({captures:result.captures.length,checks:result.checks.length,errors:result.errors.length})+'\n');
