package io.flowscope.core;

import java.util.Locale;

/**
 * 한 건의 요청/응답 관측 (설계서 §3). L0 에서는 그래프 구성에 필요한 필드만 채운다.
 * op/resource/idn 은 정규화(Normalizer) 후 채워진다.
 */
public final class RequestRecord {
    public final Source source;
    /** 타깃 서비스: scheme://host:port. 서로 다른 시스템이 합쳐지지 않게 모델에 보존한다(스코프 정의와 동일 축). */
    public final String service;
    public final String method;
    public final String path;     // 쿼리 분리된 경로
    public final int status;
    public final String fp;       // 인증 지문(해시·sub 등 변환값. 원문 토큰 저장 금지 — F-05)

    // 출처 세분류 — 실제 생성자(source)와 지시자(orchestrator)를 섞지 않는다.
    public SourceDetail sourceDetail = SourceDetail.UNKNOWN;
    public Orchestrator orchestrator = Orchestrator.UNKNOWN;
    public ToolKind tool = ToolKind.UNKNOWN;
    public RunPhase phase = RunPhase.UNKNOWN;
    public ExecutionTrust executionTrust = ExecutionTrust.UNKNOWN;
    public String runId = "default";
    public String evidenceId;     // 관측을 역참조하는 안정 ID(Pipeline 이 부여하고 프로젝트 파일에 보존)
    public String contentDigest;  // 응답·출처까지 포함한 관측 내용 SHA-256. 변경 감지용

    // 요청 상세 — 명세가 입력으로 요구하는 것들
    //  F-06(객체 분석): 경로 + Query + 요청 Body
    //  F-09(Flow): 요청·응답의 ID/토큰 → 데이터 의존성
    //  F-18/19(재전송): 원본 Request  ·  F-22(상세): 요청/응답 상세
    public String query;          // 쿼리스트링(? 뒤). 없으면 null
    public String reqBody;        // 요청 본문(마스킹). 없으면 null
    public String reqText;        // 원본 요청 전문(인증 헤더 마스킹). 재전송·상세용
    public long timestamp;        // 관측 시각(epoch ms). 0 이면 미상 — F-09 순서 판단용

    // 응답 (수집단이 채움) — F-10 판정·F-22 상세·F-02 후보 분리용
    public String body;           // 응답 본문(마스킹). 없으면 null
    public String respText;       // 응답 전문(인증/비밀 필드 마스킹). 상세·리다이렉트 판정용
    public String location;       // 리다이렉트 Location. 없으면 null
    public boolean hasResponse;   // 실제 응답 관측 여부. false면 관측 아닌 '후보'(F-02)

    // 정규화 산출물 (Normalizer 가 채움)
    public String op;             // 예: "GET /api/orders/{id}"
    public String resource;       // 예: "orders:101" 또는 "orders:101/items:5" (객체 없으면 null)
    public String idn;            // 예: "user-a" 또는 "anon"(비인증)
    public AccessRole role = AccessRole.UNKNOWN; // 사용자 지정값. 자동 권한 추정 금지(D-018)

    public RequestRecord(Source source, String service, String method, String path, int status, String fp) {
        this.source = source;
        this.service = (service == null || service.isBlank()) ? "unknown-service" : service;
        this.method = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
        this.path = (path == null || path.isBlank()) ? "/" : path;
        this.status = status;
        this.fp = (fp == null || fp.isBlank()) ? "anon" : fp;
    }

    @Override
    public String toString() {
        return "[" + source + "] " + idn + " " + service + " " + op + " -> " + resource + " (" + status + ")";
    }
}
