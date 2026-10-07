package io.flowscope.core.parameter;

import java.util.List;

/** Immutable extraction output. */
public record ParameterExtraction(List<ParameterObservation> observations, List<ParameterDiagnostic> diagnostics) {
    public ParameterExtraction {
        observations = List.copyOf(observations);
        diagnostics = List.copyOf(diagnostics);
    }

    /** 요청의 입력을 끝까지 해석했는가. 파싱 실패·상한·미지원 형식 진단이 하나라도 있으면 불완전하다(D-160). */
    public boolean parsedCompletely() {
        return diagnostics.isEmpty();
    }
}
