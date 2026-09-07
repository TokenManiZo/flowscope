# FlowScope — 리서치 제안서 (v2, beta.43 정합성 갱신)

> **2026-09-07 연구 보류 경계:** 아래 영문 abstract·LLM Judge·동결 데이터셋·자동 최종 gate·ablation은 이전 연구 제안으로 보존한다. D-126으로 실행기를 제거했으므로 현재 제품 설명이나 완료 연구 결과가 아니다. 별도 Explorer/제품 MCP의 역할을 정한 뒤 연구 설계를 다시 검토하며, 현재 상태는 [HANDOFF](HANDOFF.md)를 따른다.

> **문서 지위(2026-09-03):** 이 문서는 연구 가설과 평가 설계를 보존하는 제안서이며 제품 동작 정본이 아니다. 현재 제품 계약은 `README.md`, `architecture.md`, `decisions.md`, 실제 검증은 `beta-validation.md`가 담당한다. beta.43은 블랙박스 전체 분모나 “셋 다 놓친 전체 여집합”을 안다고 주장하지 않으며, 관측된 적용 가능 cell과 근거 있는 미요청 route 후보만 다룬다. 최종 verdict는 별도 VALIDATION run의 반복 재현·정상 대조 Evidence를 서버가 검증한 경우에만 허용한다.

> **beta.42 보충:** 현재 제품은 관측 cell 비교 앞에 Endpoint·Parameter Declaration/Observation Delta를 두고 JavaScript AST call-site와 파싱 실패 상태를 분리한다. 저장소 내부 held-out 구조 회귀를 통과한 것은 논문 효능이나 외부 일반화를 입증하지 않으며, `endpoint-parameter-surface.md`의 승인된 pilot 전까지 연구 가설로 분리한다.

> **beta.43 보충:** JavaScript declaration은 lexical 불변 object member·axios instance를 보강하고 동적·재할당 값은 typed unresolved로 남긴다. 이는 정적 data-flow 완성이나 실제 앱 recall 향상을 입증하지 않으며 D-115와 독립 pilot gate를 따른다.

**English title (working):** *FlowScope: Differential Traffic Coverage for LLM-Assisted Discovery of API Authorization Vulnerabilities*

> **한 줄 주장 (Thesis).**
> 사람·스캐너·LLM은 모두 HTTP 트래픽을 남기며, 각자 **체계적으로 편향된** API 커버리지를 만든다.
> 이 세 트래픽을 **하나의 신원-인지(identity-aware) 커버리지 좌표계**에 정렬해 그 **차등(differential)**을 LLM에게 컨텍스트로 주면,
> 이 차등이 raw-LLM 또는 스캐너 단독보다 **BOLA / BFLA / broken-access** 후보 품질을 높이는지 검증하며,
> 그 후보는 두 개의 시각화 뷰와 캡처된 재현·대조 Evidence를 통해 빠르게 검증된다.

**English abstract (paper seed).**
General-purpose scanners have limited authorization semantics unless identity, ownership, and workflow context are supplied. Human testers, scanners, and LLM agents each exercise a biased slice of the observed API identity×operation×resource space, while raw request logs are costly to reconstruct by hand. FlowScope normalizes controlled traffic from these three actors into one identity-aware representation and lets a separate LLM Judge reason over a frozen three-way differential to rank authorization candidates. A matrix, graph, and Evidence drill-down make those candidates auditable. We evaluate on labeled API benchmarks with a 2×2 ablation isolating the value of (a) adding the LLM as a traffic source and (b) providing the differential as analysis context. Metrics include candidate precision/recall, review cost, time-to-verify, and findings linked to evidence-backed route candidates that no actor executed before validation; they do not treat the unknown black-box complement as measurable product coverage.

---

## 1. 동기 (Motivation)

세 가지 관찰이 이 연구의 출발점이다.

