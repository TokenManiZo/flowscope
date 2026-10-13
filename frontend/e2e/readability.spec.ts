import {expect,test,type Page} from "@playwright/test"
import {emptyGraphWorkspace} from "../src/features/graph/graphWorkspace"
import {snapshotFixture,humanRunFixture,scannerRunFixture,zapStatusFixture} from "../src/test/fixtures"
import type {Cell,EventRecord,LlmFinding} from "../src/lib/api/types"

const operation="https://shop.synthetic.test GET /api/orders/{id}"
const event={eventId:"ev-size",method:"GET",path:"/api/orders/101",status:200,source:"human",idn:"user-a",role:"USER",op:operation,resource:"orders:101",timestamp:1,fp:"",sourceDetail:"BROWSER",orchestrator:"HUMAN",tool:"BROWSER",phase:"DISCOVERY",executionTrust:"OBSERVED",runId:"run",authState:"AUTH",classificationOverride:false,classificationReasons:[],pathTemplateStatus:"CORROBORATED",pathTemplateReasons:[],clusterId:"size",repeatCount:1,firstSeen:1,lastSeen:1,verdict:"allow",trafficClass:"API",trafficDisposition:"INCLUDE",coverageEligible:true,objects:[],clusterEvidenceIds:["ev-size"]} as EventRecord
const cell:Cell={idn:"user-a",op:operation,resource:"orders:101",perSource:{human:"allow"},reasons:{},overall:"allow",conflict:false,missedSources:[],evidenceIds:[event.eventId]}
const finding:LlmFinding={id:"size-finding",operation,identity:"user-a",verdict:"",confidence:"",note:"합성 예시",evidenceIds:[event.eventId],createdAt:1,judgment:"inconclusive",issueTitle:"정책 확인 필요 · 합성 예시",verificationResult:"권한 정책을 추가로 확인해야 합니다. ".repeat(12),judgmentBasis:"이 데이터는 읽기 화면 확인용 합성 예시입니다.",judgmentReason:"합성 분석",judgmentEvidenceIds:[event.eventId],judgedAt:2}
async function syntheticApi(page:Page){
 page.on("pageerror",error=>console.error("PRODUCT PAGE ERROR",error.message));page.on("console",msg=>{if(msg.type()==="error")console.error("PRODUCT CONSOLE",msg.text())})
 await page.addInitScript(()=>{localStorage.setItem("flowscope-theme","dark");localStorage.setItem("flowscope.sidebar","open")})
 const snapshot={...snapshotFixture,datasetRevision:1,events:[event],cells:[cell],activeSources:["human"],evidenceOrdinals:{[event.eventId]:1},accounts:[{id:"user-a",label:"USER A",role:"USER",target:"https://shop.synthetic.test",color:"",authArtifactCount:0}]}
 const values:Record<string,unknown>={"/api/snapshot":snapshot,"/api/projects":{active:null,projects:[],saveState:"UNMANAGED"},"/api/human-run":humanRunFixture,"/api/scanner-run":scannerRunFixture,"/api/zap-status":zapStatusFixture,"/api/explorer-run":{run:{status:"IDLE",providerReadiness:"READY",unresolved:[],activities:[],accountIds:[],anonymous:false},accounts:[],scope:[]},"/api/explorer-models":{configuredModel:"synthetic",models:[{id:"synthetic",label:"합성 모델",recommended:true}]},"/api/llm-findings":{findings:[finding]},"/api/llm-verify":{status:"SUCCEEDED",accountId:"",message:"합성 검증",startedAt:1,endedAt:2},"/api/llm-feed":{entries:[{seq:1,timestamp:1,type:"assistant",summary:"Codex 답변: 합성 예시의 긴 답변입니다. ".repeat(8),risk:false},{seq:2,timestamp:1,type:"resend",summary:"재전송: GET /api/orders/101 · HTTP 200",risk:false,evidenceId:event.eventId},{seq:3,timestamp:1,type:"verdict",summary:"합성 판정 열기",risk:false,findingId:finding.id}]},"/api/matrix-exclusions":{datasetRevision:1,entries:[]},"/api/graph-workspace":{datasetRevision:1,revision:1,workspace:emptyGraphWorkspace}}
 await page.route("**/api/**",route=>{const path=new URL(route.request().url()).pathname;return path.startsWith("/api/")?route.fulfill({json:values[path]??{}}):route.continue()})
}
for(const width of [600,1280,1920,2560]){
 test(`LLM sizing and reading layout at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:1080});await syntheticApi(page);await page.goto("./#llm-judgment")
  await expect(page.getByRole("button",{name:"합성 판정 열기"})).toBeVisible()
  const rows=page.getByLabel("LLM 판정 진행 기록").locator("article")
  for(const row of await rows.all()){
   const time=row.locator(":scope > span:last-child")
   expect(await time.evaluate(el=>getComputedStyle(el).whiteSpace)).toBe("nowrap")
   const positions=await row.evaluate(el=>{const rect=el.getBoundingClientRect(),badge=el.firstElementChild!.getBoundingClientRect();return{row:rect.y+rect.height/2,badge:badge.y+badge.height/2}})
   expect(Math.abs(positions.row-positions.badge)).toBeLessThan(2)
  }
  const send=rows.filter({hasText:"재전송: GET"});const badge=send.getByText("200",{exact:true})
  expect(await badge.evaluate(el=>el.closest("article")!.children[1].contains(el))).toBe(true)
  await page.getByRole("button",{name:/^판정 범위/}).click()
  expect(await page.getByText("판정 매트릭스에서 가져오기",{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18)
  await page.getByRole("button",{name:"합성 판정 열기"}).click()
  const summary=page.getByRole("region",{name:"판정 요약"})
  expect(await summary.getByRole("heading").evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(22)
  expect(await summary.locator("li > span").first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(20)
  await page.getByRole("button",{name:"전체 보기",exact:true}).click()
  const dialog=page.getByRole("dialog"),regions=await dialog.locator('section[aria-label]').all()
  const bounds=await Promise.all(regions.map(region=>region.boundingBox()))
  expect(bounds[1]!.y).toBeGreaterThan(bounds[0]!.y)
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(width*.85)
  await page.screenshot({path:info.outputPath("llm-detail.png")})
 })
}
test("graph help, input padding, quiet actions and persistent minimap",async({page},info)=>{
 await page.setViewportSize({width:1920,height:1080});await syntheticApi(page);await page.goto("./#graph")
 const help=page.getByRole("button",{name:"그래프 필터 도움말"})
 await expect(help).toBeVisible();await expect(page.getByText("출처·계정·응답을 고르면 관련 연결을 강조합니다.")).toHaveCount(0)
 await help.click();await expect(page.getByText("출처·계정·응답을 고르면 관련 연결을 강조합니다.")).toBeVisible();await page.keyboard.press("Escape")
 const search=page.getByRole("combobox",{name:"프로젝트 전체 노드 검색"})
 expect(await search.evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(36)
 const rail=page.getByRole("region",{name:"그래프 필터"}),actions=["자동 정렬","배치 고정","그래프 초기화"]
 const positions=[]
 for(const name of actions){const button=rail.getByRole("button",{name,exact:true});expect(await button.evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth))).toBe(0);positions.push((await button.boundingBox())!)}
 expect(positions[1].y).toBeGreaterThan(positions[0].y);expect(positions[2].y).toBeGreaterThan(positions[1].y)
 await expect(page.getByRole("button",{name:"미니맵 접기"})).toBeVisible();await page.getByRole("button",{name:"미니맵 접기"}).click();await expect(page.getByRole("button",{name:"미니맵 펼치기"})).toHaveText("+")
 await page.getByRole("link",{name:"요청 기록",exact:true}).click();await page.getByRole("link",{name:"점검 그래프",exact:true}).click()
 await expect(page.getByRole("button",{name:"미니맵 펼치기"})).toBeVisible();await page.getByRole("button",{name:"미니맵 펼치기"}).click();await expect(page.getByRole("img",{name:"그래프 미니맵"})).toBeVisible()
 await page.screenshot({path:info.outputPath("graph.png")})
})

for (const width of [600, 1920]) {
 test(`larger project manager and unclipped browser login at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:1080}); await syntheticApi(page)
  const project = {id:"synthetic-project",name:"읽기 크기 확인",scope:["https://shop.synthetic.test"],createdAt:"2026-10-14",modifiedAtMillis:1,sizeBytes:1024,active:true,readable:true,managed:true}
  await page.route("**/api/projects", route => route.fulfill({json:{active:project,projects:[project,{...project,id:"other",name:"다른 프로젝트",active:false}],saveState:"SAVED"}}))
  await page.goto("./#inspection")
  await page.getByRole("tab",{name:"LLM 탐색",exact:true}).click()
  await page.getByRole("button",{name:/^판정할 계정|^탐색할 계정|^탐색 계정/}).click()
  const login = page.getByRole("button",{name:/브라우저 로그인/}).first()
  await expect(login).toBeVisible()
  expect((await login.boundingBox())!.width).toBeGreaterThanOrEqual(164)
  expect(await login.locator("span").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  if (width < 1024) await page.getByRole("button",{name:"메뉴 열기",exact:true}).click()
  await page.getByRole("button",{name:"프로젝트 관리",exact:true}).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect.poll(async () => Math.round(parseFloat(await dialog.evaluate(el => getComputedStyle(el).width)))).toBe(width < 1040 ? width-24 : 1040)
  expect(await dialog.getByRole("heading",{name:"프로젝트 관리",exact:true}).evaluate(el => getComputedStyle(el).fontSize)).toBe("28px")
  expect((await dialog.getByRole("list",{name:"프로젝트 목록"}).locator("li > div").first().boundingBox())!.height).toBeGreaterThanOrEqual(76)
  await page.screenshot({path:info.outputPath("project-manager.png")})
 })
}
test("graph inspector preserves large API action targets",async({page})=>{
 await page.setViewportSize({width:1920,height:1080}); await syntheticApi(page); await page.goto("./#graph")
 await page.getByRole("combobox",{name:"프로젝트 전체 노드 검색"}).fill("/api/orders")
 await page.getByRole("option",{name:/^API GET/}).first().click()
 const inspector = page.getByRole("complementary",{name:"선택 작업",exact:true})
 for (const name of ["API 하이라이트","취약점으로 표시","API 삭제"]) {
  const button = inspector.getByRole("button",{name,exact:true})
  await expect(button).toBeVisible()
  const box = (await button.boundingBox())!
  expect(box.width).toBe(58); expect(box.height).toBe(58)
  expect(await button.locator("svg").evaluate(el=>el.getBoundingClientRect().width)).toBe(30)
 }
})

