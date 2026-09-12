package io.flowscope.benchmark;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthorizationBenchmarkTest {

    @Test
    void currentAuthorizationMatrixProducesALabeledBaselineReport() {
        AuthorizationBenchmark.Report report = AuthorizationBenchmark.currentBaseline();
        System.out.println(report.render());

        assertEquals(6, report.k());
        assertEquals(6, report.expected());
        assertEquals(6, report.actual());
        assertEquals(0, report.hardenedFindings(), "하드닝 대조군에서 정본 finding이 나오면 안 된다");
        assertEquals(0, report.hardenedSignals(), "하드닝 대조군에서 후보나 추천이 나오면 안 된다");
        assertEquals(6, report.truePositives());
        assertEquals(0, report.falsePositives());
        assertEquals(0, report.falseNegatives());
        assertEquals(new AuthorizationBenchmark.LevelScore(3, 3, 3, 0, 0), report.candidates());
        assertEquals(new AuthorizationBenchmark.LevelScore(3, 3, 3, 0, 0), report.recommendations());
        assertEquals(1.0, report.precisionAtK(), 0.0001);
        assertEquals(1.0, report.recall(), 0.0001);
        assertTrue(report.falseNegativeLabels().isEmpty());
        assertTrue(report.falsePositiveSignals().stream().noneMatch(signal ->
                signal.coordinate().scenarioId().equals("stage3-public-suppression-miss")
                        && signal.coordinate().identity().equals("user-b")
                        && signal.level() == AuthorizationBenchmark.SignalLevel.CANDIDATE));
        assertTrue(report.scenarios().stream()
                        .filter(scenario -> scenario.scenarioId().equals("stage2-collection-membership-miss"))
                        .flatMap(scenario -> scenario.signals().stream())
                        .anyMatch(signal -> signal.coordinate().identity().equals("user-b")
                                && signal.level() == AuthorizationBenchmark.SignalLevel.CANDIDATE),
                "컬렉션 멤버십 O2의 타 신원 ID 일치 응답은 정본 BOLA 후보가 되어야 한다");
        assertTrue(report.scenarios().stream()
                        .filter(scenario -> scenario.scenarioId().equals("stage4-distribution-miss"))
                        .flatMap(scenario -> scenario.signals().stream())
                        .anyMatch(signal -> signal.coordinate().identity().equals("user-b")
                                && signal.level() == AuthorizationBenchmark.SignalLevel.RECOMMENDATION),
                "대상 신원을 제외한 Admin 성공·User 차단 분포는 user-b의 P2 정책 확인 추천이 되어야 한다");
        assertTrue(report.scenarios().stream()
                        .filter(scenario -> scenario.scenarioId().equals("stage2-collection-membership-miss"))
                        .flatMap(scenario -> scenario.signals().stream())
                        .noneMatch(signal -> signal.coordinate().identity().equals("user-a")),
                "O2 소유자 자신은 자기 객체 교차테스트 대상으로 추천되지 않아야 한다");
        // Stage 1(D-166): 확정 소유자 자신은 자기 객체 교차테스트 대상으로 추천되지 않는다.
        assertTrue(report.falsePositiveSignals().stream().noneMatch(signal ->
                signal.level() == AuthorizationBenchmark.SignalLevel.RECOMMENDATION
                        && signal.coordinate().identity().equals("user-a")
                        && (signal.coordinate().scenarioId().equals("bola-explicit-owner-candidate")
                        || signal.coordinate().scenarioId().equals("stage3-public-suppression-miss"))),
                "확정 소유자(O3)는 자기 객체 교차테스트 대상으로 추천되지 않아야 한다(D-166)");
    }
}
