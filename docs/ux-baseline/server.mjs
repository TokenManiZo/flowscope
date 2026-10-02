import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const app = resolve(directory, '../../target/generated-resources/react-web');
const baselineApp = process.env.BASELINE_APP ? resolve(process.env.BASELINE_APP) : app;
export const snapshot = JSON.parse(readFileSync(resolve(directory, 'snapshot.json'), 'utf8'));
const target = snapshot.accounts[0].target;
const llmEvents = snapshot.events.filter(e => e.source === 'llm');
const stamp = '2026-10-02T10:15:06Z';
export const explorer = {
  run: { status: 'COMPLETED_WITH_LIMITATIONS', runId: 'demo-llm-explorer', target,
    startedAt: '2026-10-02T10:00:00Z', endedAt: stamp, elapsedMillis: 906000,
    message: '탐색 종료 · 일부 화면과 입력은 확인하지 못했습니다.', providerReadiness: 'READY',
    accountIds: ['acct-demo-user-a'], anonymous: false, attempts: llmEvents.length, responses: llmEvents.length,
    endpointDeclarations: 0, parameterDeclarations: 0, capabilityProbes: 0,
    unresolved: [{kind:'browser_tool_failure',target:'USER A',reason:'화면 상태 조회 도구가 실패해 추가 화면을 확인하지 못했습니다.'},
      {kind:'unexecuted_write_workflows',target:'요청 변경',reason:'데이터를 변경하는 요청은 실행하지 않았습니다.'}],
    activities: [...llmEvents.map((e,i)=>({sequence:i+1,at:stamp,kind:'HTTP',title:`${e.method} ${e.path}`,detail:`USER A · HTTP ${e.status} · ${e.eventId}`,status:'HTTP_RESPONSE',durationMillis:5})),
      {sequence:llmEvents.length+1,at:stamp,kind:'MODEL',title:'탐색 요약',detail:'응답을 관측 기록으로 보존했습니다. 미확인 항목은 별도로 남겼습니다.',status:'COMPLETED',durationMillis:null}]
  },
  browser:{actions:18,maxActions:300,snapshots:22,endpoints:new Set(llmEvents.map(e=>e.method+' '+e.path)).size,elapsedMillis:1792000,minutes:15},
  accounts:[{id:'acct-demo-user-a',label:'USER A',role:'User',loginUrl:target,status:'READY',message:'목업 예시',updatedAt:stamp,cookieCount:0,headerNames:[],browserOpen:true}],
  scope:[target+'/']
};

function accountSettings(id) {
  const account=snapshot.accounts.find(a=>a.id===id);
  return {...account,human:{status:'ACTIVE',verificationSource:'OPERATOR_ASSERTED',lastCheckedLabel:'방금',credentialConflict:false,lastRecordedAt:new Date(Math.max(...snapshot.events.filter(e=>(e.laneAccountId??e.idn)===id&&e.source==='human').map(e=>e.timestamp))).toISOString()},
    proofRule:{method:'GET',path:'/api/me',responseMark:''},candidates:[],candidateBlockReasons:[],
    zap:{enabled:true,status:'VERIFIED_BY_ZAP',loginUrl:target+'/login',loginId:'',hasPassword:false,connectionLabel:'연결됨',failureReason:''},
    llm:{enabled:id==='acct-demo-user-a',status:id==='acct-demo-user-a'?'READY':'UNVERIFIED',failureReason:''}};
}

function api(url) {
  switch(url.pathname) {
    case '/api/snapshot': return snapshot;
    case '/api/projects': return {directory:'목업 전용',active:{id:'demo',name:'QA 비교 예시',path:'',scope:[target+'/'],active:true},projects:[],saveState:'UNMANAGED'};
    case '/api/human-run': return {active:false,completed:true,runId:'demo-human',accountId:'acct-demo-user-a',proxy:'http://127.0.0.1:8080'};
    case '/api/zap-status': return {connected:true,managedRuntime:true,state:'READY',message:'목업 예시'};
    case '/api/scanner-run': return {run:{status:'COMPLETED'},accounts:[],scope:[target+'/']};
    case '/api/explorer-run': return explorer;
    case '/api/account-settings': return accountSettings(url.searchParams.get('account'));
    case '/api/request-lab': {
      const event=snapshot.events.find(e=>e.eventId===url.searchParams.get('eventId'));
      if(!event)return {success:false,message:'예시 기록 없음'};
      return {eventId:event.eventId,service:target,request:`${event.method} ${event.path} HTTP/1.1\nHost: demo.flowscope.test\nAuthorization: ***MASKED***\n`,response:`HTTP/1.1 ${event.status}\nContent-Type: application/json\n\n{"example":true}`,observedIdentity:event.idn,rawRequestRetained:true,rawResponseRetained:true,message:'합성된 마스킹 예시 · 실제 점검 결과 아님'};
    }
    case '/api/evidence': {
      const records=snapshot.events.filter(e=>e.op===url.searchParams.get('operation')).map(e=>({...e,
        request:`${e.method} ${e.path} HTTP/1.1\nHost: demo.flowscope.test\nAuthorization: ***MASKED***\n`,
        response:`HTTP/1.1 ${e.status}\nContent-Type: application/json\n\n{"example":true}`,classificationReasons:e.classificationReasons,
        requestBody:'',responseBody:'',requestPayload:null,responsePayload:null}));
      const offset=Number(url.searchParams.get("offset")??0),limit=Number(url.searchParams.get("limit")??200);
      return {records:records.slice(offset,offset+limit),total:records.length,offset,limit,hasMore:offset+limit<records.length};
    }
    default:return {success:false,message:'목업에 없는 조회입니다.'};
  }
}

const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.woff2':'font/woff2'};
createServer((request,response)=>{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end('Read-only mockup');return;}
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){response.writeHead(200,{'Content-Type':types['.json'],'Cache-Control':'no-store'});response.end(JSON.stringify(api(url)));return;}
  const isBaseline=url.pathname.startsWith('/baseline/');
  const isActual=url.pathname.startsWith('/actual/');
  const root=isBaseline?baselineApp:isActual?app:directory;
  const relative=isBaseline?url.pathname.slice('/baseline/'.length):isActual?url.pathname.slice('/actual/'.length):url.pathname.slice(1);
  const path=resolve(root,relative||'index.html');
  if(!path.startsWith(root+'/') || !statSafe(path)){response.writeHead(404);response.end('Not found');return;}
  response.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream','Cache-Control':'no-store'});
  response.end(request.method==='HEAD'?undefined:readFileSync(path));
}).listen(Number(process.env.PORT??18843),'127.0.0.1',()=>process.stdout.write('Mockup: http://127.0.0.1:18843/\n'));
function statSafe(path){try{return statSync(path).isFile()}catch{return false}}
