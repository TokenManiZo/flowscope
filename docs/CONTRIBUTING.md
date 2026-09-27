# 협업 규약

팀원이 FlowScope에 변경을 넣는 절차입니다.

- 코드 작성 규율(단순성·최소 변경·검증)은 [AGENTS.md](../AGENTS.md)
- 제품 설계 규칙과 용어는 [CLAUDE.md](../CLAUDE.md)
- 디렉토리 구조는 [STRUCTURE.md](STRUCTURE.md) · 릴리즈는 [RELEASE.md](RELEASE.md)

**적용 시점**: 이 문서가 추가된 커밋 이후부터. 그 이전 이력은 다른 규칙(`feat:`, `fix:`)으로 작성됐고 소급 적용하지 않습니다.

## 타입 5종

모든 규칙은 같은 5개 타입을 씁니다.

| 타입 | 쓰는 경우 |
|---|---|
| `FEAT` | 새 기능, 동작 추가 |
| `FIX` | 버그 수정 |
| `REFACT` | 동작 변경 없는 구조 개선 |
| `DOCS` | 문서만 변경 |
| `CHORE` | 빌드·의존성·설정 |

## 1. 이슈에서 브랜치 생성

1. **이슈를 먼저 만듭니다.** 제목은 `[FEAT] : 요약` 형식.
   - 예: `[FEAT] : ZAP 캠페인 시작 전 리스너 점검`
   - 예: `[FIX] : 판정 매트릭스 셀이 빈 화면으로 뜨는 문제`
2. 이슈 우측 **Development → Create a branch**를 누릅니다.
3. **자동 제안된 이름을 반드시 고칩니다.** GitHub은 `12-feat-zap-...`처럼 제안하지만, 우리 규칙은 `FEAT_zap_listener_check`입니다. 이 단계를 건너뛰면 규약이 깨집니다.

이슈에서 만들어야 브랜치와 이슈가 자동으로 연결됩니다. 이슈 없이 만든 브랜치는 PR 본문에 `Closes #번호`를 직접 적습니다.

## 2. 브랜치 이름

`타입_요약` — 타입은 대문자, 구분은 언더바.

```
FEAT_surface_delta
FIX_zap_listener
REFACT_clean_repo
DOCS_team_guide
CHORE_bump_jackson
```

- 요약은 소문자·숫자·언더바만 씁니다. 한글과 공백은 쓰지 않습니다.
- **예외**: `main`, 그리고 봇이 만드는 `dependabot/**`는 이 규칙을 적용하지 않습니다.

## 3. 커밋 메시지

`(타입) : 요약`

```
(FEAT) : ZAP 캠페인 시작 전 Burp SCANNER 리스너 점검
(FIX) : 판정 매트릭스 셀의 빈 렌더링 수정
(DOCS) : 팀 협업 규약과 디렉토리 구조 문서 추가
```

- 괄호와 콜론 사이 공백을 지킵니다: `(FEAT) : ` (O) / `(FEAT): ` (X)
- 한 커밋은 한 가지 목적만 담습니다.
- 중요한 변경은 본문에 **이유 · 영향 범위 · 실제 수행한 검증 · 남은 한계**를 적습니다(CLAUDE.md 변경 기록 규칙).
- Claude로 작성한 커밋은 `Co-Authored-By` 줄을 남깁니다.

## 4. Pull Request

- **`main`에 직접 푸시하지 않습니다.** 모든 변경은 PR로 들어갑니다.
- PR 제목은 `[타입] : 요약` (이슈 제목과 같은 형식).
- 본문에 무엇을·왜·어떻게 검증했는지와 연결 이슈(`Closes #12`)를 적습니다.
- **머지 조건**: CI 3개 job 전부 초록 + 리뷰어 1명 이상 승인.
- 머지 후 브랜치를 삭제합니다.

## 5. 올리기 전 로컬 검증

```bash
mvn clean verify
```

- **JDK 21 정확히**, Maven 3.9.x가 필요합니다. JDK 22 이상은 빌드가 거부됩니다.
- Node.js는 Maven이 직접 내려받으므로 따로 설치하지 않습니다.

CI([ci.yml](../.github/workflows/ci.yml))가 검사하는 것:

| Job | 내용 |
|---|---|
| `verify` | `mvn clean verify` + 릴리즈 JAR 내부 구조 + bundle 구성 + 재현 빌드 SHA 대조 |
| `shell-scripts` | `scripts/*.sh`, `infra/zap/start-zap.sh` shellcheck |
| `windows-scripts` | `scripts/*.ps1` PowerShell 파싱 |

## 6. 커밋하면 안 되는 것

`.env` · `*.key` · `*.pem` · `*.flowscope.db` · `target/` · `node_modules/`

[.gitignore](../.gitignore)에 이미 포함돼 있습니다. 실제 점검 대상의 트래픽·자격증명이 저장소에 들어가지 않도록 `git status`를 커밋 전에 확인합니다.
