# 보안 정책

영문 보안 정책은 [`docs/en/SECURITY.md`](docs/en/SECURITY.md)에 있습니다.

## 지원 버전

보안 수정은 최신 `1.x` release에 적용합니다.

## 취약점 신고

대상 트래픽 노출, MCP 인증 우회, active scan scope 확대, credential 유출 가능성이 있는 취약점은 공개 issue로 신고하지 마십시오. 저장소의 비공개 GitHub Security Advisory 신고 기능을 사용하고, 영향 version, 재현 절차, impact, 제3자 비밀값이나 운영 데이터를 포함하지 않은 최소 PoC를 제출하십시오.

비공개 신고 기능이 활성화되지 않았다면 공개 전에 maintainer에게 비공개로 연락하십시오. 7일 안에 접수 확인을 목표로 하며 bounty를 약속하지 않습니다.

## 운영 안전

FlowScope는 소유하거나 명시적으로 점검 허가를 받은 시스템에만 사용하십시오. MCP 서버는 loopback에 유지하고 생성된 Bearer token을 사용하며, 가능한 가장 좁은 scope를 설정하고 ZAP Active Scan 전에 Burp 확인 창을 검토하십시오.

선택적 `~/.flowscope/mcp-token` 파일은 model provider token이 아니라 로컬 FlowScope credential입니다. POSIX에서는 소유자만 접근할 수 있도록 `0600`으로 유지하고 commit하지 마십시오. 파일을 삭제하거나 값을 교체하면 credential이 회전합니다.

프로젝트 파일은 마스킹되지만 익명화되지는 않습니다. 경로, 식별자, 응답 내용, business data가 남을 수 있으므로 engagement의 데이터 처리 정책에 따라 저장하고 삭제하십시오.
