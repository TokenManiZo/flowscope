# FlowScope 관련연구 · 한계 · 극복 전략 (v4)

> 6갈래 문헌 서베이에서 확인한 근거를 정리한 기록이다. 전문을 확인한 항목과 초록·도구 문서만 확인한 항목을 구분하며, 체계적 문헌고찰 완료나 신규성 확정을 주장하지 않는다.
> 태그: `[탄탄]` 동료검증/확립된 연구 · `[프리프린트]` 2025~26 단독저자 미검증 · `[학사논문]` · `[본문·아티팩트 확인]` 논문 본문과 공개 재현물을 직접 확인 · `[초록만]` 전문 미열람.
> ⚠️ **검증에서 걸러낸 것**: 서베이 종합이 "BOLA taxonomy에서 action-level 78.6%"라 했으나 **원문은 41.7%**(78.5%는 '확인된 BOLA 비율'로 다른 값). "77.4% 의미이해/22.6% 순차정수"는 원문 초록에 없어 **폐기**.

> **beta.41 적용 경계:** OpenAPI·HTML form·정적 JavaScript에서 얻은 Endpoint/Parameter Declaration은 실제 요청 Observation과 분리해 표시한다. 같은 세션에서 받은 bundle을 정답지로 사용한 recall은 순환 평가가 될 수 있으므로 제품 효능 수치에는 쓰지 않고, 개발 corpus와 분리된 server-truth fixture에서 측정한다. 현재 구현 계약은 `endpoint-parameter-surface.md`와 D-113을 따른다.

