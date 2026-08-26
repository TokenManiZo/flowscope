# FlowScope 관련연구 · 한계 · 극복 전략 (v1)

> 6갈래 문헌 서베이 후 **핵심 인용을 arXiv 원문에서 직접 재검증**한 결과. 근거 강도를 태그로 표기.
> 태그: `[탄탄]` 동료검증/확립된 연구 · `[프리프린트]` 2025~26 단독저자 미검증 · `[학사논문]` · `[초록만]` 전문 미열람.
> ⚠️ **검증에서 걸러낸 것**: 서베이 종합이 "BOLA taxonomy에서 action-level 78.6%"라 했으나 **원문은 41.7%**(78.5%는 '확인된 BOLA 비율'로 다른 값). "77.4% 의미이해/22.6% 순차정수"는 원문 초록에 없어 **폐기**.

## 1. 분야 지형 (6 계열)
- (a) **스펙+능동 프로빙 블랙박스 스캐너** — AuthProbe`[프리프린트]`, BOLABuster(Unit42)`[탄탄/벤더]`, Akto`[도구]`
- (b) **화이트박스(소스/DB)** — BOLAZ(arXiv:2507.02309)`[탄탄]`, BolaRay(CCS'24)`[초록만]`
- (c) **신원 스왑 차등 테스트** — Autorize·AuthMatrix`[도구]`, AuthScope(CCS'17)`[탄탄]`, CODASPY'14`[초록만]`
- (d) **스펙/트래픽 기반 모델추론·커버리지** — RESTler`[탄탄]`, Morest`[탄탄]`, EvoMaster`[탄탄]`, APICarv(ICSE'23)`[탄탄]`, Log-Coverage(EASE'26)`[프리프린트/채택]`
- (e) **LLM 펜테스트 에이전트** — PentestGPT`[탄탄]`, one-day exploit(Fang)`[탄탄]`, 400-run 재현성(2605.30096)`[프리프린트]`
- (f) **할루 완화·검증게이트** — SQuAD2.0(기권)`[탄탄]`, Grammar-Constrained Decoding`[탄탄]`, Self-Consistency`[탄탄]`, FActScore·RARR·Let's-Verify`[탄탄]`

관통 축 둘: **① 소유권 ground truth를 어떻게 확정하나 · ② 오라클을 결정론으로 둘까 근사(퍼센트/휴리스틱/LLM)로 둘까.** 능동 스캐너·화이트박스는 프로빙/소스로 소유권을 확정, 순수 블랙박스·LLM 계열은 응답 유사도·퍼센트로 근사하며 FP/FN을 떠안는다.

## 2. 프론티어 한계 (검증된 것만)
1. **관측 트래픽만으로 소유권 ground truth를 결정론적으로 확정** — 능동 프로빙(AuthProbe) 또는 소스(BOLAZ) 없이는 외부 근거가 없음. `[탄탄: BOLAZ가 taint로 해결한 걸 순수 관측은 못 함]`
2. **블랙박스 분모 문제** — 진짜 상태공간·객체 전체집합 미지 → 절대 커버리지 % 정의 불가. `[탄탄: Log-Coverage/APICarv]`
3. **탐지 커버리지의 읽기 편향** — 표준 BOLA 테스트가 "B가 A를 읽는가"에 치우쳐 **action-level(=행위/상태변경, BFLA)** 을 놓침. BOLA-in-the-wild가 action-level을 **41.7%**(확인된 BOLA 중 최대 패밀리)로 보고, "기존 가이드에서 과소대표"라 지적. `[프리프린트+LLM분류 타xonomy — 방향은 신뢰, 정밀수치는 참고]`
4. **같은 이름·스키마 ≠ 같은 자원·소유** — `pet.status` vs `order.status`, `addPet`/`getPetById` 둘 다 Pet 스키마. 정적으로 안전히 못 거름. `[탄탄: RESTler/Morest]`
5. **LLM 판정의 비결정성·저정밀** — 같은 타깃에도 실행마다 결과 갈림. `[탄탄: Fang(설명 없으면 87%→7%), 프리프린트: 400-run]`
6. **할루 '완화'는 되나 '제거'는 불가** — 검증은 외부 오라클 품질에 종속. `[탄탄: FActScore/RARR/GCD는 형식만 보장]`
7. **리스팅 없는/미관측 식별자 객체는 원천 테스트 불가** — 공통 FN. `[탄탄]`

## 3. FlowScope positioning (결정별 · 검증 반영)
| 우리 결정 | 선행 | 판정 | 근거 |
|---|---|---|---|
| **D-001** source ⊥ idn/role | Autorize/AuthMatrix/AuthScope/CODASPY | **novel** | 선행은 전부 '고권한 vs 저권한 신원 쌍' 비교. **탐지수단(사람/스캐너/LLM)을 겹치는 직교축이 부재** → 고유 기여 |
| **D-004/012** 오라클=status+owner+본문 | AuthProbe(유사·능동)`[약근거]`, Akto(90% 근사), Autorize(색휴리스틱) | **overcome(약근거 위)** | 근사/수작업 오라클을 결정론 규칙으로. 단 AuthProbe 정렬 근거는 단독저자·합성API라 **강하게 기대지 말 것** |
| **D-005/012** owner=본문 소유필드 우선 | BOLAZ(taint), RestTestGen(id-completion) | **partial** | 소유필드가 인가 실축인 건 지지. 그러나 동명이자원 혼동·id가 본문에 없으면 놓침은 **물려받음** |
| **D-003** 미교차=관측 내, 퍼센트 없음 | Log-Coverage, Akto(퍼센트) | **partial** | 분모 문제는 물려받되, **퍼센트로 뭉개지 않고 범위 선언**한 건 차별 |
| **D-009** 규칙엔진 본체·LLM 제안만 | BOLABuster(추론/실행 분리), BOLA-LLM(prec~0.3`[학사논문]`) | **overcome** | 판정을 규칙에 고정해 LLM 저정밀·불투명 회피. LLM은 검증가능한 제안자로 격리 |
| **D-022** 자원/소유 식별 규칙 우선, LLM은 검증게이트 하 | FActScore/RARR/Let's-Verify/SQuAD2.0(기권) | **overcome** | 검증게이트 문헌이 D-022의 학술 원형. **근거원을 외부 KB가 아닌 실재 트래픽으로** 삼아 '검증이 외부오라클에 종속' 한계를 완화 |
| **D-011** 그래프 레이어링 | Morest RPG, RestTestGen ODG | **partial** | producer-consumer 그래프를 '신원 교차 비교'로 재목적화(용도 신규). 본문 내부/암묵 의존 못 잡음은 물려받음 |

## 4. 방어 가능한 신규 주장
1. **source ⊥ identity 직교 모델** — 신원 스왑 갈래 어디에도 없는 축.
2. **순수 패시브 관측 + 결정론적 인가 오라클** — 능동 프로빙 없이 status+owner+본문으로. (AuthProbe는 스펙+능동, Akto는 퍼센트)
3. **탐지수단으로서의 LLM은 수용, 판정자로서의 LLM은 거부**하는 분리.
4. **'미교차=관측 내·퍼센트 없음'의 정직한 범위 선언** — 분모 문제를 결함이 아닌 원칙으로 흡수.
5. **검증게이트를 인가탐지에 이식하되 근거원=실재 트래픽**.

## 5. 우리가 물려받는 한계 (정직하게 — 넘지 못함)
> 이걸 논문/발표에서 "우리도 못 푼다"고 먼저 말해야 방어된다.
- **동명이자원 혼동** — 스펙 없이 관측만으로 완전 제거 불가. 관측 응답으로 소유후보 확증하는 동적 피드백으로 **완화만**.
- **리스팅 없는/미관측 식별자 객체** — 순수 패시브·무프로빙의 필연적 대가로 **능동 스캐너보다 FN이 큼**.
- **요청 id가 본문에 안 실려오는 유출** — 본문 소유필드 오라클이 놓침(AuthProbe도 자인).
- **블랙박스 분모** — '무엇을 놓쳤는지' 정량화 원천 불가. 범위 선언으로 흡수하나 근본 한계는 잔존.
- **action-level(BFLA)/상태변경 커버리지** — 오라클 확장 근거는 있으나 **상태변경 연산의 owner 확정은 미해결**(설계 주장 단계).
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
- Rethinking BOLA under Zero Trust (BOLAZ) — Wu et al, arXiv:2507.02309 `[탄탄·다저자]` https://arxiv.org/abs/2507.02309
- Assessing REST API Test Gen with Log Coverage — Reinikainen et al, arXiv:2604.07073, EASE'26 `[채택]` https://arxiv.org/abs/2604.07073
- 400-Run LLM Pentest Consistency — Erdem, arXiv:2605.30096 `[프리프린트·단독]` https://arxiv.org/abs/2605.30096
- Detecting BOLA with LLMs — Johansens, U.Twente `[학사논문]` prec~0.3 https://essay.utwente.nl/fileshare/file/107423/Johansens_BA_BIT.pdf
- AuthScope (CCS'17), RESTler(MSR), APICarv(ICSE'23), Self-Consistency/FActScore/RARR/Let's-Verify/SQuAD2.0/GCD — `[탄탄]` (URL은 journal 로그 참조)
- BolaRay(CCS'24) `[초록만]`, CODASPY'14 `[초록만]`, BOLABuster(Unit42) `[벤더]`

---
*v1 — 재검증에서 걸러낸 수치(78.6→41.7)와 약근거 태그를 반영. 이후 [초록만] 항목의 전문 확인, 그리고 §5 물려받는 한계를 설계로 얼마나 완화할지가 다음 과제.*
