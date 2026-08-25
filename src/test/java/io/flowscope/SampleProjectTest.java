package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class SampleProjectTest {
    @Test
    void sampleExercisesThreeSourcesAccountsAndBothAuthorizationFindingTypes() {
        SampleProject.Data sample = SampleProject.create();
        Pipeline.Result result = Pipeline.run(sample.records(), sample.config());

        assertEquals(3, result.analysis.activeSources().size());
        assertEquals(3, sample.config().accounts().size());
        assertEquals("acct-demo-user-a", sample.config()
                .boundAccount("https://demo.flowscope.test:443", "sess:demo-a-rotated").orElseThrow().id());
        assertTrue(result.analysis.findings().stream()
                .anyMatch(finding -> finding.type() == AuthorizationAnalysis.FindingType.BOLA));
        assertTrue(result.analysis.findings().stream()
                .anyMatch(finding -> finding.type() == AuthorizationAnalysis.FindingType.BFLA));
        assertTrue(result.records.stream().allMatch(record -> record.reqText.contains("***MASKED***")));
    }
}
