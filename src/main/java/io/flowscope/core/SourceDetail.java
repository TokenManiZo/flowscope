package io.flowscope.core;

/** 요청을 만든 구체적인 실행 경로. source 의 하위 분류다. */
public enum SourceDetail {
    BROWSER(Source.HUMAN, "브라우저"),
    BURP_REPEATER(Source.HUMAN, "Burp Repeater"),
    BURP_INTRUDER(Source.HUMAN, "Burp Intruder"),
    MANUAL_HTTP(Source.HUMAN, "수동 HTTP"),
    ZAP_SPIDER(Source.SCANNER, "ZAP Spider"),
    ZAP_API_IMPORT(Source.SCANNER, "ZAP API 정의 가져오기"),
    ZAP_AJAX_SPIDER(Source.SCANNER, "ZAP AJAX Spider"),
    ZAP_CLIENT_SPIDER(Source.SCANNER, "ZAP Client Spider"),
    ZAP_PASSIVE_SCAN(Source.SCANNER, "ZAP Passive Scan"),
    ZAP_ACTIVE_SCAN(Source.SCANNER, "ZAP Active Scan"),
    OTHER_SCANNER(Source.SCANNER, "기타 스캐너"),
    LLM_EXPLORER(Source.LLM, "LLM Explorer"),
    LLM_COACH_PROBE(Source.LLM, "LLM Judge Probe"),
    LLM_VALIDATION(Source.LLM, "LLM Validation"),
    XML_IMPORT(null, "XML 가져오기"),
    HAR_IMPORT(Source.SCANNER, "ZAP HAR 가져오기"),
    UNKNOWN(null, "미상");

    private final Source source;
    private final String label;

    SourceDetail(Source source, String label) {
        this.source = source;
        this.label = label;
    }

    public Source source() { return source; }
    public String label() { return label; }
    public boolean belongsTo(Source value) { return source == null || source == value; }
}