## 1. 분야 지형 (6 계열)
- (a) **스펙+능동 프로빙 블랙박스 스캐너** — AuthProbe`[프리프린트]`, BOLABuster(Unit42)`[탄탄/벤더]`, Akto`[도구]`
- (b) **화이트박스(소스/DB)** — BOLAZ(arXiv:2507.02309)`[프리프린트·다저자]`, BolaRay(CCS'24)`[본문·아티팩트 확인]`
- (c) **신원 스왑 차등 테스트** — Autorize·AuthMatrix`[도구]`, AuthScope(CCS'17)`[탄탄]`, CODASPY'14`[초록만]`
- (d) **스펙/트래픽 기반 모델추론·커버리지** — RESTler`[탄탄]`, Morest`[탄탄]`, EvoMaster`[탄탄]`, APICarv(ICSE'23)`[탄탄]`, Log-Coverage(EASE'26)`[프리프린트/채택]`
- (e) **LLM 펜테스트 에이전트** — PentestGPT`[탄탄]`, one-day exploit(Fang)`[탄탄]`, 400-run 재현성(2605.30096)`[프리프린트]`
- (f) **할루 완화·검증게이트** — SQuAD2.0(기권)`[탄탄]`, Grammar-Constrained Decoding`[탄탄]`, Self-Consistency`[탄탄]`, FActScore·RARR·Let's-Verify`[탄탄]`

관통 축 둘: **① 소유권에 대한 운영상 근거를 어떻게 강화하나 · ② 오라클을 결정론으로 둘까 근사(퍼센트/휴리스틱/LLM)로 둘까.** AuthProbe는 두 운영자 통제 신원의 정상 소유자 응답을 대조 기준으로 쓰고, BOLAZ는 소스의 resource-ID taint와 인가 구간을 분석한다. 둘 다 해당 입력·가정 안에서 강한 근거를 만들지만 모든 서비스의 실제 업무 소유권을 보편적으로 증명하는 절대 ground truth는 아니다. 순수 관측·LLM 계열은 응답 차이와 휴리스틱에 더 의존해 FP/FN을 떠안는다.

## 2. 프론티어 한계 (검증된 것만)
1. **관측 트래픽만으로 소유권을 결정론적으로 확정하기 어려움** — AuthProbe는 운영자가 통제하는 복수 신원의 정상 소유 객체와 응답 대조가 필요하고, BOLAZ는 서버 소스의 resource-ID data flow를 요구한다. FlowScope처럼 HTTP 관측만 있는 경우 이 추가 오라클이 없으므로 소유자는 명시 입력·응답 필드·교차 재현으로 단계적으로 강화해야 한다. `[근거 범위: AuthProbe/BOLAZ 원문]`
2. **관측 기반 endpoint 분모의 불완전성** — APICarv는 7개 오픈소스 앱에서 endpoint 추론 정밀도 98%, 재현율 56%를 보고했다. 이는 관측·프로빙 기반 route inventory가 유용하지만 완전하지 않다는 실증이며, 모든 블랙박스 시스템에서 절대 분모가 수학적으로 불가능하다는 정리는 아니다. FlowScope는 검증된 route oracle이 없을 때 관측 수를 전체 퍼센트로 표현하지 않는 보수적 제품 정책을 택한다.
3. **탐지 커버리지의 읽기 편향** — BOLA-in-the-wild는 타 사용자 객체에 대한 무단 변경·삭제·트리거를 **Action-Level Object BOLA**로 정의하고 확인 사례의 **41.7%**로 보고했다. 이는 Direct Object Reference BOLA와 함께 두 지배적 패밀리 중 하나이며 BFLA와 동의어가 아니다. vertical user-to-admin 실패는 별도 11.9%로 보고됐다. `[프리프린트·단독저자·100+ 공개신고 taxonomy — 수치는 외부 corpus 재현 전 참고]`
4. **producer-consumer 일치 ≠ 소유권 일치** — RESTler는 OpenAPI의 producer-consumer 관계로 상태 있는 요청 순서를 만든다. 이 기능은 값 전달 근거이지 동일 이름·스키마가 같은 업무 자원·소유자라는 증명은 아니다. FlowScope의 동명이자원 분리는 이 선행의 직접 결론이 아니라 별도 benchmark로 검증해야 할 자체 한계다.
5. **LLM 판정의 비결정성·저정밀** — 같은 타깃에도 실행마다 결과 갈림. `[탄탄: Fang(설명 없으면 87%→7%), 프리프린트: 400-run]`
6. **할루 '완화'는 되나 '제거'는 불가** — 검증은 외부 오라클 품질에 종속. `[탄탄: FActScore/RARR/GCD는 형식만 보장]`
7. **리스팅 없는/미관측 식별자 객체는 원천 테스트 불가** — 공통 FN. `[탄탄]`

## 3. FlowScope positioning (결정별 · 검증 반영)
| 우리 결정 | 선행 | 판정 | 근거 |
|---|---|---|---|
| **D-001** source ⊥ idn/role | Autorize/AuthMatrix/AuthScope/CODASPY | **차별화 가설** | AuthScope는 두 합법 사용자 Alice/Bob의 post-authentication 요청·응답 차이를 이용해 필드를 바꾸고 대조한다. 역할 서열 비교가 핵심이라는 이전 설명은 부정확하다. 사람/스캐너/LLM 탐지수단을 별도 축으로 겹치는 기여의 신규성은 체계적 검색과 peer review 전까지 미확정 |
| **D-004/012** 오라클=status+owner+본문 | AuthProbe(유사·능동)`[약근거]`, Autorize(응답 비교) | **부분 대응** | 규칙 실행은 결정론적이지만 추정 owner·role의 진실성을 보장하지 않는다. 최종 verdict는 별도 통제 재현·정상 대조 Evidence와 서버 gate가 필요 |
| **D-005/012** owner=본문 소유필드 우선 | FlowScope 자체 휴리스틱; AuthProbe의 정상 소유자 응답 대조는 보조 선행 | **검증 전 가설** | BOLAZ는 소스 taint·인가 구간 분석이며 response owner-field 우선순위를 제안하지 않는다. 본문 소유 필드는 유용한 후보지만 실제 업무 소유권과 일치하는지는 corpus별 precision/recall로 측정해야 한다 |
| **D-003** 미교차=관측 내, 퍼센트 없음 | APICarv endpoint 추론; Log-Coverage의 SUT-log coverage | **제품 경계** | APICarv의 98% precision/56% recall은 관측 기반 inventory의 불완전성을 실증한다. Log-Coverage는 SUT log가 있는 특정 실험의 coverage proxy다. 둘을 블랙박스 분모 불가능의 일반 정리로 인용하지 않고, FlowScope는 검증된 전체 route oracle이 없을 때 퍼센트를 만들지 않는다 |
| **D-009/D-049** 규칙·서버 gate 권위, LLM Explorer/Judge | BOLABuster(추론/실행 분리), BOLA-LLM(학사논문) | **부분 대응** | LLM이 후보와 verdict 요청을 만들 수 있지만 모델 문장만으로 확정하지 않는다. 서버가 Evidence 묶음과 반복 재현·정상 대조 조건을 검사한다 |
| **D-022** 자원/소유 식별 규칙 우선, LLM은 Evidence 하 | FActScore/RARR/Let's-Verify/SQuAD2.0(기권) | **부분 대응** | 실제 트래픽을 근거로 연결해 감사 가능성을 높이지만, 관측 자체가 불완전하거나 owner·role이 틀리면 gate도 진실을 만들 수 없다 |
| **D-011** 그래프 레이어링 | Morest RPG, RestTestGen ODG | **partial** | producer-consumer 그래프를 '신원 교차 비교'로 재목적화(용도 신규). 본문 내부/암묵 의존 못 잡음은 물려받음 |

## 4. 평가할 차별화 가설
1. **source ⊥ identity 직교 모델**이 신원 쌍 비교만 할 때보다 세 탐지수단의 중복·누락을 더 감사 가능하게 만드는가.
2. **수동 관측 + 결정론 ZAP 기준선 + 통제 LLM 탐색**을 같은 Evidence 모델에 정렬하면 HUMAN+ZAP만 쓸 때보다 근거 있는 route/cell 후보가 늘어나는가.
3. **LLM 서술 단독 판정을 거부하고 Evidence-bound 서버 gate를 적용**하면 raw LLM 대비 후보 정밀도와 재현 가능성이 개선되는가.
4. **미교차를 관측된 적용 가능 집합으로 제한하고 퍼센트를 쓰지 않는 방식**이 검토 workload를 늘리지 않으면서 거짓 정밀도를 피하는가.
5. 위 항목은 구현 의도이지 검증 결과가 아니다. 정답 격리 benchmark와 ablation 전에는 신규성·우월성·성능 향상을 확정하지 않는다.

## 5. 우리가 물려받는 한계 (정직하게 — 넘지 못함)
> 이걸 논문/발표에서 "우리도 못 푼다"고 먼저 말해야 방어된다.
- **동명이자원 혼동** — 스펙 없이 관측만으로 완전 제거 불가. 관측 응답으로 소유후보 확증하는 동적 피드백으로 **완화만**.
- **리스팅 없는/미관측 식별자 객체** — 제공된 응답·정의·Site Map·통제 탐색 어느 쪽에서도 식별자가 드러나지 않으면 테스트할 수 없다. FN 크기는 블라인드 평가 전까지 수치화하지 않는다.
- **요청 id가 본문에 안 실려오는 유출** — 본문 소유필드 오라클이 놓침(AuthProbe도 자인).
- **블랙박스 분모** — '무엇을 놓쳤는지' 정량화 원천 불가. 범위 선언으로 흡수하나 근본 한계는 잔존.
- **action-level BOLA/상태변경 커버리지** — 오라클 확장 근거는 있으나 **상태변경 연산의 owner 확정은 미해결**(설계 주장 단계). BFLA는 기능·역할 인가 실패이므로 별도 축으로 평가한다.
- **LLM 제안 단계의 비결정성** — 검증게이트가 하류에서 걸러낼 뿐, 제안 자체의 편중·불안정은 잔존.

## 6. 트래픽 노이즈 분류의 표준 근거와 경계

- [Fetch Metadata](https://www.w3.org/TR/fetch-metadata/)의 `Sec-Fetch-Dest/Mode`는 요청 문맥을 설명하지만 모든 client가 보내는 인증 신호가 아니다. 누락을 API 아님으로 해석하지 않는다.
- [WHATWG Fetch](https://fetch.spec.whatwg.org/)의 CORS preflight에는 `OPTIONS`뿐 아니라 `Access-Control-Request-Method`가 동반된다. 따라서 OPTIONS 전체 제외는 잘못이다.
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)의 method safety와 Content-Type representation metadata를 경로 확장자보다 강한 신호로 사용하되, 서버 오표기 가능성 때문에 객체·인가 실패·redirect 신호가 있으면 보안 분석을 우선한다.
- [Beacon](https://www.w3.org/TR/beacon/)은 background 전송도 application data를 담을 수 있음을 보여 준다. `/analytics`, `/telemetry` 같은 이름은 삭제 근거가 아니라 검토 후보일 뿐이다.
- 결론은 정확한 이진 noise oracle이 아니라 비파괴 triage다. high-confidence 보조 traffic은 `EXCLUDE`, 보안 관련 신호가 충분한 traffic은 `INCLUDE`, 애매한 traffic은 메인 비교 밖 `REVIEW`로 나누되 모두 Evidence로 보존하고 사용자가 operation 단위로 되돌릴 수 있어야 한다(D-059/D-064).

## 7. 참고문헌 (재검증 완료 · URL·근거강도)
- AuthProbe — Jay Barach, arXiv:2607.20574 `[프리프린트·단독·합성API]` https://arxiv.org/abs/2607.20574
- BOLA in the Wild (Taxonomy) — Bandana Kaur, arXiv:2605.25865 `[프리프린트·LLM분류]` action-level **41.7%**(≠78.6%) https://arxiv.org/abs/2605.25865
- Rethinking BOLA under Zero Trust (BOLAZ) — Wu et al, arXiv:2507.02309 `[프리프린트·다저자]` https://arxiv.org/abs/2507.02309
- Assessing REST API Test Gen with Log Coverage — Reinikainen et al, arXiv:2604.07073, EASE'26 `[채택]` https://arxiv.org/abs/2604.07073
- 400-Run LLM Pentest Consistency — Erdem, arXiv:2605.30096 `[프리프린트·단독]` https://arxiv.org/abs/2605.30096
- Detecting BOLA with LLMs — Johansens, U.Twente `[학사논문]` prec~0.3 https://essay.utwente.nl/fileshare/file/107423/Johansens_BA_BIT.pdf
- [AuthScope (CCS'17)](https://acmccs.github.io/papers/p799-zuoA.pdf) — 두 합법 사용자 차등·필드 치환·응답 대조 `[동료검증]`
- [RESTler (ICSE'19)](https://www.microsoft.com/en-us/research/wp-content/uploads/2021/03/RESTler.pdf) — OpenAPI producer-consumer dependency와 상태 있는 요청 순서 `[동료검증]`
- [APICarv (ICSE'23)](https://conf.researchr.org/details/icse-2023/icse-2023-technical-track/40/Carving-UI-Tests-to-Generate-API-Tests-and-API-Specification) — 7개 앱 endpoint 추론 98% precision·56% recall `[동료검증]`
- Self-Consistency/FActScore/RARR/Let's-Verify/SQuAD2.0/GCD — `[탄탄]` (URL은 journal 로그 참조)
- BolaRay(CCS'24) `[본문·아티팩트 확인]` — [논문](https://leehaofeng.github.io/papers/2024-BolaRay.pdf), [공개 아티팩트](https://zenodo.org/records/13744942); CODASPY'14 `[초록만]`, BOLABuster(Unit42) `[벤더]`

---
*v4 — beta.34 현재 AuthProbe/BOLAZ의 근거 강도를 절대 ground truth로 과장한 문장, action-level BOLA=BFLA 오분류, AuthScope 역할 서열 설명, BOLAZ response-owner-field 인용, APICarv/Log-Coverage의 일반화 범위를 원문 수준으로 교정한 상태다. beta.34의 성능 경계 변경은 이 선행연구 판정을 바꾸지 않으며, 신규성·우월성은 계속 블라인드 평가와 체계적 선행연구 검토 전까지 가설이다.*
