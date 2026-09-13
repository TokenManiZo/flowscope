# 릴리즈 절차

## 지금 쓰는 표준

| 항목 | 채택한 표준 | 근거 |
|---|---|---|
| 버전 체계 | [Semantic Versioning 2.0.0](https://semver.org/lang/ko/) | 현재 `1.2.0-beta.49`가 이미 SemVer의 prerelease 형식 |
| 태그 이름 | `v` + 버전 (`v1.2.0-beta.49`) | 기존 릴리즈 9건이 전부 이 형식 |
| 태그 종류 | annotated 태그 (`git tag -a`) | 작성자·날짜·메시지가 남음. lightweight는 쓰지 않음 |
| 변경 이력 | **GitHub Release 노트** | 별도 `CHANGELOG.md`를 두지 않음. 이력이 두 곳으로 갈라지면 반드시 어긋남 |
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

노트에는 무엇이 바뀌었는지와 알려진 한계를 적습니다. 이게 변경 이력 역할을 합니다.

`gh` CLI를 설치했다면 4단계는 한 줄로 끝납니다.

```bash
gh release create v1.2.0-beta.50 --prerelease \
  target/flowscope-*.jar target/flowscope-*-bundle.zip target/SHA256SUMS.txt
```

### 5. 문서 갱신

[README.md](../README.md)의 다운로드 안내에 적힌 버전을 새 버전으로 고칩니다.

## 규칙 3가지

1. **태그와 pom 버전은 항상 1:1.** 같은 버전으로 두 번 배포하지 않습니다.
2. **푸시된 태그는 옮기지 않습니다.** 잘못됐으면 다음 버전을 냅니다.
3. **태그는 `main`에만.** 작업 브랜치에 달지 않습니다.

## 현재 상태 (2026-09-13)

- 최신 릴리즈는 `v1.2.0-beta.49` (prerelease).
- `pom.xml`은 아직 `1.2.0-beta.49`이지만, 이후 문서 제거 커밋으로 bundle 내용이 릴리즈와 달라졌습니다(JAR은 동일). **다음 배포 전에 반드시 버전을 올려야** 같은 버전에 다른 내용이 나가는 것을 막습니다.
- 릴리즈 자산은 원본 저장소 [`choewonwoo1817/testflowscope`](https://github.com/choewonwoo1817/testflowscope/releases)에 있고, 현재 팀 저장소에는 태그·릴리즈가 없습니다. 다음 배포부터 팀 저장소로 옮길지 결정이 필요합니다.
