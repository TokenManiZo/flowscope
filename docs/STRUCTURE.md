# 디렉토리 구조

## 먼저 알아야 할 것

- **진입점은 2개입니다.** `burp/FlowScopeExtension.java`(Burp 확장, 실제 사용 경로)와 `Standalone.java`(Burp 없이 도는 데모).
- **화면은 React이고 JAR 안에 들어갑니다.** `frontend/`를 Vite로 빌드한 결과가 `target/generated-resources/react-web`로 나가 JAR에 포함되고, 실행 시 `127.0.0.1:17777`로 서빙됩니다.
- **처음 읽는 순서**: `burp/FlowScopeExtension.java` → `web/FlowScopeWebServer.java` → `core/`

## 전체 구조

```
flowscope/
├── pom.xml                          빌드 중심 — 버전, shade 재배치, 프런트 빌드 연동, bundle 조립, 재현 빌드
├── README.md                        사용자 매뉴얼 (설치·5분 시작·운영)
├── AGENTS.md                        코드 작성 규율
├── CLAUDE.md                        제품 설계 규칙·용어·금지사항
├── SECURITY.md                      보안 정책
├── LICENSE
│
├── docs/                            팀 문서
│   ├── CONTRIBUTING.md              협업 규약 (브랜치·커밋·PR)
│   ├── STRUCTURE.md                 이 문서
│   └── RELEASE.md                   버전·태그·릴리즈 절차
│
├── .github/
│   ├── workflows/ci.yml             유일한 CI — verify + JAR 구조 검사 + bundle 검사 + 재현 빌드 대조
│   └── dependabot.yml               의존성 자동 갱신
│
├── src/
│   ├── assembly/
│   │   └── distribution.xml         bundle.zip 구성 정의 (JAR + scripts + infra)
│   │
│   ├── main/
│   │   ├── java/io/flowscope/
│   │   │   ├── Standalone.java      진입점 ② — Burp 없이 실행하는 데모 경로
│   │   │   ├── burp/                (6)  진입점 ① — Montoya 확장, HTTP 캡처, in-flight 추적
│   │   │   ├── core/                (48) 분석 엔진 — 인가 분석기·매트릭스, role/account, 판정 오라클
│   │   │   │   ├── discovery/       (13) 선언 표면 발견 — HTML·JS(Closure)·메타데이터 어댑터
│   │   │   │   ├── parameter/       (7)  파라미터 추출·정규화, path slot 정규화
│   │   │   │   └── graph/           (2)  인가 그래프 구성
│   │   │   ├── explorer/            (8)  LLM Explorer — Codex CLI 연동, 계정 vault, 산출물 저장
│   │   │   ├── integration/         (12) SQLite 저장소, loopback HTTP 서버, ZAP 세션/API key
│   │   │   ├── web/                 (3)  로컬 작업면 서버(127.0.0.1:17777), React 자산 서빙
│   │   │   ├── ui/                  (1)  Burp 내부 Swing 탭
│   │   │   └── diag/                (1)  스트레스 진단
│   │   │
│   │   └── resources/
│   │       ├── web/                 정적 자산 (index.html + vendor/) — React 빌드와는 별개
│   │       ├── explorer/            explorer-system.md (Explorer 시스템 프롬프트)
│   │       ├── sample/              human.xml, scanner.xml 샘플 입력
│   │       └── META-INF/            서드파티 라이선스 고지 (CI가 JAR 내 존재 검사)
│   │
│   └── test/
│       ├── java/io/flowscope/       결정론적 회귀 테스트 — main 패키지 구조를 미러링
│       │   └── burp/ core/ explorer/ integration/ ui/ web/
│       └── resources/
│           ├── discovery/
│           └── surface-heldout/     발견 로직 검증용 held-out 샘플
│
├── frontend/                        React 작업 화면 (Vite + TypeScript)
│   ├── vite.config.ts               빌드 출력 → ../target/generated-resources/react-web
│   ├── playwright.config.ts
│   ├── src/
│   │   ├── app/                     App.tsx, AppShell.tsx, routes.ts, AppProviders.tsx
│   │   ├── features/                화면 단위 분할
│   │   │   ├── surface/             기본 화면 — Endpoint·Parameter Surface Delta
│   │   │   ├── parameter-map/
│   │   │   ├── graph/               인가 그래프 (상세층)
│   │   │   ├── matrix/              판정 매트릭스
│   │   │   ├── evidence/
│   │   │   ├── explorer/            LLM Explorer 화면
│   │   │   ├── inspection/          점검 시작·단계 진행
│   │   │   └── runs/ scenarios/ sequence/ accounts/ dashboard/
│   │   ├── components/
│   │   │   ├── layout/              AppSidebar, EvidenceSheet, InspectorPanel 등
│   │   │   └── ui/                  shadcn 프리미티브 (button, dialog, table …)
│   │   ├── lib/
│   │   │   ├── api/                 client.ts, endpoints.ts, types.ts
│   │   │   ├── query/               TanStack Query 설정·훅
│   │   │   └── security/            datasetBoundary, memoryOnlyRawState (원본 응답 격리)
│   │   ├── hooks/
│   │   └── test/                    Vitest setup, fixtures, render 헬퍼
│   ├── e2e/                         Playwright — parameter-map.spec.ts, parity.spec.ts
│   └── scripts/                     빌드 보조 — 고지 생성, 증분 패키징, e2e 서버
│
├── scripts/                         사용자용 헬퍼 (.sh / .ps1 쌍 = macOS·Linux·Windows)
│   ├── doctor.sh / .ps1             환경 진단 (human·zap·explorer·full)
│   ├── zap-up.sh / .ps1             ZAP 컨테이너 기동
│   ├── zap-down.sh / .ps1
│   └── zap-key.sh / .ps1            ZAP API key
│
├── infra/
│   └── zap/                         Dockerfile (Chromium+ChromeDriver), compose.yaml, start-zap.sh
│
└── target/                          빌드 산출물 (gitignore)
    ├── flowscope-<ver>.jar          Burp 로드용 fat JAR
    ├── flowscope-<ver>-bundle.zip   배포 bundle
    └── generated-resources/react-web/   Vite 빌드 결과 → JAR에 포함
```

괄호 안 숫자는 해당 패키지의 `.java` 파일 수입니다.

## 어디를 고쳐야 하나

| 하려는 일 | 볼 곳 |
|---|---|
| 분석·판정 로직 변경 | `src/main/java/io/flowscope/core/` |
| 화면 추가·수정 | `frontend/src/features/` |
| 화면 ↔ 백엔드 API | `web/` (서버) ↔ `frontend/src/lib/api/` (클라이언트) |
| Burp 연동 | `burp/`, `ui/` |
| ZAP 연동 | `integration/`, `infra/zap/`, `scripts/zap-*` |
| 저장 구조 | `integration/` (SqliteProjectStore 등) |
| 배포에 파일 추가 | `src/assembly/distribution.xml` + `ci.yml`의 bundle 검사 |
