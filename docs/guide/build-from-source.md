# 소스 빌드와 데모

## 요약

- 보통은 빌드할 필요가 없습니다. [Releases](https://github.com/TokenManiZo/flowscope/releases)에서 받은 파일을 쓰세요.
- 직접 빌드하려면 JDK 21(22 이상은 안 됩니다)과 Maven 3.9가 필요합니다. `mvn clean verify`를 실행하면 `target/`에 JAR과 bundle zip이 생깁니다. Node.js는 Maven이 알아서 받으므로 따로 설치하지 않아도 되지만, 처음 빌드할 때는 인터넷이 필요합니다.
- 같은 소스로 빌드하면 항상 같은 파일이 나옵니다. 받은 JAR과 직접 만든 JAR의 SHA-256 값을 비교해 볼 수 있습니다.
- Burp 없이 화면만 보고 싶다면 `mvn exec:java`를 실행하세요. 연습용 샘플 데이터로 웹 화면이 열립니다. 이때는 실제 수집, ZAP 스캔, LLM 탐색은 쓸 수 없습니다.

처음 설치한다면 [README](../../README.md)부터 보세요.

## 자세한 내용

### 소스 빌드

소스에서 직접 빌드할 때는 JDK 21과 Maven 3.9.x로 `mvn clean verify`를 실행합니다. JDK 22 이상은 `--release 21`이어도 다른 bytecode를 만들 수 있으므로 빌드가 초기에 거부됩니다. Maven이 고정된 Node.js/npm을 `target/frontend-runtime`에 내려받아 React 테스트·typecheck·고지 생성·Vite 빌드를 수행하므로 시스템 Node.js를 따로 설치할 필요는 없습니다. 최초 빌드는 Maven/npm 의존성을 내려받을 네트워크가 필요합니다. 결과는 Burp용 `target/flowscope-<버전>.jar`와 다운로드용 `target/flowscope-<버전>-bundle.zip`입니다(`<버전>`은 `pom.xml`의 `<version>`). bundle에는 JAR, ZAP Dockerfile/Compose/helper, macOS·Linux·Windows doctor가 들어 있습니다. 빌드는 사용 플러그인 버전을 고정하고 JAR과 bundle의 반복 SHA-256을 CI에서 비교합니다.

### 저장소 구조

- [`src/main`](../../src/main) — Burp 확장, 분석 코어, 로컬 Web 작업면, ZAP 통합, 번들 고지
- [`src/test`](../../src/test) — 보안·파서·분석·저장·ZAP·로컬 Web 결정론적 회귀 테스트
- [`frontend`](../../frontend) — 기본 React 작업면, component test, Vite build와 브라우저 E2E 하네스
- [`infra/zap`](../../infra/zap) — 공식 ZAP 2.17.0 base에 Chromium·ChromeDriver를 더한 FlowScope Dockerfile, Compose와 안전한 시작 스크립트
- [`scripts`](../../scripts) — macOS/Linux Bash와 Windows PowerShell ZAP key 준비·FlowScope Docker 시작/중지·환경 점검 도구
- [`.github`](../../.github) — Maven CI와 의존성 업데이트 설정

빌드 산출물은 `target/`에만 만들어집니다. 사용자가 선택한 로컬 `.flowscope.db`/`.flowscope.json` 프로젝트, 로컬 검토 패키지와 머신별 설정은 Git에서 제외되며 공개 저장소의 일부가 아닙니다.

### Standalone 데모

```bash
mvn exec:java
mvn exec:java -Dexec.args="human.xml scanner.xml llm.xml"
```

Standalone은 패키지 React·로컬 HTTP·프로젝트 저장/재열기·XML 입력을 확인하는 데모 경로입니다. `-Dflowscope.projects.dir=/격리/경로`로 프로젝트 root를 별도 지정할 수 있습니다. Burp Montoya가 없으므로 HUMAN live capture, Request Lab 전송, ZAP 캠페인과 LLM Explorer 실행은 사용할 수 없으며 화면은 이를 명시적 `UNAVAILABLE` 상태로 표시합니다. 실제 점검 실행 검증에는 Burp에 release JAR을 로드해야 합니다.
