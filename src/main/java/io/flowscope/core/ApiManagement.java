package io.flowscope.core;

import io.flowscope.integration.RequestLabWorkspace;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Shared server rules for graph/API marks and destructive, Evidence-addressed deletion. */
public final class ApiManagement {
    private ApiManagement() {}
    public record Request(String action, long datasetRevision, long revision,
                          List<String> operations, List<String> evidenceIds, String color, List<String> expectedEvidenceIds) {
        public Request {
            operations = operations == null ? List.of() : operations.stream().distinct().toList();
            evidenceIds = evidenceIds == null ? List.of() : evidenceIds.stream().distinct().toList();
            if (operations.size() > 20_000 || evidenceIds.size() > 20_000) throw new IllegalArgumentException("too many deletion targets");
            expectedEvidenceIds = expectedEvidenceIds == null ? null : List.copyOf(expectedEvidenceIds);
            if (expectedEvidenceIds != null && expectedEvidenceIds.size() > 20_000) throw new IllegalArgumentException("too many expected records");
            color = color == null ? "" : color;
            if (action == null || !Set.of("highlight", "register", "unregister", "preview-delete", "delete").contains(action)) throw new IllegalArgumentException("unknown API action");
        }
        public boolean marksOnly() { return Set.of("highlight", "register", "unregister").contains(action); }
    }
    public record Preview(List<String> operations, List<String> evidenceIds, int records, int reviews, int declarations,
                          long revision, long datasetRevision, Map<String, Mark> apiMarks) {
        public Preview(List<String> operations, List<String> evidenceIds, int records, int reviews, int declarations) {
            this(operations, evidenceIds, records, reviews, declarations, -1, -1, null);
        }
        public Preview withMarks(long revision, long datasetRevision, Map<String, Mark> marks) {
            return new Preview(operations, evidenceIds, records, reviews, declarations, revision, datasetRevision, marks);
        }
    }
    public record Change(AnalysisConfig config, List<RequestRecord> records, List<RouteCandidate> routes,
                         RequestLabWorkspace requestLab, Preview preview, Set<Long> removedRuntimeIds) {}
    public record Mark(String color, boolean registered, List<String> evidenceIds) {}
    public static String operation(RequestRecord r) {
        String prefix = r.service + " " + r.method + " ";
        String path = r.op != null && r.op.startsWith(prefix) ? r.op.substring(prefix.length()).split("#", 2)[0] : r.path;
        return prefix + path;
    }
    public static String operation(RouteCandidate r) { return r.service() + " " + r.method() + " " + r.pathTemplate(); }
    public static String reviewId(String operation) {
        try { return "api-" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(operation.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static String declarationId(RouteCandidate.Provenance p) {
        return p.type().name() + "\u0000" + p.evidenceId() + "\u0000" + p.runId();
    }
    public static List<RouteCandidate> filterRoutes(List<RouteCandidate> routes, AnalysisConfig config) {
        var removed = config.apiState().removedDeclarations();
        var out = new ArrayList<RouteCandidate>();
        for (var r : routes) {
            Set<String> ids = removed.getOrDefault(operation(r), Set.of());
            var provenance = r.provenance().stream().filter(p -> !ids.contains(declarationId(p))).toList();
            if (provenance.size() == r.provenance().size()) { out.add(r); continue; }
            if (provenance.isEmpty()) continue;
            var evidence = provenance.stream().map(RouteCandidate.Provenance::evidenceId).collect(java.util.stream.Collectors.toSet());
            out.add(new RouteCandidate(r.service(), r.method(), r.pathTemplate(), r.concretePaths(), r.concretePathsTruncated(), provenance.stream().anyMatch(p -> p.type() == RouteCandidate.ProvenanceType.OBSERVED_REQUEST), provenance,
                    r.applicability(), r.reviewReason(), r.declaredParameters().stream().filter(p -> evidence.contains(p.evidenceId())).toList()));
        }
        return List.copyOf(out);
    }
    public static Map<String, Mark> marks(Pipeline.Result result, AnalysisConfig config, List<RouteCandidate> routes) {
        var state = config.apiState();
        var reviews = config.reviews();
        boolean registrations = reviews.keySet().stream().anyMatch(id -> id.startsWith("api-"));
        if (state.highlights().isEmpty() && !registrations) return Map.of();
        Set<String> operations = new HashSet<>(state.highlights().keySet());
        if (registrations) {
            result.records.forEach(r -> operations.add(operation(r))); routes.forEach(r -> operations.add(operation(r)));
        }
        Set<String> present = registrations ? result.records.stream().map(r -> r.evidenceId).collect(java.util.stream.Collectors.toSet()) : Set.of();
        Map<String, Mark> out = new HashMap<>();
        for (String op : operations) {
            var review = registrations ? reviews.get(reviewId(op)) : null;
            boolean registered = review != null && review.status() == ReviewDecision.Status.CONFIRMED && !review.evidenceIds().isEmpty() && present.containsAll(review.evidenceIds());
            String color = state.highlights().getOrDefault(op, "");
            if (!color.isEmpty() || registered) out.put(op, new Mark(color, registered, registered ? review.evidenceIds() : List.of()));
        }
        return Map.copyOf(out);
    }
    public static Map<Source, RunContextRegistry.CompletedRun> retainedRuns(Map<Source, RunContextRegistry.CompletedRun> runs, List<RequestRecord> remaining, Set<String> deletedIds) {
        Map<Source, RunContextRegistry.CompletedRun> out = new EnumMap<>(Source.class);
        for (var run : runs.values()) {
            if (run.evidenceIds().stream().noneMatch(deletedIds::contains)) { out.put(run.source(), run); continue; }
            var records = remaining.stream().filter(r -> run.evidenceIds().contains(r.evidenceId)).toList();
            if (records.isEmpty()) continue;
            out.put(run.source(), new RunContextRegistry.CompletedRun(run.source(), run.runId(), run.detail(), run.orchestrator(), run.tool(), run.phase(), run.accountId(), run.completedAt(),
                    records.stream().map(r -> r.evidenceId).distinct().toList(), records.size(), records.stream().filter(r -> r.trafficClassification.coverageEligible()).count()));
        }
        return Map.copyOf(out);
    }
    public static Change prepare(Request request, Pipeline.Result snapshot, List<RequestRecord> rawRecords,
                                 AnalysisConfig original, List<RouteCandidate> routes, RequestLabWorkspace lab) {
        AnalysisConfig config = original.snapshotCopy();
        Set<String> targets = new LinkedHashSet<>(request.operations());
        Set<String> known = new HashSet<>();
        snapshot.records.forEach(r -> known.add(operation(r))); routes.forEach(r -> known.add(operation(r)));
        if (!known.containsAll(targets)) throw new IllegalStateException("API 목록이 변경되었습니다. 다시 선택해 주세요.");
        Map<String, String> highlights = new HashMap<>(config.apiState().highlights());
        Map<String, Set<String>> removedDeclarations = new HashMap<>(config.apiState().removedDeclarations());
        Set<String> removedIds = new LinkedHashSet<>(request.evidenceIds());
        Set<String> present = snapshot.records.stream().map(r -> r.evidenceId).collect(java.util.stream.Collectors.toSet());
        if (!present.containsAll(removedIds)) throw new IllegalStateException("요청 기록이 바뀌었습니다. 다시 선택해 주세요.");
        if (request.marksOnly()) {
            if (targets.size() != 1) throw new IllegalArgumentException("API 하나를 선택해 주세요.");
            String op = targets.iterator().next();
            switch (request.action()) {
                case "highlight" -> { if (request.color().isEmpty()) highlights.remove(op); else { if (!ApiState.COLORS.contains(request.color())) throw new IllegalArgumentException("invalid highlight color"); highlights.put(op, request.color()); } }
                case "register" -> {
                    if (removedIds.isEmpty() || removedIds.size() > 20 || snapshot.records.stream().filter(r -> removedIds.contains(r.evidenceId)).anyMatch(r -> !operation(r).equals(op) || !r.hasResponse)) throw new IllegalArgumentException("해당 API의 응답이 있는 관측 근거를 선택해 주세요.");
                    config.reviewItem(reviewId(op), ReviewDecision.Status.CONFIRMED, "사용자 API 취약점 등록", List.copyOf(removedIds));
                }
                case "unregister" -> config.removeReview(reviewId(op));
            }
            config.restoreApiState(new ApiState(highlights, removedDeclarations));
            return new Change(config, rawRecords, routes, lab, new Preview(List.copyOf(targets), List.of(), 0, 0, 0), Set.of());
        }
        if (targets.isEmpty() && removedIds.isEmpty()) throw new IllegalArgumentException("삭제할 API 또는 요청 기록을 선택해 주세요.");
        if (!targets.isEmpty() && !removedIds.isEmpty()) throw new IllegalArgumentException("API와 기록 삭제 대상을 함께 지정할 수 없습니다.");
        snapshot.records.stream().filter(r -> targets.contains(operation(r))).forEach(r -> removedIds.add(r.evidenceId));
        // Validation responses derived from deleted originals cannot survive as orphaned traffic.
        boolean added;
        do { added = false; for (var r : snapshot.records) if ((removedIds.contains(r.originEvidenceId) || removedIds.contains(r.replayBasisEvidenceId)) && removedIds.add(r.evidenceId)) added = true; } while (added);
        Set<Long> runtimes = snapshot.records.stream().filter(r -> removedIds.contains(r.evidenceId)).map(RequestRecord::runtimeId).collect(java.util.stream.Collectors.toSet());
        for (var r : routes) {
            Set<String> ids = new HashSet<>(removedDeclarations.getOrDefault(operation(r), Set.of()));
            r.provenance().stream().filter(p -> targets.contains(operation(r)) || removedIds.contains(p.evidenceId())).forEach(p -> ids.add(declarationId(p)));
            if (!ids.isEmpty()) removedDeclarations.put(operation(r), Set.copyOf(ids));
        }
        targets.forEach(highlights::remove);
        int reviewsBefore = config.reviews().size();
        Set<String> policyTargets = new HashSet<>(targets);
        snapshot.records.stream().filter(r -> targets.contains(operation(r))).map(r -> r.op).forEach(policyTargets::add);
        config.removeReviews(removedIds, policyTargets);
        Set<String> orphanResources = new HashSet<>();
        snapshot.records.stream().filter(r -> removedIds.contains(r.evidenceId)).forEach(r -> {
            if (r.resource != null) orphanResources.add(r.resource);
            r.resourceReferences.forEach(ref -> orphanResources.add(ref.resource()));
        });
        snapshot.records.stream().filter(r -> !removedIds.contains(r.evidenceId)).forEach(r -> {
            orphanResources.remove(r.resource); r.resourceReferences.forEach(ref -> orphanResources.remove(ref.resource()));
        });
        config.removeResources(orphanResources);
        var matrix = AuthorizationMatrixAnalyzer.analyze(snapshot, original, List.of());
        matrix.functions().stream().filter(c -> targets.contains(c.operation())).forEach(c -> config.removeReview(c.id()));
        matrix.objects().stream().filter(c -> targets.contains(c.operation())).forEach(c -> config.removeReview(c.id()));
        config.restoreApiState(new ApiState(highlights, removedDeclarations));
        var filtered = filterRoutes(routes, config);
        Map<String, RequestLabWorkspace.Tab> tabs = new HashMap<>(lab.tabs());
        removedIds.forEach(tabs::remove);
        var nextLab = new RequestLabWorkspace(lab.revision() + 1, tabs);
        if (request.action().equals("delete") && (request.expectedEvidenceIds() == null || !new HashSet<>(request.expectedEvidenceIds()).equals(removedIds))) throw new IllegalStateException("삭제 대상이 변경되었습니다. 범위를 다시 확인해 주세요.");
        var preview = new Preview(List.copyOf(targets), List.copyOf(removedIds), removedIds.size(), reviewsBefore - config.reviews().size(), routes.size() - filtered.size());
        return new Change(config, snapshot.records.stream().filter(r -> !runtimes.contains(r.runtimeId())).toList(), filtered, nextLab, preview, Set.copyOf(runtimes));
    }
}
