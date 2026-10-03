# PR #42 배치·저장 수정 기록

사용자 요청에 따라 목업 승인 없이 확인된 원인 경로를 수정했다. 검색 2단계는 구현하지 않았다. 사용자가 빌드·테스트·실제 Burp 검증과 원격 push를 담당한다. 최종 전달 대상은 로컬 `FEAT/graph-stage-01`이다.

## 수정 범위

- 신규 카드 배치에서 현재 보기의 숨긴 저장 좌표까지 예약한다. 기존 카드 위치는 그대로 복원하며 신규 카드만 예약 공간 아래에 둔다. 숨긴 카드의 실제 기본 크기는 저장되지 않으므로 허용 높이 상한 480px을 예약한다. 종류 추측·전체 논리 노드 투영·O(N²) 충돌 해소를 추가하지 않는다. 여백이 늘어날 수 있다.
- 실제 operation·node/view/group 키를 자르거나 해시로 변경하지 않는다. 개별 키 제한을 UTF-8 64KiB로 맞추고 기존 forbidden key/secret masking, 보기/좌표 개수 제한을 유지한다. 변경 JSON 2MiB도 UTF-8 바이트 기준으로 검사한다. JSON/SQLite 프로젝트 저장 구조와 schema 버전은 유지한다. 예전 JAR의 좁은 키 제한은 소급 변경되지 않는다.
- 기존 보기에는 노드 단위 `viewPatches`를 전송한다. 변경된 좌표·크기, 제거 키, viewport, 펼침 상태를 구분하며 다른 보기·숨긴 좌표를 보존한다. 새 보기와 이전 클라이언트의 whole-view 저장도 지원한다. 전체 교체/삭제와 patch가 같은 보기를 동시에 지정하거나 같은 geometry 키를 추가/삭제하면 거부한다. 서버의 dataset/revision 확인과 검증 후 설치 경로를 유지한다.
- 좌표·크기 변경은 debounce 없이 전송하고, 연속 viewport 변경에는 1초 최대 대기 시간을 둔다. 요청은 직렬화하고 ACK 이후 변경도 계속 저장한다. hidden 전환/pagehide flush를 유지하며 미수락 변경이 있을 때만 beforeunload 안내를 등록한다. 실제 encoded body가 32KiB 이하일 때 keepalive를 보조적으로 사용한다. 변경이 큰 최초 저장/전체 정렬은 일반 fetch가 필요할 수 있다.
- 저장 실패 후 현재 배치를 유지하는 `다시 저장`을 제공한다. revision 충돌을 자동 덮어쓰지 않는다. 동기 직렬화 실패도 request 상태를 해제하여 재시도가 막히지 않도록 처리한다.

## 추가한 회귀 테스트 — 실행 전

- 접힌/표시 제한 카드와 신규 카드의 충돌, 다시 펼친 뒤 원래 좌표, 보이는 저장 카드가 없는 레인.
- 500개 보기에서 한 좌표 변경만 전송, viewport 단독 변경, 초기화의 삭제·null 의미, 긴 경로 ID 구분.
- in-flight 편집/프로젝트 전환, 큰 미수락 요청의 종료 안내와 ACK 후 해제, hidden 전환 flush, 일시 실패 후 재시도.
- 긴 navigation/view/node/group 키의 JSON·SQLite 저장·재열기·metadata checkpoint.
- UTF-8 키/본문 경계, secret/forbidden key 거부, patch의 숨긴 좌표·다른 보기 보존과 상충 지시 거부.
- HTTP API의 긴 키 수락, sparse patch 역직렬화, 잘못된 patch의 상태/revision 보존, UTF-8 본문 크기 거부.

코드 및 테스트 소스의 정적 검토와 `git diff --check`만 수행한다. 이전 리뷰의 635건 통과 결과를 이번 수정 검증으로 인용하지 않는다. `mvn clean verify`, 프런트엔드 검사, Java 테스트, Playwright/브라우저/Burp 검증은 실행하지 않았다.

## 저장 보장의 한계

노드 patch는 전송량을 줄이며 DB metadata의 전체 workspace 직렬화까지 줄이지는 않는다. 기존 Burp의 30초 checkpoint와 정상 종료 flush는 유지한다. 서버 수락이 파일 저장 완료라는 새 UI나 별도 저장 완료 API를 추가하지 않았다.

Fetch 표준의 keepalive 제한은 같은 fetch group의 진행 중 본문을 합쳐 64KiB다. 32KiB 이하라도 다른 요청과 quota를 공유하므로 실패할 수 있다. [Fetch Standard](https://fetch.spec.whatwg.org/#http-network-or-cache-fetch). 종료 이벤트·안내·전송이 생략되는 브라우저/프로세스 강제 종료는 보장하지 않는다. 안정된 프로젝트 식별자와 secret-free 복구 초안 저장은 별도 설계가 필요하다.

원격 push/PR 게시/merge는 수행하지 않는다. 수정만 focused commit으로 남기며 기존 `.gitignore`, `AGENTS.md`, `CLAUDE.md`, 다른 미커밋 문서 변경은 포함하지 않는다.
