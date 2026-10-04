/* Standalone proposal: synthetic, redacted data only; no API calls or persistence. */
const icons = {
  scope: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  filter: '<path d="M3 4h18l-7 8v7l-4 2v-9Z"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  map: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="7" y="8" width="8" height="6" rx="1"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 9M3 4v6h6"/>',
  marker: '<path d="m14 3 7 7-9 9-7-7Z"/><path d="m5 12-2 7 2 2 7-2M2 22h7"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  wrap: '<path d="M3 5h18M3 10h13a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M3 16h4"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = selector => document.querySelector(selector);
const apis = [
  {id:'profile',method:'GET',path:'/api/users/me/profile',declared:1,params:[['query','expand','string']],object:'user:a'},
  {id:'issues',method:'GET',path:'/acme/projects/{id}/issues',declared:0,params:[['path','id','integer'],['query','page','integer']],object:'issue:101'},
  {id:'settings',method:'GET',path:'/api/users/me/settings',declared:1,params:[],object:null},
  {id:'forgot',method:'POST',path:'/accounts/forgot-password',declared:1,params:[['body','email','string']],object:null},
  {id:'reset',method:'POST',path:'/accounts/reset-password',declared:1,params:[['body','password','string']],object:null},
  {id:'assets',method:'GET',path:'/api/assets/v2/user-assets',declared:1,params:[],object:null},
  {id:'signup',method:'POST',path:'/accounts/sign-up',declared:1,params:[['body','email','string']],object:null},
];
const seedRecords = [
  {id:1,api:'profile',source:'H',identity:'user-a',status:200,time:'14:32:08',repeat:1},
  {id:2,api:'profile',source:'S',identity:'user-a',status:200,time:'14:32:16',repeat:3},
  {id:3,api:'profile',source:'L',identity:'anon',status:401,time:'14:32:21',repeat:1},
  {id:4,api:'issues',source:'S',identity:'user-a',status:200,time:'14:33:02',repeat:1,review:true},
  {id:5,api:'issues',source:'H',identity:'user-a',status:200,time:'14:33:14',repeat:1,review:true},
  {id:6,api:'settings',source:'H',identity:'user-a',status:200,time:'14:34:01',repeat:2},
  {id:7,api:'settings',source:'S',identity:'anon',status:403,time:'14:34:18',repeat:1},
  {id:8,api:'settings',source:'H',identity:'user-a',status:200,time:'14:34:30',repeat:1,hidden:true},
];
const state = {page:'records',records:structuredClone(seedRecords),deleted:new Set(),selectedRecord:1,selectedApi:'profile',selectedNode:'profile',recordTab:'main',recordSearch:'',recordSources:new Set(['H','S','L']),apiSearch:'',apiFilter:'all',apiFiltersOpen:false,graphSources:new Set(['H','S','L']),graphIdentities:new Set(['user-a','anon']),graphStatuses:new Set(['2','4']),graphSearch:'',zoom:1,pan:{x:0,y:0},minimap:true,font:13,wrap:false,ratio:50,expanded:false};
const highlightColors = [
  {id:'red',name:'빨강',color:'#f29b9b',surface:'#34222c'},
  {id:'orange',name:'주황',color:'#f2b77d',surface:'#342b23'},
  {id:'yellow',name:'노랑',color:'#e8d47d',surface:'#302d21'},
  {id:'green',name:'초록',color:'#86c9a3',surface:'#1d302c'},
  {id:'cyan',name:'청록',color:'#84cbd2',surface:'#1c2e34'},
  {id:'blue',name:'파랑',color:'#90baf0',surface:'#202d40'},
  {id:'pink',name:'분홍',color:'#eda6c9',surface:'#332436'},
  {id:'magenta',name:'자홍',color:'#cba7ed',surface:'#2d2540'},
  {id:'gray',name:'회색',color:'#b2bdcf',surface:'#29303b'},
];
state.highlights={profile:'yellow',issues:'pink'};
state.graphMarkedOnly=false;state.apiMarkedOnly=false;
const highlightFor = id => highlightColors.find(color=>color.id===state.highlights[id]);
const highlightButton = api => `<button class="icon marker-button" data-highlight-api="${api.id}" aria-label="API 강조 색상" title="강조 색상" style="color:${highlightFor(api.id)?.color||'var(--muted)'}">${icon('marker')}</button>`;
const highlightLabel = api => {const color=highlightFor(api.id);return color?`<p class="highlight-label"><span class="highlight-dot" style="background:${color.color}"></span>수동 강조 · ${color.name}</p>`:'';};
function openHighlight(id,anchor,point){
  const api=apis.find(a=>a.id===id),popover=$('#highlight-popover'),current=highlightFor(id);
  popover.innerHTML=`<header><h2 id="highlight-title">강조 색상</h2><button class="icon" id="close-highlight" aria-label="색상 선택 닫기">${icon('close')}</button></header><p class="palette-api mono">${api.method} ${api.path}</p><div class="palette-grid">${highlightColors.map(color=>`<button data-color="${color.id}" aria-label="${color.name} 강조" aria-pressed="${current?.id===color.id}"><span class="color-swatch" style="background:${color.color}">${current?.id===color.id?icon('check'):''}</span><span>${color.name}</span></button>`).join('')}</div><button id="clear-highlight" class="clear-highlight" ${current?'':'disabled'}>${icon('reset')} 강조 해제</button><p class="palette-note">색상은 사용자가 붙이는 표시입니다.<br>선택하면 바로 적용됩니다.</p>`;
  popover.showPopover();const bounds=anchor.getBoundingClientRect();
  popover.style.left=`${Math.max(12,Math.min(point?.x??bounds.right-popover.offsetWidth,innerWidth-popover.offsetWidth-12))}px`;
  popover.style.top=`${Math.max(12,Math.min(point?.y??bounds.bottom+8,innerHeight-popover.offsetHeight-12))}px`;
  const close=()=>{popover.hidePopover();$(`[data-highlight-api="${id}"]`)?.focus();};
  $('#close-highlight').onclick=close;
  const apply=color=>{color?state.highlights[id]=color:delete state.highlights[id];popover.hidePopover();render();($(`[data-highlight-api="${id}"]`)||$('#graph-marked-only')||$('#api-marked-only'))?.focus();toast(color?`${highlightFor(id).name} 강조를 적용했습니다. (목업)`:'강조를 해제했습니다. (목업)');};
  popover.querySelectorAll('[data-color]').forEach(button=>button.onclick=()=>apply(button.dataset.color));
  $('#clear-highlight').onclick=()=>apply(null);
  (popover.querySelector(`[data-color="${current?.id||'yellow'}"]`)).focus();
}
const sourceNames = {H:'HUMAN',S:'SCANNER',L:'LLM'};
const observations = id => state.records.filter(r => r.api === id);
const method = api => `<span class="badge method ${api.method === 'POST' ? 'post' : ''}">${api.method}</span>`;
const status = value => value ? `<span class="badge status ${value >= 400 ? 'warn' : ''}">${value}</span>` : '<span class="muted">미관측</span>';
const sourceMark = (s,observed) => `<span class="source-mark ${observed ? `on ${s.toLowerCase()}` : 'off'}" title="${sourceNames[s]} · ${observed ? '관측됨' : '관측 없음'}" aria-label="${sourceNames[s]} ${observed ? '관측됨' : '관측 없음'}">${s}${observed ? '' : '−'}</span>`;
const marks = sources => `<span class="sources">${['H','S','L'].map(s => sourceMark(s,sources.includes(s))).join('')}</span>`;
const sourceLegend = () => `<div class="source-legend"><span>${sourceMark('H',true)} 사람</span><span>${sourceMark('S',true)} 스캐너</span><span>${sourceMark('L',true)} LLM</span><span><span class="source-mark off">−</span> 관측 없음</span></div>`;
const search = (id,value,placeholder) => `<label class="search">${icon('search')}<input id="${id}" value="${esc(value)}" placeholder="${placeholder}" aria-label="${placeholder}"></label>`;
function toast(message){const element=$('#toast');element.textContent=message;element.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>element.hidden=true,4200);}
function switchPage(page){state.page=page;state.expanded=false;location.hash=page;render();}
function render(){
  const popover=$('#highlight-popover');if(popover.matches(':popover-open'))popover.hidePopover();
  document.querySelectorAll('[data-page]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.page === state.page));
  $('#app').innerHTML=state.page === 'records' ? renderRecords() : state.page === 'apis' ? renderApis() : renderGraph();
  bind();
}
function recordRows(){
  return state.records.filter(r=>state.recordSources.has(r.source) && (state.recordTab === 'all' || state.recordTab === 'hidden' ? state.recordTab === 'all' || r.hidden : state.recordTab === 'review' ? r.review && !r.hidden : !r.hidden))
    .filter(r=>`${apis.find(a=>a.id===r.api).path} ${r.identity}`.toLowerCase().includes(state.recordSearch.toLowerCase()));
}
function renderRecords(){
  const rows=recordRows();
  const selected=rows.find(r=>r.id===state.selectedRecord) || rows[0];
  if(selected)state.selectedRecord=selected.id;
  return `<div class="records-layout"><aside class="record-list"><div class="view-heading"><div><h1>관측 기록</h1><p>요청의 맥락부터 응답 내용까지</p></div></div>
    <div class="record-tabs">${[['main','메인 비교',state.records.filter(r=>!r.hidden).length],['review','검토 필요',state.records.filter(r=>r.review&&!r.hidden).length],['hidden','숨김',state.records.filter(r=>r.hidden).length],['all','전체',state.records.length]].map(([id,label,count])=>`<button data-record-tab="${id}" class="${state.recordTab===id?'active':''}">${label}<b>${count}</b></button>`).join('')}</div>
    <div class="record-filters">${search('record-search',state.recordSearch,'경로 또는 신원 검색')}<div class="toolbar">${['H','S','L'].map(s=>`<label><input type="checkbox" data-record-source="${s}" ${state.recordSources.has(s)?'checked':''}>${s==='H'?'사람 H':s==='S'?'스캐너 S':'LLM L'}</label>`).join('')}</div></div>
    <div class="record-scroll">${rows.length?rows.map(r=>{const api=apis.find(a=>a.id===r.api);return `<button class="record-row ${r.id===selected?.id?'selected':''}" data-record="${r.id}" aria-pressed="${r.id===selected?.id}"><span class="row-top"><span class="record-number">#${r.id}</span>${method(api)}<span class="spacer"></span>${status(r.status)}</span><code>${api.path}</code><span class="row-meta">${marks([r.source])}<span>${r.identity}</span><span>${r.time}</span>${r.repeat>1?`<span class="tag">반복 ${r.repeat}</span>`:''}</span></button>`}).join(''):'<div class="empty">조건에 맞는 관측 기록이 없습니다.<br>검색어나 출처 필터를 바꿔 보세요.</div>'}</div>
    <div class="panel-footer">${rows.length}건 표시 <span>반복 요청은 한 줄로 묶음</span></div></aside>
    <section class="record-detail" aria-label="선택한 관측 기록">${selected?recordDetail(selected):'<div class="empty">표시할 요청·응답이 없습니다.</div>'}</section></div>`;
}
function recordDetail(r){
  const api=apis.find(a=>a.id===r.api);
  return `<div class="detail-title">${method(api)}<h1>${api.path}</h1><span class="spacer"></span><span class="tag">#${r.id} · 읽기 전용</span></div>
    <dl class="metadata"><div><dt>HTTP 상태</dt><dd>${status(r.status)}</dd></div><div><dt>신원 / 역할</dt><dd>${r.identity} / ${r.identity==='anon'?'Anonymous':'User'}</dd></div><div><dt>출처</dt><dd>${sourceNames[r.source]}</dd></div><div><dt>실행 주체 · 도구</dt><dd>${r.source==='S'?'LLM · ZAP':r.source==='L'?'LLM · Explorer':'HUMAN · Browser'}</dd></div><div><dt>분류</dt><dd>API / INCLUDE</dd></div></dl>
    <section class="http-workspace ${state.expanded?'expanded':''}" aria-label="요청 응답 비교"><header class="http-tools"><h2>요청 · 응답</h2><span class="tag">마스킹된 관측본</span><label>글자 <select id="code-font" aria-label="원문 글자 크기">${[12,13,14,16].map(n=>`<option ${state.font===n?'selected':''}>${n}</option>`).join('')}</select></label><button id="wrap" aria-pressed="${state.wrap}">${icon('wrap')} 줄바꿈</button><button id="expand-http" aria-pressed="${state.expanded}">${icon('expand')} ${state.expanded?'확대 닫기':'확대'}</button></header>
      <div class="editors ${state.wrap?'wrap':''}" style="--request-width:${state.ratio}%;--font:${state.font}px"><section class="code-panel"><header><strong>Request</strong><span>요청</span><span>읽기 전용</span></header><pre aria-label="마스킹된 요청 원문">${requestCode(r,api)}</pre></section><div class="splitter" role="separator" aria-label="요청 응답 너비 조절" aria-orientation="vertical" aria-valuemin="30" aria-valuemax="70" aria-valuenow="${state.ratio}" tabindex="0"></div><section class="code-panel"><header><strong>Response</strong>${status(r.status)}<span>응답</span></header><pre aria-label="마스킹된 응답 원문">${responseCode(r,api)}</pre></section></div>
      <footer class="http-footer"><span>쿠키·인증값 마스킹됨</span><span>각 패널 독립 스크롤 · 경계 드래그로 너비 조절</span></footer></section>
    <p class="detail-footnote">${r.repeat>1?`같은 요청 ${r.repeat}회 중 대표 기록입니다. `:''}표시된 HTTP 상태와 응답 내용은 관측 사실입니다. 권한 판정에는 소유자·역할 정책과 Evidence가 필요합니다.</p>`;
}
function line(key,value){return `<span class="token key">${key}:</span> ${value}`;}
function requestCode(r,api){return `<span class="token method">${api.method}</span> ${api.path}${api.id==='profile'?'?expand=preferences':''} HTTP/1.1\n${line('Host','api.example.test')}\n${line('Accept','application/json')}\n${line('Cookie','<span class="token mask">[MASKED]</span>')}\n${line('Authorization','<span class="token mask">[MASKED]</span>')}\n${line('Sec-Fetch-Site','same-origin')}\n${line('Accept-Language','ko-KR,ko;q=0.9,en;q=0.8')}\n${line('User-Agent','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 FlowScope-Synthetic/1.0')}\n${line('X-Request-Id',`mock-request-${r.id}`)}\n${line('Connection','keep-alive')}\n\n`}
function responseCode(r,api){return `HTTP/2 <span class="token number">${r.status}</span> ${r.status===200?'OK':r.status===401?'Unauthorized':'Forbidden'}\n${line('Content-Type','application/json; charset=utf-8')}\n${line('Cache-Control','no-store')}\n${line('X-Content-Type-Options','nosniff')}\n${line('Vary','Accept-Encoding, Cookie')}\n\n${r.status>=400?'{'+'\n  <span class="token key">"error"</span>: <span class="token string">"authentication_required"</span>,\n  <span class="token key">"message"</span>: <span class="token string">"로그인이 필요합니다."</span>\n}':api.id==='profile'?`{\n  <span class="token key">"id"</span>: <span class="token string">"user-a"</span>,\n  <span class="token key">"name"</span>: <span class="token string">"테스트 사용자"</span>,\n  <span class="token key">"role"</span>: <span class="token string">"User"</span>,\n  <span class="token key">"preferences"</span>: {\n    <span class="token key">"language"</span>: <span class="token string">"ko"</span>,\n    <span class="token key">"theme"</span>: <span class="token string">"dark"</span>,\n    <span class="token key">"notifications"</span>: <span class="token number">true</span>\n  }\n}`:api.id==='issues'?`{\n  <span class="token key">"page"</span>: <span class="token number">1</span>,\n  <span class="token key">"results"</span>: [\n    {\n      <span class="token key">"id"</span>: <span class="token number">101</span>,\n      <span class="token key">"title"</span>: <span class="token string">"합성 이슈"</span>\n    }\n  ]\n}`:`{\n  <span class="token key">"language"</span>: <span class="token string">"ko"</span>,\n  <span class="token key">"theme"</span>: <span class="token string">"dark"</span>\n}`}`;}
function apiRows(){return apis.filter(a=>(!state.apiMarkedOnly||highlightFor(a.id))&&!state.deleted.has(a.id)&&`${a.method} ${a.path}`.toLowerCase().includes(state.apiSearch.toLowerCase())).filter(a=>state.apiFilter==='all'||(state.apiFilter==='unobserved'?observations(a.id).length===0:state.apiFilter==='gap'?new Set(observations(a.id).map(r=>r.source)).size<3:observations(a.id).some(r=>r.source===state.apiFilter)));}
function renderApis(){
  const rows=apiRows(),selected=rows.find(a=>a.id===state.selectedApi);
  return `<div class="api-page"><div class="view-heading"><div><h1>API·입력 차이</h1><p>실제 관측과 선언을 나란히 비교합니다.</p></div><span class="spacer"></span><span class="muted small">${apis.filter(a=>!state.deleted.has(a.id)).length}개 API · ${apis.filter(a=>!state.deleted.has(a.id)).reduce((n,a)=>n+a.params.length,0)}개 입력</span></div>
    <div class="api-toolbar">${search('api-search',state.apiSearch,'메서드 또는 API 경로 검색')}<label class="marked-only"><input id="api-marked-only" type="checkbox" ${state.apiMarkedOnly?'checked':''}>강조된 API만</label><button id="api-filter-toggle" aria-expanded="${state.apiFiltersOpen}">${icon('filter')} 필터</button>${sourceLegend()}</div>
    <div class="api-filter" ${state.apiFiltersOpen?'':'hidden'}><label>표시 조건 <select id="api-filter">${[['all','전체 API'],['unobserved','선언만 있고 미관측'],['gap','출처 간 관측 차이'],['H','HUMAN 관측'],['S','SCANNER 관측'],['L','LLM 관측']].map(([v,l])=>`<option value="${v}" ${state.apiFilter===v?'selected':''}>${l}</option>`).join('')}</select></label><span class="muted small">출처는 실제 요청을 생성한 도구 기준입니다.</span></div>
    <div class="api-body"><div class="table-scroll"><table><thead><tr><th>Method</th><th>API</th><th>관측 출처 H / S / L</th><th>HTTP</th><th class="numeric">관측</th><th class="numeric">선언</th><th class="numeric">입력</th><th aria-label="상세 열기"></th></tr></thead><tbody>${rows.map(api=>{const obs=observations(api.id);return `<tr data-api="${api.id}" class="${selected?.id===api.id?'selected':''} ${highlightFor(api.id)?'highlighted':''}" style="--api-highlight:${highlightFor(api.id)?.surface||'transparent'}"><td>${method(api)}</td><td><button class="api-open" aria-label="${api.method} ${api.path} 상세 열기"><code>${api.path}</code>${highlightFor(api.id)?` <span class="highlight-dot" style="background:${highlightFor(api.id).color}" title="수동 강조 · ${highlightFor(api.id).name}"></span>`:''}<p>api.example.test · ${obs.length?'실제 API':'산출물 API 후보'}</p></button></td><td>${marks(obs.map(r=>r.source))}</td><td>${[...new Set(obs.map(r=>r.status))].map(status).join(' ')||'<span class="muted">미관측</span>'}</td><td class="numeric">${obs.length}</td><td class="numeric">${api.declared}</td><td class="numeric">${api.params.length}</td><td class="row-chevron">${icon('chevron')}</td></tr>`}).join('')}</tbody></table>${rows.length?'':'<div class="empty">조건에 맞는 API가 없습니다.<br>검색어 또는 필터를 바꿔 보세요.</div>'}</div>${selected?apiDetail(selected):''}</div><footer class="panel-footer"><span>행 전체를 클릭하거나 API 이름에서 Enter로 상세를 엽니다.</span><span>${rows.length}개 표시</span></footer></div>`;
}
function apiDetail(api){const obs=observations(api.id);return `<aside class="api-inspector" aria-label="API 상세"><div class="panel-heading"><span class="muted small">API 상세</span><span class="spacer"></span>${highlightButton(api)}<button class="icon" id="close-api" aria-label="API 상세 닫기">${icon('close')}</button></div>${method(api)}<h2>${api.path}</h2><p class="muted small">https://api.example.test</p>${highlightLabel(api)}
  <div class="source-legend">${['H','S','L'].map(s=>`<span>${sourceMark(s,obs.some(r=>r.source===s))} ${sourceNames[s]} · ${obs.filter(r=>r.source===s).length}건</span>`).join('')}</div>
  <h3 class="section-title">입력 ${api.params.length}개</h3>${api.params.map(([location,name,type])=>`<div class="input-row"><span class="tag">${location}</span><div><code>${name}</code><p>${type} · ${obs.length?'관측과 선언 비교 대상':'선언만 있음'}</p></div></div>`).join('')||'<p class="muted small">확인된 입력이 없습니다.</p>'}
  <h3 class="section-title">연결된 관측 기록 ${obs.length}건</h3>${obs.map(r=>`<button class="evidence-link" data-open-evidence="${r.id}"><span class="mono">#${r.id}</span> · ${r.identity} · ${r.source}<span style="float:right">${status(r.status)}</span></button>`).join('')||'<p class="muted small">아직 요청이 관측되지 않았습니다.</p>'}<p class="hint">${obs.length?'관측 출처는 연결된 Evidence를 기준으로 표시합니다. 실행 주체가 LLM이어도 ZAP 요청은 S입니다.':'산출물에서 발견된 경로입니다. 실제 API 존재나 접근 가능 여부는 아직 확인되지 않았습니다.'}</p></aside>`;}
function graphRecords(){return state.records.filter(r=>state.graphSources.has(r.source)&&state.graphIdentities.has(r.identity)&&state.graphStatuses.has(String(r.status)[0]));}
function graphApis(){const ids=new Set(graphRecords().map(r=>r.api));return apis.filter(a=>(!state.graphMarkedOnly||highlightFor(a.id))&&ids.has(a.id)&&`${a.path} ${a.object||''} ${graphRecords().filter(r=>r.api===a.id).map(r=>r.identity).join(' ')}`.toLowerCase().includes(state.graphSearch.toLowerCase()));}
function renderGraph(){
  const rows=graphApis();if(!rows.some(a=>a.id===state.selectedNode))state.selectedNode=rows[0]?.id||null;
  return `<div class="graph-page"><aside class="graph-filters"><h2>그래프 필터</h2><div class="filter-section"><h3>출처</h3>${['H','S','L'].map(s=>`<label><input type="checkbox" data-graph-source="${s}" ${state.graphSources.has(s)?'checked':''}><span class="source-mark on ${s.toLowerCase()}">${s}</span>${sourceNames[s]}<b>${state.records.filter(r=>r.source===s).length}</b></label>`).join('')}</div><div class="filter-section"><h3>신원</h3>${['user-a','anon'].map(id=>`<label><input type="checkbox" data-graph-identity="${id}" ${state.graphIdentities.has(id)?'checked':''}>${id}<b>${state.records.filter(r=>r.identity===id).length}</b></label>`).join('')}</div><div class="filter-section"><h3>응답 코드</h3>${['2','4'].map(code=>`<label><input type="checkbox" data-graph-status="${code}" ${state.graphStatuses.has(code)?'checked':''}>${code}xx<b>${state.records.filter(r=>String(r.status)[0]===code).length}</b></label>`).join('')}</div><div class="filter-section"><h3>수동 강조</h3><label><input id="graph-marked-only" type="checkbox" ${state.graphMarkedOnly?'checked':''}>강조된 API만<b>${apis.filter(a=>!state.deleted.has(a.id)&&highlightFor(a.id)).length}</b></label></div><div class="filter-section"><h3>그래프 조작</h3><button id="reset-graph">${icon('reset')} 필터 · 위치 초기화</button><p class="muted small">원본 관측 기록에 연결된 노드만 표시합니다.</p></div></aside>
    <section class="graph-center"><div class="graph-toolbar">${search('graph-search',state.graphSearch,'API, 객체 ID, 신원 검색')}<span class="spacer"></span><button class="icon" id="zoom-out" aria-label="그래프 축소">${icon('minus')}</button><span class="zoom-value">${Math.round(state.zoom*100)}%</span><button class="icon" id="zoom-in" aria-label="그래프 확대">${icon('plus')}</button><label><input id="zoom-range" type="range" min="40" max="180" value="${state.zoom*100}" aria-label="그래프 배율"></label><button class="icon" id="fit-graph" aria-label="전체 그래프 맞춤">${icon('fit')}</button><button class="icon" id="toggle-minimap" aria-label="미니맵 표시" aria-pressed="${state.minimap}">${icon('map')}</button></div><div class="breadcrumb">Site Overview <span>/</span> Users APIs <span>/</span> <strong>${rows.find(a=>a.id===state.selectedNode)?.path||'선택 없음'}</strong></div>
    <div class="canvas"><div class="lane-labels"><span>IDENTITY</span><span>API</span><span>OBJECT</span></div><svg class="graph-svg" viewBox="0 0 900 600" preserveAspectRatio="xMidYMid meet" aria-label="신원 API 객체 관계 그래프"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="#718198"/></marker></defs><g id="graph-world" transform="translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})">${graphNodes(rows)}</g></svg>
    ${rows.length?'':'<div class="graph-empty">표시할 API가 없습니다.<br>필터를 초기화하거나 다른 화면에서 관측 기록을 확인하세요.</div>'}<div class="canvas-hint">드래그 이동 · 휠 확대/축소 · 전체 맞춤</div><aside class="minimap" ${state.minimap?'':'hidden'}><header>미니맵 <button id="close-minimap" aria-label="미니맵 접기">${icon('close')}</button></header><svg class="mini-svg" viewBox="0 0 900 600" preserveAspectRatio="none" aria-label="미니맵 위치 이동"><g>${miniNodes(rows)}</g><rect class="viewport" x="${-state.pan.x/state.zoom}" y="${-state.pan.y/state.zoom}" width="${900/state.zoom}" height="${600/state.zoom}"/></svg></aside></div></section>
    <aside class="graph-inspector" aria-label="선택 노드 상세">${graphInspector(rows.find(a=>a.id===state.selectedNode))}</aside></div>`;
}
function graphNodes(rows){
  const recs=graphRecords().filter(r=>rows.some(a=>a.id===r.api));const identities=['user-a','anon'].filter(id=>recs.some(r=>r.identity===id));
  const positions=new Map(rows.map((a,i)=>[a.id,150+i*145]));
  const edges=rows.map(api=>{const y=positions.get(api.id);return identities.filter(id=>recs.some(r=>r.api===api.id&&r.identity===id)).map(id=>`<path class="edge" marker-end="url(#arrow)" d="M260 ${id==='user-a'?225:365} H310 V${y+40} H380"/>`).join('')+(api.object?`<path class="edge" marker-end="url(#arrow)" d="M620 ${y+40} H690"/>`:'')}).join('');
  const identityNodes=identities.map(id=>`<g class="node" transform="translate(70,${id==='user-a'?190:330})"><rect width="190" height="70"/><text class="type" x="16" y="23">IDENTITY</text><text x="16" y="48">${id}</text></g>`).join('');
  return edges+identityNodes+rows.map(api=>{const y=positions.get(api.id),obs=recs.filter(r=>r.api===api.id);return `<g class="node ${api.id===state.selectedNode?'selected':''}" data-node="${api.id}" tabindex="0" role="button" aria-label="${api.method} ${api.path} 노드 상세${highlightFor(api.id)?` · 수동 강조 ${highlightFor(api.id).name}`:''}"><rect x="380" y="${y}" width="240" height="86" style="fill:${highlightFor(api.id)?.surface||'#131d2d'}"/>${highlightFor(api.id)?`<circle cx="603" cy="${y+18}" r="4" fill="${highlightFor(api.id).color}"/>`:''}<text class="type" x="396" y="${y+22}">${api.method} · ${[...new Set(obs.map(r=>r.source))].join(' / ')}</text><text class="path" x="396" y="${y+45}">${api.id==='issues'?'/projects/{id}/issues':api.id==='profile'?'/users/me/profile':'/users/me/settings'}</text><text class="meta" x="396" y="${y+69}">${[...new Set(obs.map(r=>r.status))].join(' · ')}   /   ${obs.length}건 관측</text></g>${api.object?`<g class="node" transform="translate(690,${y+6})"><rect width="155" height="70"/><text class="type" x="16" y="23">OBJECT</text><text x="16" y="48">${api.object}</text></g>`:''}`}).join('');
}
function miniNodes(rows){const recs=graphRecords().filter(r=>rows.some(a=>a.id===r.api));const identities=["user-a","anon"].filter(id=>recs.some(r=>r.identity===id));return identities.map(id=>`<rect x="70" y="${id==="user-a"?190:330}" width="190" height="70"/>`).join("")+rows.map((api,i)=>`<rect data-mini-api="${api.id}" x="380" y="${150+i*145}" width="240" height="86" style="fill:${highlightFor(api.id)?.color||'#546b8a'}"/>${api.object?`<rect x="690" y="${156+i*145}" width="155" height="70"/>`:''}`).join('');}
function graphInspector(api){if(!api)return '<h2>현재 보기</h2><p class="inspector-note">표시할 API가 없습니다. 필터를 조정해 보세요.</p>';const obs=observations(api.id);return `<div class="panel-heading"><h2>현재 보기</h2><span class="spacer"></span>${highlightButton(api)}<button class="icon trash-button" id="delete-api" aria-label="선택 API와 관측 기록 삭제" title="API와 관측 기록 삭제">${icon('trash')}</button></div>${method(api)}<h3>${api.path}</h3>${marks(obs.map(r=>r.source))}${highlightLabel(api)}<dl class="stats"><div><dt>신원</dt><dd>${new Set(obs.map(r=>r.identity)).size}</dd></div><div><dt>객체</dt><dd>${api.object?1:0}</dd></div><div><dt>관측 기록</dt><dd>${obs.length}</dd></div></dl><h3 class="section-title">접근한 신원</h3>${[...new Set(obs.map(r=>r.identity))].map(id=>`<div class="identity-line"><div>${id}<br><span>${obs.filter(r=>r.identity===id).length}건 관측</span></div><span>${[...new Set(obs.filter(r=>r.identity===id).map(r=>r.status))].map(status).join(' ')}</span></div>`).join('')}<h3 class="section-title">관측 기록</h3>${obs.map(r=>`<button class="evidence-link" data-open-evidence="${r.id}">#${r.id} · ${sourceNames[r.source]}<span style="float:right">${status(r.status)}</span></button>`).join('')}<p class="inspector-note">HTTP 상태는 실제 관측값입니다. 접근 허용·거부 판정은 Evidence와 소유자·역할 정책을 확인한 뒤 표시합니다.</p>`;}
function updateSet(set,value,checked){checked?set.add(value):set.delete(value);render();}
function bindSearch(id,key){const input=$(`#${id}`);if(!input)return;input.oninput=()=>{const pos=input.selectionStart;state[key]=input.value;render();const next=$(`#${id}`);next.focus();next.setSelectionRange(pos,pos);};}
function setZoom(value,pivot={x:450,y:300}){const next=Math.min(1.8,Math.max(.4,value));const ratio=next/state.zoom;state.pan={x:pivot.x-(pivot.x-state.pan.x)*ratio,y:pivot.y-(pivot.y-state.pan.y)*ratio};state.zoom=next;updateViewport();}
function updateViewport(){const world=$('#graph-world');if(!world)return;world.setAttribute('transform',`translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`);$('.zoom-value').textContent=`${Math.round(state.zoom*100)}%`;$('#zoom-range').value=state.zoom*100;const viewport=$('.viewport');['x','y','width','height'].forEach((key,i)=>viewport.setAttribute(key,[-state.pan.x/state.zoom,-state.pan.y/state.zoom,900/state.zoom,600/state.zoom][i]));$('#zoom-out').disabled=state.zoom<=.4;$('#zoom-in').disabled=state.zoom>=1.8;}
function bind(){
  document.querySelectorAll('[data-highlight-api]').forEach(button=>button.onclick=()=>openHighlight(button.dataset.highlightApi,button));
  if($('#graph-marked-only'))$('#graph-marked-only').onchange=e=>{state.graphMarkedOnly=e.target.checked;render();$('#graph-marked-only').focus();};
  if($('#api-marked-only'))$('#api-marked-only').onchange=e=>{state.apiMarkedOnly=e.target.checked;render();$('#api-marked-only').focus();};
  document.querySelectorAll('[data-record]').forEach(b=>b.onclick=()=>{state.selectedRecord=Number(b.dataset.record);render();});
  document.querySelectorAll('[data-record-tab]').forEach(b=>b.onclick=()=>{state.recordTab=b.dataset.recordTab;render();});
  document.querySelectorAll('[data-record-source]').forEach(b=>b.onchange=()=>updateSet(state.recordSources,b.dataset.recordSource,b.checked));
  bindSearch('record-search','recordSearch');bindSearch('api-search','apiSearch');bindSearch('graph-search','graphSearch');
  if($('#code-font'))$('#code-font').onchange=e=>{state.font=Number(e.target.value);$('.editors').style.setProperty('--font',`${state.font}px`);};
  if($('#wrap'))$('#wrap').onclick=()=>{state.wrap=!state.wrap;render();};
  if($('#expand-http'))$('#expand-http').onclick=()=>{state.expanded=!state.expanded;render();$('#expand-http').focus();};
  const splitter=$('.splitter');if(splitter){const resize=value=>{state.ratio=Math.min(70,Math.max(30,value));$('.editors').style.setProperty('--request-width',`${state.ratio}%`);splitter.setAttribute('aria-valuenow',Math.round(state.ratio));};splitter.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();resize(state.ratio+(e.key==='ArrowLeft'?-2:2));}};splitter.onpointerdown=e=>{splitter.setPointerCapture(e.pointerId);splitter.onpointermove=move=>{const bounds=$('.editors').getBoundingClientRect();resize((move.clientX-bounds.left)/bounds.width*100);};splitter.onpointerup=()=>splitter.onpointermove=null;};}
  document.querySelectorAll('[data-api]').forEach(row=>row.onclick=()=>{state.selectedApi=row.dataset.api;render();});
  if($('#close-api'))$('#close-api').onclick=()=>{state.selectedApi=null;render();};
  if($('#api-filter-toggle'))$('#api-filter-toggle').onclick=()=>{state.apiFiltersOpen=!state.apiFiltersOpen;render();};
  if($('#api-filter'))$('#api-filter').onchange=e=>{state.apiFilter=e.target.value;render();};
  document.querySelectorAll('[data-open-evidence]').forEach(b=>b.onclick=()=>{state.selectedRecord=Number(b.dataset.openEvidence);state.recordTab='all';state.recordSearch='';state.recordSources=new Set(['H','S','L']);switchPage('records');});
  ['source','identity','status'].forEach(kind=>document.querySelectorAll(`[data-graph-${kind}]`).forEach(b=>b.onchange=()=>updateSet(state[{source:'graphSources',identity:'graphIdentities',status:'graphStatuses'}[kind]],b.dataset[{source:'graphSource',identity:'graphIdentity',status:'graphStatus'}[kind]],b.checked)));
  document.querySelectorAll('[data-node]').forEach(node=>{const select=()=>{state.selectedNode=node.dataset.node;render();$(`[data-node="${state.selectedNode}"]`)?.focus();};node.onclick=select;node.oncontextmenu=e=>{e.preventDefault();state.selectedNode=node.dataset.node;render();openHighlight(state.selectedNode,$(`[data-node="${state.selectedNode}"]`),{x:e.clientX,y:e.clientY});};node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};});
  if($('#zoom-in')){ $('#zoom-in').onclick=()=>setZoom(state.zoom*1.2);$('#zoom-out').onclick=()=>setZoom(state.zoom/1.2);$('#zoom-range').oninput=e=>setZoom(Number(e.target.value)/100);$('#fit-graph').onclick=()=>{state.zoom=1;state.pan={x:0,y:0};updateViewport();};$('#toggle-minimap').onclick=()=>{state.minimap=!state.minimap;render();};$('#close-minimap').onclick=()=>{state.minimap=false;render();};$('#reset-graph').onclick=()=>{state.graphSources=new Set(['H','S','L']);state.graphIdentities=new Set(['user-a','anon']);state.graphStatuses=new Set(['2','4']);state.graphSearch='';state.graphMarkedOnly=false;state.pan={x:0,y:0};state.zoom=1;render();};
    const svg=$('.graph-svg'),point=e=>{const p=new DOMPoint(e.clientX,e.clientY);return p.matrixTransform(svg.getScreenCTM().inverse());};svg.addEventListener('wheel',e=>{e.preventDefault();setZoom(state.zoom*Math.exp(-e.deltaY*.002),point(e));},{passive:false});svg.onpointerdown=e=>{if(e.target.closest('.node'))return;const start=point(e),original={...state.pan};svg.setPointerCapture(e.pointerId);svg.onpointermove=move=>{const p=point(move);state.pan={x:original.x+p.x-start.x,y:original.y+p.y-start.y};updateViewport();};svg.onpointerup=()=>svg.onpointermove=null;};$('.mini-svg').onclick=e=>{const bounds=e.currentTarget.getBoundingClientRect();state.pan={x:450-((e.clientX-bounds.left)/bounds.width*900)*state.zoom,y:300-((e.clientY-bounds.top)/bounds.height*600)*state.zoom};updateViewport();};updateViewport();
  }
  if($('#delete-api'))$('#delete-api').onclick=()=>{const api=apis.find(a=>a.id===state.selectedNode);state.pendingDelete=api.id;$('#delete-dialog').returnValue='';$('#delete-target').innerHTML=`${method(api)} <code>${api.path}</code>`;$('#delete-description').textContent=`연결된 관측 기록 ${observations(api.id).length}건(반복 묶음 포함 ${observations(api.id).reduce((sum,r)=>sum+r.repeat,0)}개 요청)과 이 API의 그래프 노드를 삭제합니다. 출처·신원·HTTP 필터로 가려진 기록도 삭제 대상에 포함됩니다.`;$('#delete-dialog').showModal();$('#delete-dialog footer button[value=cancel]').focus();};
}
document.querySelectorAll('[data-icon]').forEach(element=>element.innerHTML=icon(element.dataset.icon));
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>switchPage(button.dataset.page));
$('#delete-dialog').addEventListener('close',()=>{if($('#delete-dialog').returnValue!=='delete')return;const id=state.pendingDelete,count=observations(id).length;state.deleted.add(id);delete state.highlights[id];state.records=state.records.filter(r=>r.api!==id);if(state.selectedApi===id)state.selectedApi=null;if(state.selectedNode===id)state.selectedNode=null;render();toast(`API와 관측 기록 ${count}건을 삭제했습니다. (합성 데이터)`);});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.expanded){state.expanded=false;render();}});
window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);if(['records','apis','graph'].includes(page)&&state.page!==page){state.page=page;render();}});
state.page=['records','apis','graph'].includes(location.hash.slice(1))?location.hash.slice(1):'records';render();
