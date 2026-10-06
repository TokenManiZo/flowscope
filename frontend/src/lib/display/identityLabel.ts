/** 화면 표시명만 변환한다. 신원 비교·저장·선택에는 원래 식별자를 사용한다. */
export function identityLabel(identity: string, label = identity): string {
  return identity === "anon" ? "비로그인" : label
}
