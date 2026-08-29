package io.flowscope.core;

import java.util.Locale;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 한 건의 요청/응답 관측 (설계서 §3). L0 에서는 그래프 구성에 필요한 필드만 채운다.
 * op/resource/idn 은 정규화(Normalizer) 후 채워진다.
 */
public final class RequestRecord {
    private static final AtomicLong NEXT_RUNTIME_ID = new AtomicLong();
    private final long runtimeId;
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
    public AuthState authState = AuthState.UNRESOLVED;
    public TrafficClassification trafficClassification = TrafficClassification.unresolved("NOT_CLASSIFIED");

    // 비밀이 아닌 HTTP 문맥 메타데이터. 문자열 전문을 재파싱하지 않고 분류 근거로 쓴다.
    public String requestContentType;
    public String responseContentType;
    public String secFetchDest;
    public String secFetchMode;
    public String accessControlRequestMethod;

    // 요청 상세 — 명세가 입력으로 요구하는 것들
    //  F-06(객체 분석): 경로 + Query + 요청 Body
    //  F-09(Flow): 요청·응답의 ID/토큰 → 데이터 의존성
    //  F-18/19(재전송): 원본 Request  ·  F-22(상세): 요청/응답 상세
    public String query;          // 쿼리스트링(? 뒤). 없으면 null
    public String reqBody;        // 요청 본문(마스킹). 없으면 null
    public String reqText;        // 원본 요청 전문(인증 헤더 마스킹). 재전송·상세용
    public StoredPayload requestPayload; // 마스킹된 전체 요청. reqText는 UI용 preview다.
    public long timestamp;        // 관측 시각(epoch ms). 0 이면 미상 — F-09 순서 판단용

    // 응답 (수집단이 채움) — F-10 판정·F-22 상세·F-02 후보 분리용
    public String body;           // 응답 본문(마스킹). 없으면 null
    public String respText;       // 응답 전문(인증/비밀 필드 마스킹). 상세·리다이렉트 판정용
    public StoredPayload responsePayload; // 마스킹된 전체 응답. respText는 UI용 preview다.
    public String location;       // 리다이렉트 Location. 없으면 null
    public boolean hasResponse;   // 실제 응답 관측 여부. false면 관측 아닌 '후보'(F-02)

    // 정규화 산출물 (Normalizer 가 채움)
    public String op;             // 예: "GET /api/orders/{id}"
    public String resource;       // 예: "orders:101" 또는 "orders:101/items:5" (객체 없으면 null)
    public List<ResourceReference> resourceReferences = List.of();
    public PathTemplateStatus pathTemplateStatus = PathTemplateStatus.LITERAL;
    public List<String> pathTemplateReasons = List.of();
    public String idn;            // 예: "user-a", "anon"(비인증), "unresolved-*"(지문 추출 실패)
    public AccessRole role = AccessRole.UNKNOWN; // 사용자 지정값. 자동 권한 추정 금지(D-018)

    public RequestRecord(Source source, String service, String method, String path, int status, String fp) {
        this(source, service, method, path, status, fp, NEXT_RUNTIME_ID.incrementAndGet());
    }

    private RequestRecord(Source source, String service, String method, String path,
                          int status, String fp, long runtimeId) {
        this.source = source;
        this.service = (service == null || service.isBlank()) ? "unknown-service" : service;
        this.method = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
        this.path = (path == null || path.isBlank()) ? "/" : path;
        this.status = status;
        this.fp = (fp == null || fp.isBlank()) ? Fingerprints.UNRESOLVED : fp;
        this.runtimeId = runtimeId;
    }

    /** 분석기는 수집 레코드를 직접 변형하지 않고 이 얕은 불변값 복사본에 산출물을 기록한다. */
    public RequestRecord analysisCopy() {
        RequestRecord copy = new RequestRecord(source, service, method, path, status, fp, runtimeId);
        copy.sourceDetail = sourceDetail;
        copy.orchestrator = orchestrator;
        copy.tool = tool;
        copy.phase = phase;
        copy.executionTrust = executionTrust;
        copy.runId = runId;
        copy.evidenceId = evidenceId;
        copy.contentDigest = contentDigest;
        copy.authState = authState;
        copy.trafficClassification = trafficClassification;
        copy.requestContentType = requestContentType;
        copy.responseContentType = responseContentType;
        copy.secFetchDest = secFetchDest;
        copy.secFetchMode = secFetchMode;
        copy.accessControlRequestMethod = accessControlRequestMethod;
        copy.query = query;
        copy.reqBody = reqBody;
        copy.reqText = reqText;
        copy.requestPayload = requestPayload;
        copy.timestamp = timestamp;
        copy.body = body;
        copy.respText = respText;
        copy.responsePayload = responsePayload;
        copy.location = location;
        copy.hasResponse = hasResponse;
        copy.op = op;
        copy.resource = resource;
        copy.resourceReferences = List.copyOf(resourceReferences);
        copy.pathTemplateStatus = pathTemplateStatus;
        copy.pathTemplateReasons = List.copyOf(pathTemplateReasons);
        copy.idn = idn;
        copy.role = role;
        return copy;
    }

    public long runtimeId() { return runtimeId; }

    public String requestTextForEvidence() {
        String retained = requestPayload == null ? null : requestPayload.text();
        return retained == null ? reqText : retained;
    }

    public String responseTextForEvidence() {
        String retained = responsePayload == null ? null : responsePayload.text();
        return retained == null ? respText : retained;
    }

    public String requestBodyForAnalysis() {
        String fromMessage = messageBody(requestTextForEvidence());
        return fromMessage == null ? reqBody : fromMessage;
    }

    public String responseBodyForAnalysis() {
        String fromMessage = messageBody(responseTextForEvidence());
        return fromMessage == null ? body : fromMessage;
    }

    private static String messageBody(String message) {
        if (message == null) return null;
        int crlf = message.indexOf("\r\n\r\n");
        int lf = message.indexOf("\n\n");
        int separator;
        int length;
        if (crlf < 0 || (lf >= 0 && lf < crlf)) { separator = lf; length = 2; }
        else { separator = crlf; length = 4; }
        return separator < 0 ? null : message.substring(separator + length);
    }

    @Override
    public String toString() {
        return "[" + source + "] " + idn + " " + service + " " + op + " -> " + resource + " (" + status + ")";
    }
}
