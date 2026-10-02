const screens={
 accounts:['계정·세션','ZAP·LLM 건수가 항상 —로 표시됩니다.','연결 상태와 프로젝트 누적 수집량을 따로 보여 줍니다.','설정 여부와 이미 저장된 관측량을 혼동하지 않게 합니다.'],
 human:['직접 수집','첫 목업이 기존 점검 시작의 간결한 틀에서 벗어났습니다.','기존 수집 컨트롤·계정별 표·요청 시트 구성을 기본으로 유지하고 기록 번호를 더합니다.','익숙한 배치에서 수집 계정과 요청을 빠르게 확인합니다.'],
 llm:['LLM 탐색','첫 목업은 설명·시간·횟수가 트래픽과 메시지보다 눈에 띕니다.','기존 계정 선택 표와 하단 진행 기록을 유지하고 각각 접기·펼치기를 제공합니다. 시간·횟수는 작게 두고 펼치기 버튼과 세부 수치 정렬을 다듬습니다.','작업 내용·탐색 위치·현재 상태·HTTP 기록을 한 흐름에서 읽습니다.'],
 surface:['API·입력 차이','첫 목업은 HUMAN 요청 시트와 형태가 다르고 H/S/L 열이 과합니다.','Method를 종류별 색으로 구별하고 API와 분리합니다. 출처는 한 칸의 H S L 글자색, 응답은 HTTP 코드로 표시합니다.','익숙한 표에서 경로·출처·상태를 빠르게 비교합니다.'],
 evidence:['관측 기록','역할은 직접 입력하고 메서드·상태 표시 규칙이 일정하지 않습니다.','필수 역할은 계정 등록처럼 버튼으로 선택하고 Method 배지·HTTP 색상을 통일합니다.','계정 역할과 정책을 구별하고 같은 규칙으로 관측을 읽습니다.'],
 graph:['그래프 (보류)','이번 검토 범위에서 보류합니다.','추가 설계·구현을 진행하지 않습니다.','다른 화면의 기준을 먼저 확정합니다.']
};
const url=new URL(location.href);let screen=screens[url.searchParams.get('screen')]&&url.searchParams.get('screen')!=='graph'?url.searchParams.get('screen'):'accounts';
const nav=document.querySelector('#screens');
for(const [key,value]of Object.entries(screens)){const b=document.createElement('button');b.textContent=value[0];b.setAttribute('role','tab');b.dataset.screen=key;b.disabled=key==='graph';b.onclick=()=>{screen=key;update()};nav.append(b)}
nav.setAttribute('role','tablist');
if(url.searchParams.get('size')==='1920')document.querySelector('#size').value='1920';
if(['normal','empty','running','failed','disabled','steer-failed'].includes(url.searchParams.get('state')))document.querySelector('#state').value=url.searchParams.get('state');
function update(){
 const data=screens[screen];document.querySelector('#brief-title').textContent=data[0]+' · 현재 문제';
 ['problem','change','why'].forEach((key,i)=>document.querySelector('#brief-'+key).textContent=data[i+1]);
 for(const b of nav.children)b.setAttribute('aria-selected',String(b.dataset.screen===screen));
 const width=Number(document.querySelector('#size').value),height=width*9/16,state=document.querySelector('#state').value;
 document.querySelector('#capture-note').textContent=state==='normal'?'전·후에 같은 고정 예시 데이터를 사용합니다.':'개선 전은 기본 결과 캡처입니다. 선택 상태는 개선 후 시뮬레이션에만 적용합니다.';
 for(const theme of ['light','dark']){
  document.querySelector(`.baseline-live[data-theme=${theme}]`).href=`baseline-live.html?screen=${screen}&theme=${theme}`;
  document.querySelector('#before-'+theme).src=`captures/${screen}-${theme}-${width}.png`;
  const frame=document.querySelector('#after-'+theme);frame.width=width;frame.height=height;
  frame.src=`preview.html?screen=${screen}&theme=${theme}&state=${state}&size=${width}${screen==='evidence'?'&policy=open':''}`;
  frame.style.transform=`scale(${frame.parentElement.clientWidth/width})`;
 }
 history.replaceState(null,'',`?screen=${screen}&size=${width}&state=${state}`);
}
document.querySelector('#size').onchange=update;document.querySelector('#state').onchange=update;
document.querySelector('#solo').onclick=()=>{const solo=document.querySelector('#comparison').classList.toggle('solo');document.querySelector('#solo').textContent=solo?'전후 비교로 돌아가기':'개선 후 크게 보기';scaleFrames()};
function scaleFrames(){for(const frame of document.querySelectorAll('iframe'))frame.style.transform=`scale(${frame.parentElement.clientWidth/Number(frame.width)})`}
new ResizeObserver(scaleFrames).observe(document.querySelector('#comparison'));
update();
