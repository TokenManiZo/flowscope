# 릴리즈 절차

버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따르고, 태그는 `v<버전>` 형식의 annotated 태그를 사용합니다. 변경 기록은 [버전별 문서](releases/README.md)에 정리합니다.

배포는 로컬 빌드 후 수동으로 진행합니다. CI는 빌드·테스트, JAR·bundle 구성, 같은 커밋의 반복 빌드 SHA-256 일치를 검사합니다. 이 검사는 실제 Burp 실행 검증과 별개입니다.

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
