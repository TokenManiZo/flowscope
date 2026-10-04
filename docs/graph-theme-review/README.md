# 그래프 테마 검토

- [상호작용 목업](index.html)
- [승인한 방향·구현·검증 인계](DESIGN.md)

라이트/다크 × 접힘/펼침을 같은 합성 좌표로 비교한다. 데스크톱 1280/1920px 대상. 승인한 표현을 제품 UI에 반영했다. 서버 저장 형식·검증은 유지하며 렌더러 zoom 범위를 기존 40~200%로 제한했다. 목업과 캡처는 합성 예시이며 제품 빌드·테스트·실제 Burp 검증 결과가 아니다.

로컬 열기:

```sh
python3 -m http.server 18848 --bind 127.0.0.1 --directory docs/graph-theme-review
```

`http://127.0.0.1:18848/index.html?theme=light`에서 비교한다. 저장 오류 배너는 토글로 볼 수 있으며, 실제 저장 오류가 해결됐다는 의미가 아니다.

목업 캡처: [라이트 1280px](captures/light-expanded-1280.png), [다크 1920px](captures/dark-expanded-1920.png). 합성 예시이며 제품 실행 캡처가 아니다.
