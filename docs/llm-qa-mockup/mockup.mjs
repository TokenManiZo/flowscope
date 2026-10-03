import { icons } from './icons.mjs';
const q = new URLSearchParams(location.search);
const app = document.querySelector('#app');
const frame = q.get('frame') === '1';
const screen = q.get('screen') || 'llm';
const requestScreen = screen === 'human' || screen === 'zap';
let variant = q.get('variant') || 'a';
let theme = q.get('theme') || 'dark';
let mode = q.get('mode') || (requestScreen || q.get('compare') === '1' ? 'compare' : 'gallery');
let size = Number(q.get('size')) === 1920 ? 1920 : 1280;
let state = q.get('state') || 'completed';
let helpMode = q.get('help') || 'split';
let accountsOpen = q.get('accounts') !== 'closed', detailsOpen = true, feedOpen = true;
let reading = q.get('focus') === '1', feedHeight = 240, savedScroll = 0;
const runModel = 'gpt-5.6-sol';
let model = runModel, chosen = new Set(['user-a']), feedback = '';
const extraIcons = {
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'circle-help': '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  'maximize': '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  'minimize': '<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>',
};
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${extraIcons[name] || (icons[name] || []).map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')}</svg>`; }
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const descriptions = {
  before: ['현재 배치', '오른쪽 준비 상태 줄에 작은 모델 선택을 유지한 개선 전 재구성입니다.'],
  a: ['A · 제목 오른쪽', '모델을 제목과 같은 높이에 배치합니다. 설정을 바로 찾으면서 기존 화면 높이를 유지합니다.'],
  b: ['B · 설명 아래 왼쪽', '설명 다음에 모델을 두어 읽는 순서대로 설정합니다. 왼쪽에서 잘 보이지만 한 줄을 더 사용합니다.'],
  c: ['C · 기존 위치 강조', '위치는 유지하고 모델명과 선택 상자를 키웁니다. 구조 변경이 가장 적지만 시선 이동은 남습니다.'],
};
if (requestScreen) {
  descriptions.before = ['기존 기록 보기', '표와 검색을 유지한 개선 전 재구성입니다.'];
  for (const id of ['a', 'b', 'c']) descriptions[id] = ['기록 보기 개선', '같은 요청 표에 크게 보기와 기록 높이 조절을 추가합니다.'];
}
const stateName = () => ({idle:'실행 전', running:'탐색 중', completed:'완료', failed:'시작 실패'}[state]);
const active = () => state === 'running';
function help(id, title, text, foot = '') {
  return `<span class="help" data-open="false"><button type="button" data-help="${id}" aria-label="${title} 도움말" aria-expanded="false" aria-describedby="tip-${id}">${icon('circle-help')}</button><span class="help-panel" id="tip-${id}" role="tooltip"><strong>${title}</strong>${text}${foot ? `<small>${foot}</small>` : ''}</span></span>`;
}
function modelControl() {
  const v = variant === 'before' ? 'baseline' : variant;
  return `<div class="model-control ${v}"><label for="model">${active() ? '실행 모델' : variant === 'before' ? 'Codex 모델' : state === 'completed' ? '다음 탐색 모델' : '탐색 모델'}</label>${active() ? `<p class="active-model ${v}">${runModel}<span>실행 중</span></p>` : `<select id="model" aria-label="탐색 모델" ${state === 'failed' ? 'disabled' : ''}>${['gpt-5.6-sol','gpt-6.1-sol','Codex 기본 설정'].map(m => `<option ${m === model ? 'selected' : ''}>${m}</option>`).join('')}</select><button class="refresh" id="refresh-model" aria-label="모델 목록 다시 확인">${icon('refresh-cw')}</button>`}</div>`;
}
function provider() { return `<span class="provider"><span class="dot"></span>${state === 'failed' ? 'Codex 준비 필요' : 'Codex 준비됨'}</span>`; }
function accounts() {
  return `<section class="fold"><button class="fold-toggle" id="accounts-toggle" aria-expanded="${accountsOpen}"><span><strong>${requestScreen ? screen === "human" ? "수집할 계정" : "스캔할 계정" : "탐색할 계정"}</strong><span class="muted" style="margin-left:8px">${[...chosen].map(id => id === 'anon' ? '비로그인' : 'USER A').join(' · ') || '선택 없음'}</span></span><span class="disclosure">${accountsOpen ? '접기' : '펼치기'}${icon('chevron-down')}</span></button>${accountsOpen ? `<div class="fold-body"><div class="table-box"><table><thead><tr><th>계정</th><th>${requestScreen ? screen === "human" ? "수집 상태" : "ZAP 로그인" : "LLM 로그인"}</th><th></th></tr></thead><tbody>${[['anon','비로그인'],['user-a','USER A']].map(([id, label]) => `<tr><td><label class="account-cell"><input type="checkbox" data-account="${id}" ${chosen.has(id) ? 'checked' : ''} ${active() ? 'disabled' : ''}>${label}</label></td><td class="status-cell">${id === 'anon' ? '필요 없음' : '<span class="row"><span class="dot"></span>세션 있음</span>'}</td><td class="login-cell">${id === 'anon' ? '' : `<button class="login-button" data-demo="다시 로그인" ${active() ? 'disabled' : ''}>${icon('log-in')}<span>다시 로그인</span></button>`}</td></tr>`).join('')}</tbody></table></div><p class="login-guide">[브라우저 로그인] → 열린 창에서 로그인 → [로그인 완료]. 이 창의 기록은 직접 둘러보기와 섞이지 않습니다.</p></div>` : ''}</section>`;
}
function registrationMetric() {
  if (variant === 'before') return '<dt>선언 Endpoint / Parameter</dt><dd>12 / 24</dd>';
  const foot = '실제 요청으로 관측한 API와 별도로 셉니다. 같은 항목은 중복해서 세지 않습니다.';
  if (helpMode === 'combined') return `<dt>근거로 등록한 API / 입력 필드 ${help('registration','근거로 등록한 API / 입력 필드','LLM이 화면 코드나 API 문서에서 찾아, 근거를 연결해 등록한 API와 입력 필드 수입니다.',foot)}</dt><dd>12 / 24</dd>`;
  return `<dt>근거로 등록한 항목</dt><dd class="metric-pair"><span>API 12</span>${help('api','근거로 등록한 API','LLM이 화면 코드나 API 문서에서 찾아, 근거와 함께 등록한 API 수입니다.','API는 기능을 요청하는 주소입니다. ' + foot)}<span class="slash">/</span><span>입력 필드 24</span>${help('parameter','근거로 등록한 입력 필드','등록한 API에 보낼 수 있는 입력 항목 수입니다. 예: 검색어, 페이지 번호, ID.','같은 API의 같은 입력 항목은 한 번만 셉니다.')}</dd>`;
}
function metrics() {
  if (state === 'idle' || state === 'failed') return '';
  return `<section class="fold"><button class="fold-toggle" id="details-toggle" aria-expanded="${detailsOpen}"><span>실행 세부정보 <span class="muted" style="margin-left:8px">11:32 · HTTP 106 / 106</span></span><span class="disclosure">${detailsOpen ? '접기' : '펼치기'}${icon('chevron-down')}</span></button>${detailsOpen ? `<div class="fold-body"><div class="execution-top"><strong>${active() ? '브라우저 탐색 중' : '완료'}</strong><span class="muted">${variant === 'before' ? '요청 모델' : '이번 실행 모델'} <span class="mono">${runModel}</span></span></div><dl class="metrics"><div><dt>경과</dt><dd>11:32</dd></div><div><dt>브라우저 동작</dt><dd>53회</dd></div><div><dt>화면 상태 조회 횟수 ${help('snapshots','화면 상태 조회 횟수','LLM이 현재 브라우저 화면을 읽은 횟수입니다.')}</dt><dd>53회</dd></div><div><dt>관측 엔드포인트</dt><dd>149개</dd></div><div>${registrationMetric()}</div><div><dt>종료 기준</dt><dd title="300회 또는 15분 중 먼저 도달하면 종료합니다. 창을 닫아도 종료합니다.">300회 · 15분</dd></div></dl></div>` : ''}</section>`;
}
function setup() {
  if (requestScreen) return `<section class="panel setup"><header class="setup-title"><div><h2>${screen === "human" ? "직접 둘러보기" : "ZAP 스캔"}</h2><p class="description">${screen === "human" ? "계정을 고르고 시작한 뒤, Burp 브라우저로 서비스를 사용하세요." : "선택한 계정마다 따로 스캔합니다."}</p></div></header>${accounts()}<div class="actions"><button class="primary" data-demo="수집 시작">${icon("play")}시작</button><small>예시 화면 · 실제 수집 안 함</small></div></section>`;
  const description = variant === 'before' ? 'LLM이 사람처럼 서비스를 둘러보며 요청을 만듭니다.' : 'LLM이 서비스를 둘러보며 API 요청과 응답을 기록합니다.';
  return `<section class="panel setup"><header class="setup-title"><div><h2>LLM 탐색</h2><p class="description">${description}</p></div>${variant === 'a' ? modelControl() : ''}</header>${variant === 'b' ? `<div class="settings-b">${modelControl()}${provider()}</div>` : `<div class="provider-line">${provider()}${variant === 'a' ? '' : modelControl()}</div>`}${state === 'failed' ? '<p class="description">Codex 준비 상태를 확인한 뒤 다시 시작하세요.</p>' : ''}${accounts()}${metrics()}<div class="actions"><button class="primary" data-demo="탐색 시작" ${active() || state === 'failed' || !chosen.size ? 'disabled' : ''}>${icon('play')}탐색 시작</button>${active() ? `<button class="stop" data-demo="중단">${icon('circle-stop')}중단</button>` : state === 'completed' ? '<button data-demo="실행 표시 지우기">실행 표시 지우기</button>' : ''}<small>${chosen.size}개 선택됨</small></div></section>`;
}
const records = [
  ['MODEL','프로젝트 화면과 API 응답을 살펴보고 있습니다.','USER A로 프로젝트 상세를 열고, 응답에 포함된 API 주소와 입력 항목을 확인합니다.','메시지'],
  ['GET','/api/projects/13','USER A · #128 · ev-demo-128','200'],
  ['BROWSER','프로젝트 상세 화면 열기','https://demo.flowscope.test/projects/13','완료'],
  ['GET','/api/projects/13/members','USER A · #127 · ev-demo-127','200'],
  ['MODEL','프로젝트의 멤버 목록을 확인했습니다.','멤버 목록과 페이지 이동 요청을 기록했습니다. 다음으로 프로젝트 설정 화면을 살펴봅니다.','메시지'],
  ['BROWSER','프로젝트 설정으로 이동','https://demo.flowscope.test/projects/13/settings','완료'],
  ['GET','/api/projects/13/settings','USER A · #126 · ev-demo-126','200'],
  ['SYSTEM','API와 입력 필드 근거 등록','화면 코드에서 확인한 API 2개와 입력 항목 3개를 근거에 연결했습니다.','완료'],
  ['GET','/api/projects/13/issues?page=1','USER A · #125 · ev-demo-125','200'],
  ['BROWSER','이슈 목록 화면 확인','https://demo.flowscope.test/projects/13/issues','완료'],
  ['MODEL','이슈 목록의 검색 입력을 확인합니다.','검색어와 페이지 번호가 어디에 사용되는지 화면 코드와 응답을 함께 확인합니다.','메시지'],
  ['GET','/api/projects/13/issues?search=demo','USER A · #124 · ev-demo-124','200'],
  ['BROWSER','검색 결과 화면 읽기','https://demo.flowscope.test/projects/13/issues?search=demo','완료'],
  ['GET','/api/profile/me','USER A · #123 · ev-demo-123','200'],
  ['GET','/api/workspaces/demo','USER A · #122 · ev-demo-122','200'],
  ['MODEL','작업 공간 화면을 살펴보겠습니다.','프로젝트 목록과 프로필 화면을 연결하는 링크를 확인합니다.','메시지'],
];
function feed() {
  if (requestScreen) return `<section class="panel feed" aria-label="기록된 요청"><header class="feed-header"><div class="feed-title"><h2>기록된 요청</h2><div class="feed-tools"><input aria-label="기록 검색" placeholder="번호·메서드·경로·계정·상태 검색">${variant !== "before" ? `<button id="focus-records">${icon(reading ? "minimize" : "maximize")}${reading ? "원래 크기" : "크게 보기"}</button>` : ""}<button id="feed-toggle">${feedOpen ? "접기" : "펼치기"}</button></div></div>${reading ? `<p class="current-message">${screen === "human" ? "직접 둘러보기" : "ZAP 스캔"} · DEMO · 최근 저장 기록 200건</p>` : ""}</header>${feedOpen ? `<div class="feed-list" style="--feed-height:${feedHeight}px"><table class="request-table"><thead><tr><th>#</th><th>Method</th><th>API</th><th>계정</th><th>HTTP</th><th>시각</th></tr></thead><tbody>${Array.from({length:25},(_,i)=>`<tr><td>#${128-i}</td><td><span class="badge method-get">GET</span></td><td class="mono">/api/projects/${13+i}/members</td><td>USER A</td><td><span class="http">200</span></td><td>17:08:12</td></tr>`).join("")}</tbody></table></div>` : ""}</section>`;
  const message = state === 'idle' ? '탐색을 시작하면 작업 메시지와 수집한 요청이 표시됩니다.' : state === 'failed' ? '현재 탐색이 실행되지 않았습니다.' : active() ? '프로젝트 설정을 살펴보며 API 요청과 응답을 수집하고 있습니다.' : '탐색을 마쳤습니다. 수집한 요청과 작업 메시지를 확인하세요.';
  return `<section class="panel feed" aria-label="진행 기록"><header class="feed-header"><div class="feed-title"><h2>진행 기록 <span class="run-state">${stateName()}</span></h2><div class="feed-tools">${variant !== 'before' ? `<button id="focus-records" aria-pressed="${reading}">${icon(reading ? 'minimize' : 'maximize')}${reading ? '원래 크기' : '크게 보기'}</button>` : ''}<button id="feed-toggle" aria-expanded="${feedOpen}">${feedOpen ? '접기' : '펼치기'}${icon('chevron-down')}</button></div></div><p class="current-message">${message}</p>${reading ? `<div class="feed-context"><span>LLM 탐색 · USER A</span><span>이번 실행 모델 <span class="mono">${runModel}</span></span><span>HTTP 응답 106건</span></div>` : ''}</header>${feedOpen ? `<div class="feed-list" style="--feed-height:${feedHeight}px">${state === 'idle' || state === 'failed' ? '<p class="empty">표시할 진행 기록이 없습니다.</p>' : records.map(([kind, title, detail, outcome]) => `<article class="activity"><span class="badge ${kind === 'GET' ? 'method-get' : ''}">${kind === 'GET' ? 'GET' : kind === 'MODEL' && variant !== 'before' ? '메시지' : kind}</span><div><h3 class="${kind === 'GET' ? 'mono' : ''}">${title}</h3><p>${detail}</p></div><span class="activity-outcome">${outcome === '200' ? '<span class="http">200</span><span>5ms</span>' : `<span>${outcome}</span>`}</span></article>`).join('')}</div>` : ''}<form class="instruction"><input aria-label="실행 중 추가 지시" placeholder="탐색 중 추가로 확인할 내용을 입력하세요" ${active() ? '' : 'disabled'}><button aria-label="추가 지시 전송" ${active() ? '' : 'disabled'}>${icon('send')}</button></form>${feedback ? `<p class="demo-feedback" role="status">${esc(feedback)}</p>` : ''}</section>`;
}
function sidebar() { return `<aside class="sidebar"><div class="brand">${icon('scan-eye')}FlowScope<button aria-label="사이드바 접기">${icon('panel-left')}</button></div><nav>${[['scan-eye','점검 시작'],['users','계정·세션'],['git-fork','점검 Gap 그래프'],['table-2','권한 매트릭스']].map(([i, t], n) => `<div class="navitem ${n === 0 ? 'active' : ''}">${icon(i)}${t}</div>`).join('')}<div class="extras"><div class="navitem">${icon('table-2')}부가 기능</div><div class="extra-links">${[['table-2','API·입력 차이'],['shield-check','교차 신원 검증'],['file-search','관측 기록']].map(([i, t]) => `<div class="navitem">${icon(i)}${t}</div>`).join('')}</div></div></nav><div class="project"><small>현재 프로젝트</small><strong>DEMO</strong><button>${icon('users')}프로젝트 관리</button></div><div class="theme-footer row">${icon(theme === 'dark' ? 'moon' : 'sun')}${theme === 'dark' ? '다크' : '라이트'} 모드</div></aside>`; }
function render() {
  const oldListScroll = document.querySelector('.feed-list')?.scrollTop || 0;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  app.innerHTML = `<div class="shell ${reading ? 'reading' : ''}">${sidebar()}<main class="main"><header class="page-heading"><h1>점검 시작</h1><p>대상 <span class="mono">https://demo.flowscope.test:443</span></p></header><div class="steps"><span>1 · 직접 둘러보기</span><span>2 · ZAP 스캔</span><span class="${requestScreen ? "" : "active"}">3 · LLM 탐색</span><span>4 · 결과 비교</span></div>${setup()}<div class="record-gap">${variant !== 'before' ? '<button class="resize-grip" id="resize-records" aria-label="진행 기록 높이 조절" role="separator" aria-orientation="horizontal" aria-valuemin="160" aria-valuemax="600" aria-valuenow="'+feedHeight+'" title="드래그 또는 위아래 방향키로 기록 높이 조절"><span class="grip-line"></span>기록 높이 조절<span class="grip-line"></span></button>' : ''}</div>${feed()}<p class="samplemark">${descriptions[variant][0]} · 예시 데이터 · 제품 변경 전 목업</p></main></div>`;
  const list = document.querySelector('.feed-list'); if (list) list.scrollTop = oldListScroll;
  document.querySelector('#accounts-toggle').onclick = () => { accountsOpen = !accountsOpen; render(); };
  document.querySelector('#details-toggle')?.addEventListener('click', () => { detailsOpen = !detailsOpen; render(); });
  document.querySelector('#feed-toggle').onclick = () => { feedOpen = !feedOpen; render(); };
  document.querySelector('#model')?.addEventListener('change', e => { model = e.target.value; render(); });
  document.querySelectorAll('[data-account]').forEach(input => input.onchange = () => { input.checked ? chosen.add(input.dataset.account) : chosen.delete(input.dataset.account); render(); });
  document.querySelector('#refresh-model')?.addEventListener('click', () => { feedback = '목업 예시: 모델 목록을 다시 확인했습니다.'; render(); });
  document.querySelectorAll('[data-demo]').forEach(button => button.onclick = () => { feedback = '목업입니다. 실제 '+button.dataset.demo+' 작업은 실행하지 않습니다.'; render(); });
  document.querySelector('.instruction') && (document.querySelector('.instruction').onsubmit = e => { e.preventDefault(); feedback = '목업 예시: 추가 지시 전송 표시입니다.'; render(); });
  document.querySelectorAll('[data-help]').forEach(button => button.onclick = () => { const span = button.closest('.help'); const open = span.dataset.open !== 'true'; span.dataset.open = String(open); button.setAttribute('aria-expanded',String(open)); });
  document.querySelector('#focus-records')?.addEventListener('click', () => {
    if (!reading) savedScroll = window.scrollY;
    reading = !reading; feedOpen = true; render();
    window.scrollTo(0, reading ? 0 : savedScroll); document.querySelector('#focus-records')?.focus({preventScroll:true});
  });
  const grip = document.querySelector('#resize-records');
  if (grip) {
    grip.onpointerdown = e => {
      const startY = e.clientY, startHeight = feedHeight;
      grip.setPointerCapture(e.pointerId);
      grip.onpointermove = ev => { feedHeight = Math.max(160, Math.min(600, startHeight + ev.clientY - startY)); const list = document.querySelector('.feed-list'); if (list) list.style.setProperty('--feed-height',`${feedHeight}px`); grip.setAttribute('aria-valuenow',String(feedHeight)); };
      grip.onpointerup = () => { grip.onpointermove = null; };
    };
    grip.onkeydown = e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); feedHeight = Math.max(160,Math.min(600,feedHeight+(e.key === 'ArrowUp' ? -40 : 40))); document.querySelector('.feed-list')?.style.setProperty('--feed-height',`${feedHeight}px`); grip.setAttribute('aria-valuenow',String(feedHeight)); } };
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && reading) { reading = false; render(); window.scrollTo(0,savedScroll); document.querySelector('#focus-records')?.focus({preventScroll:true}); } });
function frameUrl(v, t) { return `?frame=1&variant=${v}&theme=${t}&size=${size}&state=${state}&help=${helpMode}&screen=${screen}`; }
function preview(v, t, gallery = false) { return `<section class="preview"><header><strong>${gallery ? descriptions[v][0] : v === 'before' ? '개선 전' : descriptions[v][0]}</strong><small>${t === 'dark' ? '다크' : '라이트'} · ${size} × ${size*9/16}</small>${gallery && v !== 'before' ? `<button data-choose="${v}">이 안 비교</button>` : ''}</header><div class="frameholder" data-crop="${gallery ? 500 : 0}"><iframe title="${v} ${t}" src="${frameUrl(v,t)}" width="${size}" height="${size*9/16}"></iframe></div>${gallery ? `<p class="preview-tip">${descriptions[v][1]}</p>` : ''}</section>`; }
function review() {
  document.documentElement.classList.toggle('dark',theme === 'dark');
  app.innerHTML = `<header class="reviewbar"><strong>${requestScreen ? "HUMAN·ZAP 기록 목업" : "LLM QA 목업"}</strong><div class="segmented"><button data-mode="gallery" aria-pressed="${mode === 'gallery'}">배치 3안</button><button data-mode="compare" aria-pressed="${mode === 'compare'}">전후 4종</button><button data-mode="single" aria-pressed="${mode === 'single'}">직접 조작</button></div><select id="variant" aria-label="모델 배치">${Object.entries(descriptions).map(([id, [title]]) => `<option value="${id}" ${variant === id ? 'selected' : ''}>${title}</option>`).join('')}</select><select id="theme" aria-label="화면 테마"><option value="dark" ${theme === 'dark' ? 'selected' : ''}>다크</option><option value="light" ${theme === 'light' ? 'selected' : ''}>라이트</option></select><select id="size" aria-label="데스크톱 크기"><option value="1280" ${size === 1280 ? 'selected' : ''}>1280 × 720</option><option value="1920" ${size === 1920 ? 'selected' : ''}>1920 × 1080</option></select><select id="state" aria-label="실행 상태">${[['idle','실행 전'],['running','실행 중'],['completed','완료'],['failed','시작 실패']].map(([id,label])=>`<option value="${id}" ${state===id?'selected':''}>${label}</option>`).join('')}</select><span class="review-note">예시 · 실제 실행 없음</span></header><div class="review-summary"><strong>${mode === 'gallery' ? '모델 선택 위치 비교' : descriptions[variant][0]}</strong><p>${mode === 'gallery' ? '위치와 크기만 비교하세요. 각 안을 고르면 다크·라이트 전후 화면과 크게 보기를 조작할 수 있습니다.' : descriptions[variant][1]}</p><span class="spacer"></span><label for="help-mode">용어 도움말</label><select id="help-mode"><option value="split" ${helpMode === 'split' ? 'selected' : ''}>API·입력 각각</option><option value="combined" ${helpMode === 'combined' ? 'selected' : ''}>한 번에 설명</option></select></div><div class="reviewstage">${mode === 'gallery' ? `<div class="gallery">${['before','a','b','c'].map(v=>preview(v,theme,true)).join('')}</div>` : mode === 'compare' ? `<div class="comparison">${['light','dark'].flatMap(t=>['before',variant === 'before' ? 'a' : variant].map(v=>preview(v,t))).join('')}</div>` : `<div class="singleholder"><iframe title="조작 화면" src="${frameUrl(variant,theme)}" width="${size}" height="${size*9/16}"></iframe></div>`}</div>`;
  document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode;review();});
  document.querySelectorAll('[data-choose]').forEach(button=>button.onclick=()=>{variant=button.dataset.choose;mode='compare';review();});
  const selects = {variant:v=>variant=v,theme:v=>theme=v,size:v=>size=Number(v),state:v=>state=v,'help-mode':v=>helpMode=v};
  for(const [id,update] of Object.entries(selects)) document.querySelector('#'+id).onchange=e=>{update(e.target.value);review();};
  const url = new URL(location.href); for(const [key,value] of Object.entries({mode,variant,theme,size,state,help:helpMode})) url.searchParams.set(key,String(value)); history.replaceState(null,'',url);
  scale();
}
function scale(){document.querySelectorAll('.frameholder,.singleholder').forEach(holder=>{const factor=Math.min(holder.clientWidth/size,1);const height=Number(holder.dataset.crop)||size*9/16;holder.style.height=`${height*factor}px`;holder.querySelector('iframe').style.transform=`scale(${factor})`;});}
if(frame) render(); else { review();window.addEventListener('resize',scale); }