1. **일반 목적 스캐너만으로는 인가 의미가 부족하다.** BOLA(객체 인가)·BFLA(기능 인가)는 "이 객체가 누구의 것인가", "이 기능이 어떤 role 전용인가"라는 **의미(semantic)** 문제다. 일부 도구와 연구는 신원 스왑·정책·코드 분석을 사용하지만, 일반적인 크롤링·시그니처만으로는 소유권과 역할 문맥을 완결하기 어렵다. FlowScope는 이 한계를 절대적 불가능으로 표현하지 않고 HUMAN·ZAP·LLM의 실제 차이를 측정 대상으로 둔다.
2. **사람은 UI가 이끄는 경로만 밟는다.** 수동 테스터는 화면에서 도달 가능한 흐름을 따라가며, 백오피스·레거시·문서화 안 된 엔드포인트, 그리고 "밟긴 했지만 **다른 신원으로는 안 밟은**" 조합을 체계적으로 놓친다.
3. **Burp 트래픽은 한눈에 안 들어온다.** 프록시 히스토리가 수천~수만 건이면 사람이 커버리지 갭을 눈으로 파악하는 것은 불가능하다. 놓침의 상당수가 "안 보여서" 발생한다.

핵심 통찰: **이 세 주체가 남긴 결과물은 모두 트래픽으로 환원된다.** 따라서 셋을 같은 좌표계에 올려 "누가 어디를 안 밟았나"를 차등으로 드러낼 수 있고, 그 빈칸이 곧 인가 취약점의 유력 후보다.

## 2. 문제 정의 (Problem)

대상 앱의 관찰 가능한 공간을 **(신원 × 엔드포인트 × 객체)** 3축의 셀 집합으로 본다.

- **신원(identity):** anon, userA, userB, admin 등 role/세션.
- **엔드포인트(endpoint):** `METHOD + 정규화된 경로` (예: `DELETE /order/{id}`). GraphQL/RPC는 operation·method 명으로 키를 대체.
- **객체(object):** 요청이 참조하는 자원 식별자(id/uuid)의 소유 관계(자기 것 / 남의 것 / 상위권한 것).

각 트래픽 소스 S ∈ {human, scanner, llm} 는 이 공간의 부분집합 `Cov(S)` 를 채운다. 우리가 찾는 것은:

- **미교차 후보 셀:** 관측된 identity·operation·resource 중 적용 근거는 있으나 아직 해당 신원으로 실행하지 않은 셀. 정책상 금지인지와 취약한지는 후속 Evidence 검증 전에는 미확정이다.
- **단일-신원 열:** 특정 엔드포인트를 오직 `admin`만 밟은 열 (BFLA 후보 열).
- **미실행 route 후보:** 응답·정적 메타데이터·API 정의 등 scope 내부 Evidence에서 발견됐지만 세 source가 아직 요청하지 않은 route. 블랙박스 전체 여집합이 아니라 근거 있는 후보 inventory다.

> **범위 명시:** FlowScope의 분석 코어는 자체 페이로드를 생성하는 액티브 스캐너가 아니다. 확장 기능은 명시적 범위와 사용자 승인 아래 외부 ZAP 실행을 오케스트레이션할 수 있으며, 그 실제 트래픽도 출처를 보존해 수집한다. 세 트래픽을 **비교·정렬·시각화**하고 LLM이 차등 근거로 후보를 **지목**한다. 제품 최종 verdict는 D-049의 서버 검증 Evidence 오라클로, 연구 성능은 모든 pass가 잠긴 뒤 라벨 정답으로 독립 채점한다.

## 3. 접근 (Approach) — 파이프라인

```
① 수집    HUMAN listener · ZAP→Burp listener/HAR · LLM MCP 통제 executor
② 정규화  경로 템플릿화(/order/1234 → /order/{id}) · GraphQL→op명 · 각 요청에 신원 태깅
③ 정렬    (신원 × 엔드포인트 × 객체) 커버리지 매트릭스 + 데이터플로우 그래프 구축
④ 분석    별도 Judge가 동결된 3자 차등을 읽고 BOLA/BFLA/broken-access 후보를 Evidence와 함께 랭킹
⑤ 검증    별도 LLM VALIDATION run의 반복 재현 + 정상 대조 + 서버 오라클
⑥ 시각화  매트릭스 히트맵(갭) + 플로우 그래프(체인) = 사람 감사·오버라이드
⑦ 평가    라벨된 벤치마크에서 후보 precision/recall + 2×2 ablation
```

