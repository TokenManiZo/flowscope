package io.flowscope.core.parameter;

import java.util.List;

/** Immutable, raw-free extraction output. */
public record ParameterExtraction(List<ParameterObservation> observations, List<ParameterDiagnostic> diagnostics) {
    /** 의도적 생략: 인증·비밀 이름의 좌표를 만들지 않은 것이며 파싱 실패가 아니다(PR#11 sink 규칙). */
    public static final String SENSITIVE_PARAMETER_OMITTED = "SENSITIVE_PARAMETER_OMITTED";

    public ParameterExtraction {
        observations = List.copyOf(observations);
        diagnostics = List.copyOf(diagnostics);
    }

    /**
     * 요청의 입력을 끝까지 해석했는가. 의도적 생략(SENSITIVE_PARAMETER_OMITTED)만 있는 요청은 완전하다: 나머지 입력은
     * 모두 읽었으므로 다른 좌표의 부재를 증언할 수 있다. 파싱 실패·상한·미지원 형식 진단이 하나라도 있으면 불완전하다(D-160).
     */
    public boolean parsedCompletely() {
        return diagnostics.stream().allMatch(item -> SENSITIVE_PARAMETER_OMITTED.equals(item.reasonCode()));
    }
}
