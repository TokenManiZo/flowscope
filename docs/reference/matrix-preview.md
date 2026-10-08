# 판정 매트릭스 확인용 데이터

프로젝트 루트에서 `mvn -DskipTests package`로 현재 브랜치를 빌드한 뒤,
`frontend`에서 `npm run preview:matrix`를 실행한다.

http://127.0.0.1:17778/#matrix 에서 USER A, USER B, ADMIN과 합성 요청 21건을 확인할 수 있다.
기존 SampleProject 생성기를 사용하며 BFLA, BOLA/IDOR 추천, 차단 응답, 미점검 셀,
객체 소유자와 요청·응답 원문이 있어 셀을 선택하면 오른쪽 상세 패널을 확인할 수 있다.
기능 권한과 객체 권한 탭을 각각 선택해서 확인한다.

데모는 외부 서버에 요청하지 않는다. 프로젝트 저장 위치는 `.local/matrix-preview-projects`이고
실제 수집 서버의 17777 포트 및 프로젝트와 분리된다. 종료는 실행 터미널에서 Ctrl+C.
Standalone의 Request Lab은 원문 확인용이며 전송은 지원하지 않는다.