### 3.1 정규화 (가장 어려운 단계)
- **경로 템플릿화:** 숫자/UUID/해시 세그먼트 휴리스틱 + 응답 구조 유사도 클러스터링으로 `/users/1234`, `/users/9987` → `/users/{id}`. 이걸 안 하면 노드 수천 개짜리 털뭉치가 되어 이후 전 단계가 무의미해진다.
- **GraphQL/RPC 붕괴 방지:** 전부 `POST /graphql`로 수렴하므로 노드 키를 **operation name**으로 교체.
- **신원 태깅:** 각 요청을 세션 쿠키/토큰/헤더로 role에 귀속. 이 태깅이 없으면 "차등 커버리지"의 신원 축이 성립하지 않는다.

### 3.2 커버리지 표현 (두 개, 목적이 다름)
- **판정 매트릭스:** 관측된 적용 가능 집합 안에서 “누가 밟았고 누가 아직 안 밟았는가”를 보는 용도다. 블랙박스 전체 분모나 전역 커버리지 퍼센트는 만들지 않는다.
  ```
                   GET /order/{id}   DELETE /order/{id}   POST /admin/refund
    anon              ✗                  ✗                   ✗
    userA             ●                  ○ ←미시도            ○ ←미시도
    userB             ●                  ○                   ○
    admin             ●                  ●                   ●  ← admin만 밟음 = BFLA 후보 열
    (● 트래픽 있음 · ○ 미시도(금지여야 정상) · ✗ 금지 확인됨)
  ```
- **데이터플로우 그래프(node-link):** 값(id/token)이 엔드포인트 사이를 흐르는 체인. IDA의 xref에 대응하며 **BOLA 체인 추적**에 제격. 노드=엔드포인트, 선=데이터 의존(네비게이션 아님).

### 3.3 LLM 분석 (Option B — LLM이 분석까지)
LLM은 두 역할을 분리한다. Explorer는 독립된 세 번째 실제 트래픽 source이고, 별도 Judge는 동결된 세 결과의 **가설 수립 + 표적 후보 생성 + 우선순위 + 통제 검증**을 담당한다.
```
3자 차등 → 유망 셀 목록 → 셀마다 취약 클래스 가설("여긴 BFLA")
        → 근거(왜 위험한지) + 재현 힌트 → 랭킹된 후보 리스트
```

### 3.4 시각화 = 검증 감사 인터페이스
시각화 자체는 논문 기여가 아니라 **method와 Evidence를 사람이 감사하는 인터페이스**로 위치시킨다. LLM이 후보를 랭킹하고 별도 run으로 검증 → 서버가 Evidence 계약을 판정 → 분석가가 매트릭스/플로우 뷰에서 확인·반증·오버라이드한다.

## 4. 왜 "효율적"인가

이 취약점 가족은 표면은 달라도 하나의 문장으로 환원된다: **"같은 요청이 다른 신원/상태로 보냈을 때 금지여야 하는데 성공한다."** 여기서 세 가지 효율이 나온다.

1. **공통 오라클:** 클래스마다 탐지기를 따로 만들 필요 없이 하나의 차등 판정으로 가족 전체를 다룬다.
2. **조합 폭발 프루닝:** 순진하게는 `엔드포인트 N × 신원 M × 객체 K` 전수 시도로 폭발한다. 차등 그래프가 유망 셀(예: admin만 밟은 열)만 남겨 수천 칸 → 수십 칸으로 줄인다.
3. **재생-시드:** 블라인드 퍼징이 아니라, 이미 캡처된 진짜 요청을 신원만 바꿔 재생하는 표적 검증 — 유효성 높고 저렴하다. 사람·스캐너 트래픽이 그대로 시드가 된다.