for (const width of [600, 1280, 2560]) {
 test(`dashboard remains readable without horizontal overflow at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width,height:1080}); await syntheticApi(page)
  const endpoints = Array.from({length:8},(_,i)=>({key:{service:"https://shop.synthetic.test",method:"GET",pathTemplate:`/workshop/api/merchant/service_requests/${i}`},observedSources:["HUMAN"],declarations:[],parameters:[]}))
  await page.route("**/api/snapshot",route=>route.fulfill({json:{...snapshotFixture,
   events:endpoints.map((endpoint,i)=>({...event,eventId:`dashboard-${i}`,path:endpoint.key.pathTemplate,lastSeen:1791928800000+i})),
   trafficStats:{...snapshotFixture.trafficStats,captured:8,coverage:8},
   surface:{...snapshotFixture.surface,endpoints,parameterGaps:endpoints.slice(0,5).map((endpoint,i)=>({id:`gap-${i}`,endpoint:endpoint.key,status:"OPEN",type:"AUTH_VARIANT_UNTESTED",priorityReasons:["AUTH_VARIANT_UNTESTED","HUMAN_REVIEW_REQUIRED"]}))},
   scenarios:[{id:"dashboard-scenario",title:"다른 계정 주문 조회",risk:"HIGH",reviewStatus:"UNRESOLVED"}],
  }}))
  await page.goto("./#dashboard")
  const dashboard = page.locator(".flowscope-dashboard")
  await expect(dashboard.getByRole("heading",{name:"보안 점검 대시보드"})).toBeVisible()
  expect(await dashboard.locator("h1").evaluate(el=>getComputedStyle(el).fontSize)).toBe("32px")
  const recent = dashboard.getByRole("region",{name:"최근 관측"})
  await expect(recent.locator("li")).toHaveCount(6)
  expect(await recent.locator(".font-mono").first().evaluate(el=>getComputedStyle(el).fontSize)).toBe("18px")
  expect(await recent.locator("[data-dashboard-time]").first().evaluate(el=>getComputedStyle(el).whiteSpace)).toBe("nowrap")
  const priority = dashboard.getByRole("region",{name:"우선 점검 API"})
  const candidate = dashboard.getByRole("region",{name:"IDOR·BFLA 의심"})
  expect((await candidate.boundingBox())!.height).toBeLessThan((await priority.boundingBox())!.height)
  const coverage = dashboard.getByRole("region",{name:"출처별 발견"})
  expect(await coverage.locator(".font-mono").nth(1).evaluate(el=>getComputedStyle(el).fontSize)).toBe("18px")
  expect(await page.getByRole("main").evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1)
  const time=(await recent.locator("[data-dashboard-time]").first().boundingBox())!,card=(await recent.boundingBox())!
  expect(time.x+time.width).toBeLessThanOrEqual(card.x+card.width)
  await page.screenshot({path:info.outputPath("dashboard.png")})
 })
}
