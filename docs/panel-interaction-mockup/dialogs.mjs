const contents = {
  'account-delete': ['USER B 계정을 삭제할까요?', '이미 기록된 요청은 남아요.', '삭제'],
  'project-delete': ['127.0.0.1-9000 프로젝트를 삭제할까요?', '프로젝트 DB와 저장된 관측 기록이 영구 삭제되며 복구할 수 없습니다.', '프로젝트 삭제'],
};

export function dialogMarkup(screen, variant, open) {
  if (!['raw', ...Object.keys(contents)].includes(screen)) return '';
  if (!open) return '<div class="dialog-reopen"><button id="reopen-dialog">확인 창 다시 열기</button></div>';
  if (screen === 'raw') return `<div class="dialog-overlay"><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="mock-dialog raw-dialog ${variant}">
    <header><h2 id="dialog-title">원문 보기</h2><p>서버가 반환한 마스킹 요청과 응답을 읽기 전용으로 표시합니다.</p></header>
    <div class="raw-body"><dl class="raw-meta"><div><dt>서비스</dt><dd class="mono">https://demo.flowscope.test:443</dd></div><div><dt>관측 신원</dt><dd>anon</dd></div></dl>
    <p class="raw-notice">이 Evidence의 메모리 원문이 없습니다(가져오기·메모리 상한/eviction 가능). 마스킹된 전문을 표시합니다.</p>
    <div class="raw-columns">${['요청', '응답'].map(label => `<section><h3>${label}</h3><p>이 원문은 보존되지 않아 사용할 수 없습니다.</p></section>`).join('')}</div></div>
    <footer><button id="close-dialog">닫기</button></footer></section></div>`;
  const [title, description, action] = contents[screen];
  return `<div class="dialog-overlay"><section role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-description" class="mock-dialog confirm-dialog ${screen} ${variant}">
    <header><h2 id="dialog-title">${title}</h2><p id="dialog-description">${description}</p></header>
    <footer><button id="close-dialog">취소</button><button id="mock-delete" class="destructive-action">${action}</button></footer>
    <p id="dialog-feedback" role="status" hidden></p></section></div>`;
}