## 5. 취약점 스코프 (정직한 경계)

| 클래스 | 오라클 | 이 프레임에서 | 포함? |
|---|---|---|---|
| BOLA / IDOR (동일 개념) | 이진 판정 | 최적 | ✅ 핵심 |
| BFLA | 이진 판정 | 최적 | ✅ 핵심 |
| Broken access control (일반) | 대체로 이진 | 좋음 | ✅ |
| Broken authentication | 프로브 방식 다름(JWT/세션/리셋) | 부분적 | △ 인가와 분리해 다룸 |
| 순수 business logic (가격·race·쿠폰) | 자동 판정 어려움 | 프레임 밖 | ❌ future work |

> IDOR와 BOLA는 같은 개념(전자가 옛 명칭). 논문에서 둘 다 나열하면 중복 계수로 지적당하므로 **BOLA로 통일**한다.

## 6. 기여 (Contributions)

- **C1.** 세 이질적 액터(사람/스캐너/LLM)의 트래픽을 **단일 신원-인지 커버리지 표현**으로 통합하는 정규화·정렬 방법.
- **C2.** 그 3자 차등을 컨텍스트로 사용해 LLM이 BOLA/BFLA 후보를 랭킹하는 분석 방법, 그리고 그것이 raw-LLM 대비 우월함을 보이는 **2×2 ablation**.
- **C3.** 후보를 사람이 초고속 검증하는 **두 시각화 뷰**(커버리지 매트릭스 + 데이터플로우 그래프)와 검증 시간 단축 효과 평가.
- **C4.** 라벨된 벤치마크에서 세 source가 검증 전 실행하지 않았지만 scope 내부 Evidence로 발견된 route/cell 후보에서 실제 취약점을 추가로 찾는지 실증.

## 7. 평가 설계 (Evaluation)

### 7.1 2×2 Ablation — Option B의 순환 함정을 실험설계로 전환
LLM이 소스이자 분석가이면 "내가 커버한 걸 내가 발견"하는 순환이 생긴다. 두 레버를 분리 측정하면 오히려 두 기여가 독립적으로 증명된다.

| | 분석가에 **차등 컨텍스트 없음** | 분석가에 **3자 차등 있음** |
|---|---|---|
| **소스 = 사람+스캐너만** | (baseline) raw LLM | 차등만의 효과 |
| **소스 = +LLM 트래픽** | LLM 커버리지 효과 | **풀 시스템** |

- 가로축 = "**차등을 주면 LLM이 더 잘 찾나**" (핵심 주장)
- 세로축 = "**LLM을 3번째 소스로 넣으면 커버리지가 늘어 갭이 줄어드나**"

### 7.2 벤치마크 (라벨된 정답셋)
- **crAPI**, **VAmPI**, **vAPI** — BOLA/BFLA 라벨 문서화됨.
- **OWASP Juice Shop** — 인가 챌린지 다수.
- **DVGA** — GraphQL 계열 커버리지 붕괴 케이스 검증.
- (가능하면) **인가받은 실서비스 1개 또는 공개 bug bounty 리포트 재현** — 외적 타당성 보강.

세 소스를 **같은 타깃에서** 동일 조건으로 수집해야 공정한 비교가 성립한다.

### 7.3 Baseline
- 스캐너 단독(ZAP/Burp active scan, 가능하면 API 특화 도구)
- 사람 단독(캡처된 human 트래픽)
- raw LLM 펜테스트 에이전트(차등 컨텍스트 없음)
- **Ours**(차등-컨텍스트 LLM)

### 7.4 지표 (Metrics)
- **후보 precision / recall / F1** — 하이라이트한 갭 대비 실제 취약점.
- **time-to-verify** — 서버 검증 verdict와 사람이 Evidence를 감사하는 데 걸리는 시간 (Burp raw 대비 단축).
- **차등 lift** — treatment vs control 후보 품질 차이 (가로축).
- **커버리지 gain** — LLM-소스 추가로 인한 커버리지 증가 (세로축).
- **미실행 후보 발견 수** — 검증 전 세 source가 실행하지 않았지만 근거 있는 route/cell 후보에서 확인된 진짜 취약점 개수. 전체 블랙박스 여집합으로 해석하지 않는다.

