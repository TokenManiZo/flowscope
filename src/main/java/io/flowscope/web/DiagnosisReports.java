package io.flowscope.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.LlmFinding;
import io.flowscope.core.RequestRecord;
import io.flowscope.integration.ProjectWorkspace;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

/** Project-local evidence-linked reports. Only metadata, never raw request headers, enters a report. */
final class DiagnosisReports {
    record Report(String id, String title, long createdAt, long datasetRevision, int findingCount,
                  int evidenceCount) { }

    private final FlowScopeWebServer.State state;
    private final ObjectMapper json = new ObjectMapper();

    DiagnosisReports(FlowScopeWebServer.State state) { this.state = state; }

    synchronized Report create(JsonNode args) {
        long dataset = state.datasetRevision();
        ProjectWorkspace.Status project = state.projectStatus();
        reportsDirectory(project, false);
        String title = field(args, "title", 160, true);
        String summary = field(args, "summary", 12_000, true);
        String methodology = field(args, "methodology", 6_000, false);
        String recommendations = field(args, "recommendations", 12_000, false);
        var allFindings = state.findings();
        var selectedFindings = selectFindings(args, allFindings);
        LinkedHashSet<String> evidenceIds = ids(args, "evidence_ids");
        selectedFindings.forEach(finding -> {
            evidenceIds.addAll(finding.evidenceIds());
            evidenceIds.addAll(finding.judgmentEvidenceIds());
        });
        var records = new LinkedHashMap<String, RequestRecord>();
        state.snapshot().records.forEach(record -> records.put(record.evidenceId, record));
        for (String id : evidenceIds)
            if (!records.containsKey(id)) throw new IllegalArgumentException("현재 프로젝트에서 근거를 찾지 못했습니다: " + id);
        String id = "report-" + UUID.randomUUID();
        long at = Instant.now().toEpochMilli();
        Report report = new Report(id, title, at, dataset, selectedFindings.size(), evidenceIds.size());
        String markdown = markdown(report, summary, methodology, recommendations, selectedFindings, evidenceIds, records);
        try {
            byte[] pdf = pdf(markdown);
            ProjectWorkspace.Status current = state.projectStatus();
            if (state.datasetRevision() != dataset || current.active() == null || project.active() == null
                    || !current.directory().equals(project.directory())
                    || !current.active().id().equals(project.active().id()))
                throw new IllegalStateException("프로젝트가 변경됐습니다. 보고서를 다시 생성하세요.");
            Path directory = reportsDirectory(project, true);
            Files.writeString(directory.resolve(id + ".md"), markdown, StandardCharsets.UTF_8);
            Files.write(directory.resolve(id + ".pdf"), pdf);
            Files.write(directory.resolve(id + ".json"), json.writeValueAsBytes(report));
            return report;
        } catch (IOException error) { throw new IllegalStateException("보고서를 저장하지 못했습니다: " + error.getMessage(), error); }
    }

