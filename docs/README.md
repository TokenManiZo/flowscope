# FlowScope 문서

처음 쓰는 분은 [README](../README.md)의 설치와 첫 점검부터 보세요. 더 자세한 설명이나 문제 해결 방법은 아래에서 찾을 수 있습니다.

## 사용하기

| 문서 | 이럴 때 보세요 |
|---|---|
| [점검 흐름 상세](guide/inspection-flow.md) | 리스너, 점검 범위, 계정 세션, ZAP과 LLM 단계가 어떻게 동작하는지 알고 싶을 때 |
| [계정별 세션 격리](guide/inspection-flow.md#계정별-세션-격리와-검증) | 계정별 세션을 섞지 않는 방법과 근거 |
| [문제 해결](troubleshooting.md) | 오류 문구가 나오거나 기록이 안 쌓일 때 |
| [소스 빌드와 데모](guide/build-from-source.md) | 직접 빌드하거나 Burp 없이 화면만 볼 때 |

## 찾아보기

| 문서 | 내용 |
|---|---|
| [화면별 설명](reference/screens.md) | 사이드바의 각 화면과 버튼 |
| [기능 상세](reference/features.md) | 무엇을 모으고 어떻게 분석하는지, 어떤 기준으로 후보를 고르는지 |
| [포트·설정·출처 모델](reference/settings.md) | 리스너 포트, 웹 포트, ZAP API key, 출처 구분 |
| [판정 규칙·데이터 처리·한계](reference/trust-and-limits.md) | 후보 판정 기준, 데이터를 저장하고 비밀값을 가리는 방법, 알려진 한계 |

## 변경 기록

버전마다 바뀐 점과 업그레이드할 때 주의할 점은 [버전별 변경 기록](releases/README.md)에 있습니다.

## 개발에 참여하기

| 문서 | 내용 |
|---|---|
| [기여 안내](CONTRIBUTING.md) | 변경 범위, 로컬 검증, PR 작성 방법 |
