// Existing footer controls only; these samples never invoke product actions.
const footers = [
  ['원문 보기', 16, 20, ['닫기'], 'raw'],
  ['Request Lab', 16, 16, ['닫기', 'Repeater로 보내기', 'Request Lab 전송']],
  ['XML 가져오기', 16, 16, ['XML 가져오기 실행']],
  ['새 프로젝트', 16, 16, ['프로젝트 만들고 열기']],
  ['계정 등록', 12, 20, ['취소', '등록']],
  ['계정 설정', 12, 20, ['취소', '저장']],
  ['계정 삭제', 10, 16, ['취소', '삭제']],
  ['프로젝트 삭제', 16, 16, ['취소', '프로젝트 삭제']],
  ['현재 프로젝트 전환 후 삭제', 16, 16, ['취소', '전환하고 삭제']],
  ['기록 비우기', 16, 16, ['취소', '기록 비우기']],
  ['저장하지 않고 닫기', 16, 16, ['계속 편집', '저장하지 않고 닫기']],
];

export function footerAudit(variant) {
  return `<h1>하단 버튼 영역 · 적용 대상 11곳</h1><p class="audit-note">기존 버튼 영역만 비교한 예시입니다. 상하 여백 ${variant === 'after' ? '8px 통일' : '현재 값'} · 버튼 높이 32px 유지 · 실제 동작 없음</p>
  <div class="footer-audit">${footers.map(([name, before, horizontal, labels, kind]) => `<section class="footer-specimen"><h2>${name}<small>${variant === 'after' ? 8 : before}px</small></h2><div class="footer-clip"><footer class="audit-footer ${variant === 'before' && kind === 'raw' ? 'clipped-footer' : ''}" style="padding:${variant === 'after' ? 8 : before}px ${horizontal}px">${labels.map((label, i) => `<button type="button" data-footer-demo ${i === labels.length - 1 && ['삭제', '프로젝트 삭제', '전환하고 삭제', '기록 비우기', '저장하지 않고 닫기'].includes(label) ? 'class="destructive-action"' : ''}>${label}</button>`).join('')}</footer></div></section>`).join('')}</div><p id="footer-demo-message" role="status" class="audit-note"></p>`;
}
