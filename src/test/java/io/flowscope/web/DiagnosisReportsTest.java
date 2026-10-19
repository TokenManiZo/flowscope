package io.flowscope.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.LlmFinding;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.integration.ProjectWorkspace;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class DiagnosisReportsTest {
    @TempDir Path root;
    private final ObjectMapper json = new ObjectMapper();

    @Test void createsEvidenceLinkedMarkdownAndKoreanPdfInTheActiveProject() throws Exception {
        Path directory = Files.createDirectory(root.resolve("project-one"));
        Files.writeString(directory.resolve(ProjectWorkspace.DATABASE_NAME), "database");
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://api.test:443", "GET", "/vehicles/42", 200, "anon");
        record.reqText = "GET /vehicles/42 HTTP/1.1\r\nAuthorization: Bearer private-token\r\nCookie: sid=hidden-cookie-value\r\n\r\n";
        Pipeline.Result snapshot = Pipeline.run(List.of(record));
        String evidenceId = snapshot.records.getFirst().evidenceId;
        LlmFinding finding = new LlmFinding("finding-1", "GET /vehicles/{id}", "user-a", "vehicle:42",
                "candidate", "high", "다른 계정의 차량 정보가 반환됨", List.of(evidenceId), 1L)
                .withJudgment("vulnerable", "계정 간 응답 비교", "HTTP 200", "소유자 불일치",
                        "차량 정보 노출", List.of(evidenceId), 2L);
        FlowScopeWebServer.State state = (FlowScopeWebServer.State) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[]{FlowScopeWebServer.State.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "datasetRevision" -> 3L;
                    case "snapshot" -> snapshot;
                    case "findings" -> List.of(finding);
                    case "projectStatus" -> new ProjectWorkspace.Status(root.toString(),
                            new ProjectWorkspace.Entry("project-one", "테스트", List.of("https://api.test:443/"),
                                    "", 0L, 0L, true, true, true, ""), List.of());
                    default -> throw new UnsupportedOperationException(method.getName());
                });
        DiagnosisReports reports = new DiagnosisReports(state);
        var input = json.valueToTree(Map.of("title", "차량 권한 검증 보고서", "summary", "수집 근거를 비교했습니다. private-token과 hidden-cookie-value는 제외\nAuthorization: Bearer summary-secret",
                "finding_ids", List.of("finding-1"), "evidence_ids", List.of(evidenceId),
                "recommendations", "서버에서 소유자를 검증하세요."));
        DiagnosisReports.Report saved = reports.create(input);
        assertEquals(1, saved.findingCount());
        assertEquals(1, saved.evidenceCount());
        assertEquals(saved.id(), reports.list().getFirst().id());
        String markdown = new String(reports.download(saved.id(), "md"), StandardCharsets.UTF_8);
        assertTrue(markdown.contains("차량 권한 검증 보고서"));
        assertTrue(markdown.contains(evidenceId));
        assertFalse(markdown.contains("private-token"));
        assertFalse(markdown.contains("summary-secret"));
        assertFalse(markdown.contains("hidden-cookie-value"));
        assertTrue(markdown.contains("Authorization: [REDACTED]"));
        byte[] pdf = reports.download(saved.id(), "pdf");
        assertEquals("%PDF", new String(pdf, 0, 4, StandardCharsets.US_ASCII));
        try (var document = Loader.loadPDF(pdf)) {
            assertTrue(document.getNumberOfPages() >= 1);
            String pdfText = new PDFTextStripper().getText(document);
            assertTrue(pdfText.contains("차량 권한 검증 보고서"));
            assertFalse(pdfText.contains("private-token"));
            assertFalse(pdfText.contains("hidden-cookie-value"));
            assertFalse(pdfText.contains("summary-secret"));
        }
        assertThrows(IllegalArgumentException.class, () -> reports.download("../../project-one", "md"));
        assertThrows(IllegalArgumentException.class, () -> reports.create(json.valueToTree(Map.of(
                "title", "잘못된 근거", "summary", "요약", "evidence_ids", List.of("missing")))));
    }
}
