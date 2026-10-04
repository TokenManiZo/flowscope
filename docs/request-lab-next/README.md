# Request Lab과 그래프 표시 보완 목업

- [상세 설계](DESIGN.md)
- [상호작용 목업](index.html)
- [Request Lab 기본 창](captures/request-lab-dark.jpg)
- [Request Lab 최대화·JSON 정돈](captures/request-lab-json-light.jpg)
- [검색 결과 간소화](captures/search-compact-dark.jpg)
- [ID → API → OBJ 연결을 유지한 객체 펼침](captures/objects-open-dark.jpg)
- [다른 노드 선택 후 접힘](captures/objects-folded-dark.jpg)

로컬 미리보기는 `http://127.0.0.1:18847/index.html`이다. 서버가 종료되면 이 디렉터리에서 다음 명령으로 다시 연다.

```bash
python3 -m http.server 18847 --bind 127.0.0.1
```

대상은 데스크톱만이다. 목업과 캡처는 모두 합성 데이터를 사용하며 2026-10-04 승인 기준 디자인 산출물이다. 창 최대화, 요청/응답 확대, 분할선, 글자 크기, 인증 상세, 이력, 결과 구분, 객체 집중·접기를 눌러 비교한다. 정돈된 JSON은 고정 예시다. 합성 Raw를 직접 편집하면 JSON 탭은 실제 구현 전임을 안내한다.

제품 구현은 `FEAT/request-lab-ui`에서 진행한다. [구현 기록과 직접 검증 항목](IMPLEMENTATION.md)을 참조한다. 제품 빌드·테스트·Burp·실제 성능 검증은 실행하지 않았다. HTML 목업의 표시만 브라우저에서 확인했으며 제품의 동작 검증 결과를 뜻하지 않는다. 캡처와 HTML은 승인한 목업이며 제품 실행 캡처가 아니다.

객체 펼침은 별도 창 없이 기존 그래프 카드·관계선·묶음 띠를 사용한다. 다른 객체와 겹칠 수 있고, 배경이나 다른 노드를 선택해 밝아질 때 함께 접힌다.

Request Lab은 공통 설정을 상단 제목 영역에 모으고 별도 method/주소 줄을 제거한다. 요청·응답은 긴 내용에도 높이를 유지하며 각 본문 내부에서 스크롤한다.
