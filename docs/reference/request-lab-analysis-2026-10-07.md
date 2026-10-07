# Request Lab 첨부 화면 원인 분석

기준: 원격 `v1.0.1`의 `fd2906a`. 이전 분석 기준은 `5af45da`였으며 아래 내용을 현재 기준으로 갱신했다.

범위: 코드 읽기와 첨부 화면 분석만 수행했다. Request Lab과 백엔드 코드는 변경하지 않았으며 실제 재전송도 수행하지 않았다. 첨부 이미지의 인증 값은 이 문서에 옮기지 않는다.

## 1. 인증 선택이 회색인 이유

`RequestLabDialog.tsx`의 인증 Select는 `!entry || editRejected || suspended || busy`이면 비활성화된다. 원문 보기에서는 편집 탭인 `entry`가 없으므로 인증 선택이 잠긴다. 12:31 화면의 `편집으로 돌아가기`와 `읽기 전용` 표시는 원문 보기 상태와 일치한다. 원문을 보면서 인증을 바꾸는 흐름은 현재 제공하지 않는다.

편집 탭으로 돌아가더라도 계정의 재사용 가능한 세션이 없으면 해당 계정 옵션은 비활성화된다. 전체 Select 비활성화와 개별 계정 사용 불가는 별도 조건이다. 색상을 흰색으로 바꾸는 것만으로는 조작 가능 여부를 해결하지 못한다. 향후 개선한다면 읽기 전용 사유와 편집 전환 동작을 함께 안내해야 한다.

## 2. 요청이 보이는데 재전송할 수 없는 이유

`v1.0.1`의 `FlowScopeExtension.requestLabDraft()`는 메모리 원본이 없을 때 프로젝트에 완전한 요청 payload가 보존되어 있으면 저장된 원문을 편집·재전송에 사용한다. 반환되는 `rawRequestRetained` 값도 메모리 원본 또는 완전한 저장 payload가 있으면 true다. **현재 기준에서는 메모리 원본이 없다는 사실만으로 전송을 차단하지 않는다.**

요청이 크기 상한을 넘었거나 바이너리라 완전한 payload가 남아 있지 않은 경우, 또는 요청 디코딩이 편집을 허용하지 않는 경우에는 여전히 차단된다. 화면에 미리보기가 보이는 것과 완전한 재전송용 요청이 존재하는 것은 다르다.

원본 메모리 저장소의 기본 요청 상한은 1 MiB, 응답 상한은 4 MiB, 전체 메모리 상한은 32 MiB다. 전체 상한을 넘으면 오래된 항목부터 제거한다. 다만 현재 버전에는 저장 payload를 이용하는 대체 경로가 있으므로, 메모리 퇴거가 곧 편집 불가를 뜻하지 않는다.

첨부의 `메모리 원문이 없습니다 ... 마스킹된 전문` 안내는 이전 `5af45da` 기준의 동작과 일치한다. 그 버전은 메모리 항목이 없으면 저장 전문을 보여 주더라도 editable을 false로 반환했다. 당시의 `원문 일부가 보존되지 않았거나 마스킹됐습니다`도 실제 마스킹 검사가 아닌 원문 보존 플래그로 표시했다.

현재 `RequestLabDialog.tsx`는 요청 원문 미보존과 응답 원문 미보존을 각각 안내한다. 일반적인 마스킹 안내는 제거되어 있다. 화면에 인증 헤더가 보이는 부분은 현재 버전의 원문 보존 흐름과도 양립한다. 첨부 실행 버전 자체는 화면만으로 확정하지 못했다.

`v1.0.1`의 매트릭스는 `requestLabEvent()`를 사용해 근거 기록의 원문이 없으면 같은 API·같은 신원의 다른 사용 가능한 기록을 선택한다. UI 작업을 옮기면서 이 기존 동작을 유지했으며 해당 회귀 테스트도 유지했다. Request Lab 코드는 이번 작업에서 수정하지 않았다.

## 3. 응답 수신 후 Evidence 기록 실패

`FlowScopeExtension.executeHumanRequestLab()`에서 응답 객체를 확인한 뒤 `received = true`로 바꾼다. 이후 처리에서 RuntimeException이 발생하면 `RECORDING_FAILURE`를 기록하고 첨부와 동일한 `응답 수신 · Evidence 기록 실패` 오류를 던진다. 따라서 이 문구는 대상 HTTP 응답이 도착한 뒤 발생한 오류이며, 연결 실패나 인증 실패를 직접 뜻하지 않는다.

이후 실패 가능한 단계는 응답 디코딩, `recordFrom`, 기록 추가와 원문 보존, `analyzedRecord()`의 분석 결과 조회, 원본/결과 기록 삭제 여부 확인, 실행 이력 갱신과 저장 예약이다. 기록 추가 시 종료 상태·레코드 상한·원본 삭제 조건도 검사한다. 프로젝트 전환 오류인 `DatasetReplacedException`은 별도 전달되므로 이 문구의 직접 원인으로 단정하지 않는다.

정확한 내부 예외는 첨부로 확정할 수 없다. 웹 서버는 이 예외를 HTTP 400의 메시지만으로 반환하며 이 경로에서 원인 예외를 로그에 출력하지 않는다. 프론트엔드는 실패를 `{ response: "", status: 0, failure: 메시지 }`로 저장한다. 이 때문에 **실제로 응답이 도착했어도 화면은 `응답 없음`과 빈 응답 패널을 표시한다.** `대상 처리 여부 미확인`도 status가 0인 모든 실패에 붙는 일반 문구다. 응답 수신 사실과 최종 작업 성공 여부는 별도로 다뤄야 한다.

또한 기록 추가 이후의 실패라면 일부 관측 기록이 이미 남았을 가능성이 있다. 자동 재전송으로 해결할 문제는 아니다. 향후 수정 시에는 실패 단계와 내부 원인 식별자를 보존하고, 응답 수신 여부·HTTP 상태·기록 저장 여부를 분리해 반환하는 설계가 필요하다. 이는 제안이며 이번에는 구현하지 않았다.

## 확인 근거

- `frontend/src/features/evidence/RequestLabDialog.tsx`: 편집본 생성, 초안 로딩, 인증 Select/전송 잠금, 전송 catch와 오류 표시.
- `src/main/java/io/flowscope/burp/FlowScopeExtension.java`: 원본 메모리 상한, `requestLabDraft`, `executeHumanRequestLab`, `appendRequestLabRecord`, `appendControlledToolRecord`, `analyzedRecord`.
- `src/main/java/io/flowscope/burp/TransientExchangeVault.java`: 메모리 보존·퇴거·초기화.
- `src/main/java/io/flowscope/web/FlowScopeWebServer.java`: 재전송 결과/오류 응답.
- `frontend/src/features/matrix/requestLabEvent.ts`: 사용 가능한 요청 기록 선택.