    synchronized List<Report> list() {
        ProjectWorkspace.Status project = state.projectStatus();
        if (project.active() == null || !project.active().managed()) return List.of();
        Path directory = reportsDirectory(false);
        if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) return List.of();
        try (Stream<Path> files = Files.list(directory)) {
            return files.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)
                            && path.getFileName().toString().matches("report-[a-f0-9-]+\\.json"))
                    .map(path -> {
                        try { return json.readValue(Files.readAllBytes(path), Report.class); }
                        catch (IOException error) { return null; }
                    }).filter(java.util.Objects::nonNull)
                    .sorted((a, b) -> Long.compare(b.createdAt(), a.createdAt())).toList();
        } catch (IOException error) { throw new IllegalStateException("보고서 목록을 읽지 못했습니다.", error); }
    }

    synchronized byte[] download(String id, String format) {
        if (id == null || !id.matches("report-[a-f0-9-]{36}")) throw new IllegalArgumentException("잘못된 보고서 ID입니다.");
        if (!"md".equals(format) && !"pdf".equals(format)) throw new IllegalArgumentException("지원하지 않는 보고서 형식입니다.");
        Path file = reportsDirectory(false).resolve(id + "." + format);
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw new IllegalArgumentException("보고서를 찾지 못했습니다.");
        try { return Files.readAllBytes(file); }
        catch (IOException error) { throw new IllegalStateException("보고서를 읽지 못했습니다.", error); }
    }

    private Path reportsDirectory(boolean create) {
        return reportsDirectory(state.projectStatus(), create);
    }

    private Path reportsDirectory(ProjectWorkspace.Status project, boolean create) {
        if (project.active() == null || !project.active().managed())
            throw new IllegalStateException("관리 프로젝트를 열어야 보고서를 저장할 수 있습니다.");
        Path root = Path.of(project.directory()).toAbsolutePath().normalize();
        Path parent = root.resolve(project.active().id()).normalize();
        if (!parent.getParent().equals(root) || !Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS))
            throw new IllegalStateException("프로젝트 디렉터리가 올바르지 않습니다.");
        Path directory = parent.resolve("reports");
        try {
            if (create) Files.createDirectories(directory);
            if (Files.exists(directory, LinkOption.NOFOLLOW_LINKS) && !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS))
                throw new IllegalStateException("보고서 디렉터리가 올바르지 않습니다.");
        } catch (IOException error) { throw new IllegalStateException("보고서 디렉터리를 만들지 못했습니다.", error); }
        return directory;
    }

    private static List<LlmFinding> selectFindings(JsonNode args, List<LlmFinding> all) {
        LinkedHashSet<String> wanted = ids(args, "finding_ids");
        if (wanted.isEmpty()) return List.copyOf(all);
        Map<String, LlmFinding> byId = new LinkedHashMap<>();
        all.forEach(finding -> byId.put(finding.id(), finding));
        List<LlmFinding> selected = new ArrayList<>();
        for (String id : wanted) {
            LlmFinding finding = byId.get(id);
            if (finding == null) throw new IllegalArgumentException("현재 프로젝트에서 소견을 찾지 못했습니다: " + id);
            selected.add(finding);
        }
        return selected;
    }

    private static LinkedHashSet<String> ids(JsonNode args, String key) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        JsonNode values = args == null ? null : args.path(key);
        if (values != null && !values.isMissingNode() && !values.isArray()) throw new IllegalArgumentException(key + " 형식이 올바르지 않습니다.");
        if (values != null && values.isArray()) {
            if (values.size() > 100) throw new IllegalArgumentException(key + "은 최대 100개까지 선택할 수 있습니다.");
            values.forEach(value -> { if (value.isTextual() && !value.asText().isBlank()) result.add(value.asText()); });
        }
        return result;
    }

    private static String field(JsonNode args, String key, int max, boolean required) {
        String value = args == null ? "" : args.path(key).asText("").trim();
        if (required && value.isBlank()) throw new IllegalArgumentException(key + "이(가) 필요합니다.");
        if (value.length() > max) throw new IllegalArgumentException(key + "이(가) 너무 깁니다.");
        return redactSecrets(value);
    }

    private static String redactSecrets(String value) {
        return value.replaceAll("(?im)\\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\\s*:\\s*[^\\r\\n]*", "$1: [REDACTED]")
                .replaceAll("(?i)\\bBearer\\s+[A-Za-z0-9._~+/-]+", "Bearer [REDACTED]")
                .replaceAll("(?i)\\b(access[_-]?token|refresh[_-]?token|id[_-]?token)\\s*[:=]\\s*[\\\"']?[^\\s,\\\"'}]+", "$1=[REDACTED]");
    }

    private static String markdown(Report report, String summary, String methodology, String recommendations,
                                   List<LlmFinding> findings, LinkedHashSet<String> ids,
                                   Map<String, RequestRecord> records) {
        StringBuilder out = new StringBuilder("# ").append(report.title()).append("\n\n")
                .append("생성: ").append(Instant.ofEpochMilli(report.createdAt())).append("  \n")
                .append("프로젝트 근거 버전: ").append(report.datasetRevision()).append("\n\n")
                .append("## 요약\n\n").append(summary).append("\n\n");
        if (!methodology.isBlank()) out.append("## 검증 방법\n\n").append(methodology).append("\n\n");
        out.append("## 소견\n\n");
        if (findings.isEmpty()) out.append("확인된 소견이 없습니다. 아래 근거와 요약을 검토하세요.\n\n");
        for (LlmFinding finding : findings) {
            out.append("### ").append(finding.issueTitle().isBlank() ? finding.operation() : finding.issueTitle()).append("\n\n")
                    .append("- ID: `").append(finding.id()).append("`\n")
                    .append("- API: `").append(finding.operation()).append("`\n")
                    .append("- 계정: ").append(finding.identity()).append("\n")
                    .append("- 판단: ").append(finding.judgment().isBlank() ? "미판정" : finding.judgment()).append("\n")
                    .append("- 근거: ").append(String.join(", ", finding.evidenceIds())).append("\n\n");
            if (!finding.note().isBlank()) out.append(redactSecrets(finding.note())).append("\n\n");
            if (!finding.verificationResult().isBlank()) out.append("검증 결과: ").append(redactSecrets(finding.verificationResult())).append("\n\n");
            if (!finding.judgmentReason().isBlank()) out.append("판단 근거: ").append(redactSecrets(finding.judgmentReason())).append("\n\n");
        }
        out.append("## 인용한 요청·응답 근거\n\n");
        for (String id : ids) {
            RequestRecord record = records.get(id);
            out.append("- `").append(id).append("` · ").append(record.source).append(" · `")
                    .append(record.method).append(" ").append(record.path).append("` · HTTP ")
                    .append(record.status).append(" · 계정 ").append(record.selectedIdentity()).append("\n");
        }
        if (!recommendations.isBlank()) out.append("\n## 권고\n\n").append(recommendations).append("\n");
        out.append("\n원본 요청·응답은 FlowScope 근거 화면에서 ID로 확인하세요.\n");
        return out.toString();
    }

    private static byte[] pdf(String markdown) throws IOException {
        Path fontPath = Stream.of(
                Path.of("C:/Windows/Fonts/NotoSansKR-Regular.ttf"),
                Path.of("C:/Windows/Fonts/malgun.ttf"),
                Path.of("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
                Path.of("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
                Path.of("/Library/Fonts/Arial Unicode.ttf"))
                .filter(Files::isRegularFile).findFirst()
                .orElseThrow(() -> new IOException("한국어 PDF 글꼴을 찾지 못했습니다. Noto Sans KR 글꼴을 설치하세요."));
        try (PDDocument document = new PDDocument()) {
            PDType0Font font = PDType0Font.load(document, fontPath.toFile());
            PDPage page = new PDPage(PDRectangle.A4);
            document.addPage(page);
            PDPageContentStream stream = new PDPageContentStream(document, page);
            float y = 790;
            for (String line : markdown.split("\\R", -1)) {
                float size = line.startsWith("# ") ? 17 : line.startsWith("## ") ? 13 : 10;
                String value = line.replaceFirst("^#{1,3} +", "").replace('`', ' ');
                for (String wrapped : wrap(value, font, size, 515)) {
                    if (y < 48) { stream.close(); page = new PDPage(PDRectangle.A4); document.addPage(page); stream = new PDPageContentStream(document, page); y = 790; }
                    stream.beginText(); stream.setFont(font, size); stream.newLineAtOffset(40, y);
                    stream.showText(wrapped.isEmpty() ? " " : wrapped); stream.endText();
                    y -= size + 5;
                }
                if (line.isBlank()) y -= 3;
            }
            stream.close();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            document.save(out);
            return out.toByteArray();
        }
    }

    private static List<String> wrap(String value, PDType0Font font, float size, float width) throws IOException {
        List<String> lines = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (int point : value.codePoints().toArray()) {
            if (Character.isISOControl(point)) continue;
            String glyph = new String(Character.toChars(point));
            try { font.getStringWidth(glyph); } catch (IllegalArgumentException error) { glyph = "?"; }
            if (!line.isEmpty() && font.getStringWidth(line + glyph) * size / 1000 > width) {
                lines.add(line.toString()); line.setLength(0);
            }
            line.append(glyph);
        }
        lines.add(line.toString());
        return lines;
    }
}
