# 릴리즈 절차

## 지금 쓰는 표준

| 항목 | 채택한 표준 | 근거 |
|---|---|---|
| 버전 체계 | [Semantic Versioning 2.0.0](https://semver.org/lang/ko/) | 현재 `1.2.0-beta.49`가 이미 SemVer의 prerelease 형식 |
| 태그 이름 | `v` + 버전 (`v1.2.0-beta.49`) | 기존 릴리즈 9건이 전부 이 형식 |
| 태그 종류 | annotated 태그 (`git tag -a`) | 작성자·날짜·메시지가 남음. lightweight는 쓰지 않음 |
| 변경 이력 | **[`docs/releases/`](releases/README.md)** 의 버전별 문서 | 레포 안에 있어 PR로 리뷰하고 스크린샷을 함께 버전 관리함. GitHub Release 노트에는 요약과 링크만 둬서 내용이 두 곳으로 갈라지지 않게 함 |
| 무결성 | `SHA256SUMS.txt` 동봉 | 기존 릴리즈가 이미 첨부 중 |
| 배포 방식 | 수동 (로컬 빌드 → 업로드) | 현재 CI에 릴리즈 자동화가 없음 |

**릴리즈 자동화는 아직 없습니다.** `ci.yml`은 `contents: read` 권한으로 검증만 하고 산출물을 남기지 않습니다. 대신 CI가 **재현 빌드**(같은 커밋을 두 번 빌드해 SHA-256 일치 확인)를 강제하므로, 누가 빌드해도 동일한 JAR이 나옵니다. 실제로 beta.49 릴리즈 JAR과 로컬 빌드 JAR의 SHA-256이 일치함을 확인했습니다.

## 절차

### 1. 버전 올리기

[pom.xml](../pom.xml) 9번째 줄의 `<version>`을 수정하고 커밋합니다.

```
(CHORE) : 버전을 1.2.0-beta.50으로 상향
```

- prerelease는 `1.2.0-beta.N`의 N만 올립니다.
- 정식 배포 시 `1.2.0`으로 떼어냅니다.
- 같은 커밋에서 변경 기록을 확정합니다. [`docs/releases/unreleased.md`](releases/unreleased.md)를 `v<ver>.md`로, `images/unreleased/`를 `images/v<ver>/`로 이름을 바꾸고 날짜를 적은 뒤 빈 `unreleased.md`를 새로 만들고 [목록](releases/README.md)에 한 줄 추가합니다.

### 2. 빌드·검증

```bash
mvn clean verify
cd target && shasum -a 256 flowscope-*.jar flowscope-*-bundle.zip > SHA256SUMS.txt
```

JDK 21 정확히, Maven 3.9.x가 필요합니다.

### 3. 태그

`main`에 머지된 커밋에만 태그를 답니다.

```bash
git tag -a v1.2.0-beta.50 -m "FlowScope v1.2.0-beta.50 — 한 줄 요약"
git push origin v1.2.0-beta.50
```

### 4. Release 생성

GitHub **Releases → Draft a new release**에서 그 태그를 선택하고, **prerelease** 체크 후 3개 자산을 올립니다.

- `flowscope-<ver>.jar`
- `flowscope-<ver>-bundle.zip`
- `SHA256SUMS.txt`

노트에는 세 줄 요약과 `docs/releases/v<ver>.md` 링크만 적습니다. 자세한 변경·스크린샷·업그레이드 주의는 그 문서에 있습니다.

`gh` CLI를 설치했다면 4단계는 한 줄로 끝납니다.

```bash
gh release create v1.2.0-beta.N --prerelease \
  --notes "요약 세 줄. 자세한 변경: docs/releases/v1.2.0-beta.N.md" \
  target/flowscope-*.jar target/flowscope-*-bundle.zip target/SHA256SUMS.txt
```

README에는 버전 번호를 적지 않으므로 릴리스 때 고칠 필요가 없습니다.

## 규칙 3가지

1. **태그와 pom 버전은 항상 1:1.** 같은 버전으로 두 번 배포하지 않습니다.
2. **푸시된 태그는 옮기지 않습니다.** 잘못됐으면 다음 버전을 냅니다.
3. **태그는 `main`에만.** 작업 브랜치에 달지 않습니다.

## 현재 상태 (2026-10-03)

- 팀 저장소에 `v1.2.0-beta.50` 태그가 있습니다(2026-09-30, `0f483ae`). 그 커밋의 `pom.xml`은 `1.2.0-beta.49`이고 `main`에 없는 커밋이라 규칙 1·3과 맞지 않습니다. 규칙 2에 따라 태그는 옮기지 않습니다.
- QA_TEMP의 `pom.xml`은 `1.2.0-beta.50`이지만 그 태그 뒤 변경이 더 들어가 있습니다. **다음 배포 전에 `1.2.0-beta.51`로 올려야** 같은 버전에 다른 내용이 나가는 것을 막습니다.
- beta.49 이전 릴리즈 자산은 원본 저장소 [`choewonwoo1817/testflowscope`](https://github.com/choewonwoo1817/testflowscope/releases)에 있습니다.