## 8. 예상 반론 & 대응 (Anticipated Objections)

- **"그냥 LLM 펜테스터 아니냐?"** → 2×2의 가로축이 답. 차등 컨텍스트가 raw-LLM 대비 lift를 만든다는 걸 정량으로 보인다.
- **"그림만 있고 발견은 없다(서술적)."** → C4 + 벤치마크 precision/recall로 "하이라이트한 갭에 실제 취약점 N개"를 증명. 도구는 패시브 유지, 평가만 정답셋 사용.
- **"신규성?"** → 3자 actor 차등을 **구동 표현**으로 쓴 점 + BOLA/BFLA 특화가 차별점. (§10 서베이로 확인 필요.)
- **"순환논리(LLM 소스=분석가)."** → 2×2 세로/가로 분리로 격리.

## 9. 위협 요인 (Threats to Validity)

- **Internal — 데이터 오염:** 공개 벤치마크가 LLM 학습셋에 포함됐을 수 있음 → **변형/커스텀 앱** 또는 비공개 타깃을 최소 1개 포함.
- **Construct — "커버리지 갭 = 취약점"이 성립하나:** 갭과 실제 취약점의 상관을 직접 측정해 가정을 검증.
- **External — 의도적 취약 앱 편향:** deliberately-vulnerable 앱은 실서비스와 다름 → 인가된 실앱/공개 리포트 재현으로 보강.
- **Circularity:** §7.1의 2×2로 격리.

## 10. 관련 연구
현재 확인한 문헌과 근거 강도는 `research.md`가 정본이다. 아래 영역과의 중첩·차별성은 계속 갱신해야 하며, 초록만 확인한 항목을 확정 근거로 사용하지 않는다.
- LLM 기반 펜테스팅/웹 취약점 에이전트
- API 보안 테스팅 · 자동 BOLA/IDOR 탐지 도구 및 연구
- 커버리지-가이드 웹 크롤링/스캐닝, differential testing
- 공격 그래프 / 트래픽 시각화

## 11. 로드맵 (Milestones)
1. **M1 — 정규화 코어:** beta.34 구현, 범용 corpus 정밀도 측정은 미완료.
2. **M2 — 관측 표현:** 매트릭스 + 데이터플로우 그래프 구현, 대규모 실제 데이터 UX·성능 gate는 미완료.
3. **M3 — LLM 실행·분석:** 독립 Explorer, 별도 Judge, exact-run Evidence lock 구현, beta.34 실제 Burp E2E는 미완료.
4. **M4 — 검증 작업면:** Evidence 상세·Request Lab·서버 verdict gate 구현, P1과 실제 전체 재현 gate는 미완료.
5. **M5 — 평가:** 정답 격리 벤치마크 + 2×2 ablation + REVIEW 비용 측정 예정.
6. **M6 — 논문화:** 서베이·threats·재현성 패키지와 실증 결과 반영 예정.

## 부록 A. 용어
- **BOLA (Broken Object Level Authorization)** = **IDOR**. 객체 인가 우회. OWASP API #1.
- **BFLA (Broken Function Level Authorization).** 기능/엔드포인트 인가 우회. OWASP API #3.
- **차등 커버리지(differential coverage).** 여러 트래픽 소스가 채운 셀 집합의 차집합/여집합.
- **오라클(oracle).** 어떤 시도가 취약을 드러냈는지 판정하는 기준(여기선 "금지 요청이 성공했는가").

---
*문서 버전 v2 — beta.34의 관측 가능 범위, exact-run Evidence, Explorer/Judge 분리, bounded projection/input과 미검증 gate를 반영했다. 성능 우위는 블라인드 평가 전까지 주장하지 않는다.*
