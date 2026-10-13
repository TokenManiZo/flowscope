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
 const values:Record<string,unknown>={"/api/snapshot":snapshot,"/api/projects":{active:null,projects:[],saveState:"UNMANAGED"},"/api/human-run":humanRunFixture,"/api/scanner-run":scannerRunFixture,"/api/zap-status":zapStatusFixture,"/api/explorer-run":{run:{status:"IDLE",providerReadiness:"READY"},accounts:[],scope:[]},"/api/explorer-models":{configuredModel:"synthetic",models:[{id:"synthetic",label:"합성 모델",recommended:true}]},"/api/llm-findings":{findings:[finding]},"/api/llm-verify":{status:"SUCCEEDED",accountId:"",message:"합성 검증",startedAt:1,endedAt:2},"/api/llm-feed":{entries:[{seq:1,timestamp:1,type:"assistant",summary:"Codex 답변: 합성 예시의 긴 답변입니다. ".repeat(8),risk:false},{seq:2,timestamp:1,type:"resend",summary:"재전송: GET /api/orders/101 · HTTP 200",risk:false,evidenceId:event.eventId},{seq:3,timestamp:1,type:"verdict",summary:"합성 판정 열기",risk:false,findingId:finding.id}]},"/api/matrix-exclusions":{datasetRevision:1,entries:[]},"/api/graph-workspace":{datasetRevision:1,revision:1,workspace:emptyGraphWorkspace}}
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
