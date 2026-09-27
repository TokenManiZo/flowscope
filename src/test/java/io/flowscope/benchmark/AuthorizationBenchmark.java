package io.flowscope.benchmark;

import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.AuthorizationAnalysis;
import io.flowscope.core.AuthorizationMatrix;
import io.flowscope.core.AuthorizationMatrixAnalyzer;
import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ResourcePolicy;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Test-only labeled corpus and scorer for the authorization matrix redesign. */
final class AuthorizationBenchmark {
    static final String SERVICE = "https://benchmark.test:443";

    enum Technique { BFLA, BOLA }

    enum SignalLevel {
        NONE(0), RECOMMENDATION(1), CANDIDATE(2);

        private final int rank;

        SignalLevel(int rank) {
            this.rank = rank;
        }

        boolean satisfies(SignalLevel minimum) {
            return rank >= minimum.rank;
        }
    }

    record Coordinate(
            String scenarioId,
            Technique technique,
            String identity,
            String operation,
            String resource) {}

    record LabeledCase(
            Coordinate coordinate,
            AccessRole role,
            String owner,
            ResourcePolicy resourcePolicy,
            AuthorizationMatrix.Expected expectedAccess,
            SignalLevel minimumSignal) {}

    record Scenario(
            String id,
            List<RequestRecord> records,
            AnalysisConfig config,
            List<LabeledCase> labels,
            boolean hardened) {}

    record ObservedSignal(Coordinate coordinate, SignalLevel level) {}

    record ScenarioResult(
            String scenarioId,
            int authorityFindings,
            List<ObservedSignal> signals,
            boolean hardened) {}

    record LevelScore(int expected, int actual, int truePositives, int falsePositives, int falseNegatives) {}

    record Report(
            int k,
            int expected,
            int actual,
            int truePositives,
            int falsePositives,
            int falseNegatives,
            int underSignaled,
            int overSignaled,
            double precisionAtK,
            double recall,
            LevelScore candidates,
            LevelScore recommendations,
            int hardenedFindings,
            int hardenedSignals,
            List<ObservedSignal> falsePositiveSignals,
            List<LabeledCase> falseNegativeLabels,
            List<ScenarioResult> scenarios) {

        String render() {
            return String.format(Locale.ROOT,
                    "Authorization benchmark Stage 0 baseline%n"
                            + "K=%d expected=%d actual=%d TP=%d FP=%d FN=%d under=%d over=%d%n"
                            + "Precision@%d=%.4f Recall=%.4f%n"
                            + "Candidates expected=%d actual=%d TP=%d FP=%d FN=%d%n"
                            + "Recommendations expected=%d actual=%d TP=%d FP=%d FN=%d%n"
                            + "Hardened findings=%d signals=%d%n"
                            + "False positives=%s%nFalse negatives=%s",
                    k, expected, actual, truePositives, falsePositives, falseNegatives, underSignaled, overSignaled,
                    k, precisionAtK, recall,
                    candidates.expected(), candidates.actual(), candidates.truePositives(),
                    candidates.falsePositives(), candidates.falseNegatives(),
                    recommendations.expected(), recommendations.actual(), recommendations.truePositives(),
                    recommendations.falsePositives(), recommendations.falseNegatives(),
                    hardenedFindings, hardenedSignals, falsePositiveSignals, falseNegativeLabels);
        }
    }

    private AuthorizationBenchmark() {}

    static Report currentBaseline() {
        return evaluate(corpus());
    }

    static List<Scenario> corpus() {
        List<Scenario> scenarios = new ArrayList<>();

        String export = operation("GET", "/api/admin/export");
        AnalysisConfig explicitBfla = accounts("user-a", "admin")
                .withEndpointRequirement(export, AccessRole.ADMIN);
        scenarios.add(new Scenario("bfla-explicit-candidate", List.of(
                record(Source.HUMAN, "admin", "GET", "/api/admin/export", 200, "{\"rows\":1}", 1),
                record(Source.SCANNER, "user-a", "GET", "/api/admin/export", 200, "{\"rows\":1}", 2)),
                explicitBfla,
                List.of(label("bfla-explicit-candidate", Technique.BFLA, "user-a", export, null,
                        AccessRole.USER, null, ResourcePolicy.UNKNOWN,
                        AuthorizationMatrix.Expected.DENY, SignalLevel.CANDIDATE)), false));

        String orders101 = resource("orders", "101");
        String orderRead = operation("GET", "/api/orders/{id}");
        scenarios.add(new Scenario("bola-explicit-owner-candidate", List.of(
                record(Source.HUMAN, "user-a", "GET", "/api/orders/101", 200,
                        "{\"id\":101,\"ownerId\":\"user-a\"}", 1),
                record(Source.SCANNER, "user-b", "GET", "/api/orders/101", 200,
                        "{\"id\":101,\"ownerId\":\"user-a\"}", 2)),
                accounts("user-a", "user-b"),
                List.of(label("bola-explicit-owner-candidate", Technique.BOLA, "user-b", orderRead, orders101,
                        AccessRole.USER, "user-a", ResourcePolicy.OWNER_ONLY,
                        AuthorizationMatrix.Expected.DENY, SignalLevel.CANDIDATE)), false));

        scenarios.add(new Scenario("bfla-manual-recommendation", List.of(
                record(Source.HUMAN, "admin", "GET", "/api/admin/export", 200, "{\"rows\":1}", 1)),
                accounts("user-a", "admin"),
                List.of(label("bfla-manual-recommendation", Technique.BFLA, "user-a", export, null,
                        AccessRole.USER, null, ResourcePolicy.UNKNOWN,
                        AuthorizationMatrix.Expected.UNKNOWN, SignalLevel.RECOMMENDATION)), false));

        String orders204 = resource("orders", "204");
        scenarios.add(new Scenario("bola-manual-recommendation", List.of(
                record(Source.HUMAN, "user-a", "GET", "/api/orders/204", 200, "{\"id\":204}", 1)),
                accounts("user-a", "user-b"),
                List.of(label("bola-manual-recommendation", Technique.BOLA, "user-b", orderRead, orders204,
                        AccessRole.USER, "user-a", ResourcePolicy.UNKNOWN,
                        AuthorizationMatrix.Expected.UNKNOWN, SignalLevel.RECOMMENDATION)), false));

        AnalysisConfig hardenedConfig = accounts("user-a", "user-b", "admin")
                .withEndpointRequirement(export, AccessRole.ADMIN);
        scenarios.add(new Scenario("hardened-zero", List.of(
                record(Source.HUMAN, "user-a", "GET", "/api/orders/501", 200,
                        "{\"id\":501,\"ownerId\":\"user-a\"}", 1),
                record(Source.SCANNER, "user-b", "GET", "/api/orders/501", 403,
                        "{\"error\":\"access denied\"}", 2),
                record(Source.HUMAN, "admin", "GET", "/api/admin/export", 200, "{\"rows\":1}", 3),
                record(Source.HUMAN, "user-a", "GET", "/api/admin/export", 403,
                        "{\"error\":\"forbidden\"}", 4),
                record(Source.SCANNER, "user-b", "GET", "/api/admin/export", 403,
                        "{\"error\":\"forbidden\"}", 5)),
                hardenedConfig,
                List.of(
                        label("hardened-zero", Technique.BOLA, "user-b", orderRead, resource("orders", "501"),
                                AccessRole.USER, "user-a", ResourcePolicy.OWNER_ONLY,
                                AuthorizationMatrix.Expected.DENY, SignalLevel.NONE),
                        label("hardened-zero", Technique.BFLA, "user-a", export, null,
                                AccessRole.USER, null, ResourcePolicy.UNKNOWN,
                                AuthorizationMatrix.Expected.DENY, SignalLevel.NONE)), true));

        scenarios.add(new Scenario("soft-deny-control", List.of(
                record(Source.HUMAN, "user-a", "GET", "/api/orders/601", 200,
                        "{\"id\":601,\"ownerId\":\"user-a\"}", 1),
                record(Source.SCANNER, "user-b", "GET", "/api/orders/601", 200,
                        "{\"id\":601,\"error\":\"access denied\"}", 2)),
                accounts("user-a", "user-b"),
                List.of(label("soft-deny-control", Technique.BOLA, "user-b", orderRead,
                        resource("orders", "601"), AccessRole.USER, "user-a", ResourcePolicy.OWNER_ONLY,
                        AuthorizationMatrix.Expected.DENY, SignalLevel.NONE)), false));

        scenarios.add(new Scenario("self-scope-control", List.of(
                record(Source.HUMAN, "user-a", "GET", "/api/orders/602", 200,
                        "{\"id\":602,\"ownerId\":\"user-a\"}", 1)),
                accounts("user-a"),
                List.of(label("self-scope-control", Technique.BOLA, "user-a", orderRead,
                        resource("orders", "602"), AccessRole.USER, "user-a", ResourcePolicy.OWNER_ONLY,
                        AuthorizationMatrix.Expected.ALLOW, SignalLevel.NONE)), false));

        scenarios.add(new Scenario("stage2-collection-membership-miss", List.of(
                record(Source.HUMAN, "user-a", "GET", "/api/orders", 200,
                        "{\"orders\":[{\"id\":701}]}", 1),
                record(Source.SCANNER, "user-b", "GET", "/api/orders/701", 200,
                        "{\"id\":701}", 2)),
                accounts("user-a", "user-b"),
                List.of(label("stage2-collection-membership-miss", Technique.BOLA, "user-b", orderRead,
                        resource("orders", "701"), AccessRole.USER, "user-a", ResourcePolicy.UNKNOWN,
                        AuthorizationMatrix.Expected.DENY, SignalLevel.CANDIDATE)), false));

        String catalogRead = operation("GET", "/api/catalog/{id}");
        scenarios.add(new Scenario("stage3-public-suppression-miss", List.of(
                record(Source.HUMAN, "user-a", "GET", "/api/catalog/801", 200,
                        "{\"id\":801,\"ownerId\":\"user-a\",\"published\":true}", 1),
                record(Source.SCANNER, "user-b", "GET", "/api/catalog/801", 200,
                        "{\"id\":801,\"ownerId\":\"user-a\",\"published\":true}", 2)),
                accounts("user-a", "user-b"),
                List.of(label("stage3-public-suppression-miss", Technique.BOLA, "user-b", catalogRead,
                        resource("catalog", "801"), AccessRole.USER, "user-a", ResourcePolicy.PUBLIC,
                        AuthorizationMatrix.Expected.ALLOW, SignalLevel.NONE)), false));

        String reports = operation("GET", "/api/reports/quarterly");
        scenarios.add(new Scenario("stage4-distribution-miss", List.of(
                record(Source.HUMAN, "admin", "GET", "/api/reports/quarterly", 200, "{\"rows\":1}", 1),
                record(Source.HUMAN, "user-a", "GET", "/api/reports/quarterly", 403,
                        "{\"error\":\"forbidden\"}", 2),
                record(Source.SCANNER, "user-b", "GET", "/api/reports/quarterly", 200, "{\"rows\":1}", 3)),
                accounts("user-a", "user-b", "admin"),
                List.of(label("stage4-distribution-miss", Technique.BFLA, "user-b", reports, null,
                        AccessRole.USER, null, ResourcePolicy.UNKNOWN,
                        AuthorizationMatrix.Expected.UNKNOWN, SignalLevel.RECOMMENDATION)), false));

        return List.copyOf(scenarios);
    }

    static Report evaluate(List<Scenario> scenarios) {
        Map<Coordinate, LabeledCase> expected = new LinkedHashMap<>();
        Map<Coordinate, ObservedSignal> actual = new LinkedHashMap<>();
        List<ScenarioResult> scenarioResults = new ArrayList<>();
        int hardenedFindings = 0;
        int hardenedSignals = 0;

        for (Scenario scenario : scenarios) {
            scenario.labels().stream()
                    .filter(label -> label.resourcePolicy() != ResourcePolicy.UNKNOWN)
                    .forEach(label -> scenario.config().withResourcePolicy(
                            label.coordinate().resource() == null
                                    ? label.coordinate().operation() : label.coordinate().resource(),
                            label.resourcePolicy()));
            scenario.labels().stream().filter(label -> label.minimumSignal() != SignalLevel.NONE)
                    .forEach(label -> expected.put(label.coordinate(), label));
            Pipeline.Result result = Pipeline.runIsolated(scenario.records(), scenario.config());
            AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, scenario.config(), List.of());
            List<ObservedSignal> signals = extract(scenario.id(), matrix);
            signals.forEach(signal -> actual.merge(signal.coordinate(), signal,
                    (left, right) -> right.level().rank > left.level().rank ? right : left));
            scenarioResults.add(new ScenarioResult(scenario.id(), result.analysis.findings().size(), signals,
                    scenario.hardened()));
            if (scenario.hardened()) {
                hardenedFindings += result.analysis.findings().size();
                hardenedSignals += signals.size();
            }
        }

        List<ObservedSignal> rankedActual = actual.values().stream()
                .sorted(Comparator.comparingInt((ObservedSignal signal) -> signal.level().rank).reversed()
                        .thenComparing(signal -> signal.coordinate().scenarioId())
                        .thenComparing(signal -> signal.coordinate().technique().name())
                        .thenComparing(signal -> signal.coordinate().identity())
                        .thenComparing(signal -> signal.coordinate().operation())
                        .thenComparing(signal -> signal.coordinate().resource(), Comparator.nullsFirst(String::compareTo)))
                .toList();
        int k = expected.size();
        int topKMatches = (int) rankedActual.stream().limit(k)
                .filter(signal -> matches(signal, expected.get(signal.coordinate()))).count();
        int truePositives = (int) rankedActual.stream()
                .filter(signal -> matches(signal, expected.get(signal.coordinate()))).count();
        List<ObservedSignal> falsePositives = rankedActual.stream()
                .filter(signal -> !matches(signal, expected.get(signal.coordinate()))).toList();
        List<LabeledCase> falseNegatives = expected.values().stream()
                .filter(label -> {
                    ObservedSignal signal = actual.get(label.coordinate());
                    return signal == null || !signal.level().satisfies(label.minimumSignal());
                })
                .sorted(Comparator.comparing(label -> label.coordinate().scenarioId()))
                .toList();
        int underSignaled = (int) expected.values().stream().filter(label -> {
            ObservedSignal signal = actual.get(label.coordinate());
            return signal != null && !signal.level().satisfies(label.minimumSignal());
        }).count();
        int overSignaled = (int) expected.values().stream().filter(label -> {
            ObservedSignal signal = actual.get(label.coordinate());
            return signal != null && signal.level().rank > label.minimumSignal().rank;
        }).count();

        LevelScore candidates = levelScore(SignalLevel.CANDIDATE, expected, actual);
        LevelScore recommendations = levelScore(SignalLevel.RECOMMENDATION, expected, actual);
        double precisionAtK = k == 0 ? 1.0 : (double) topKMatches / k;
        double recall = k == 0 ? 1.0 : (double) truePositives / k;
        return new Report(k, expected.size(), actual.size(), truePositives, falsePositives.size(),
                falseNegatives.size(), underSignaled, overSignaled, precisionAtK, recall,
                candidates, recommendations, hardenedFindings, hardenedSignals,
                falsePositives, falseNegatives, List.copyOf(scenarioResults));
    }

    private static List<ObservedSignal> extract(String scenarioId, AuthorizationMatrix matrix) {
        List<ObservedSignal> signals = new ArrayList<>();
        for (AuthorizationMatrix.FunctionCell cell : matrix.functions()) {
            SignalLevel level = candidate(cell.status(), Technique.BFLA)
                    ? SignalLevel.CANDIDATE
                    : openRecommendation(cell.recommendation(), cell.reviewStatus())
                    ? SignalLevel.RECOMMENDATION : SignalLevel.NONE;
            if (level != SignalLevel.NONE) {
                signals.add(new ObservedSignal(new Coordinate(scenarioId, Technique.BFLA,
                        cell.identity(), cell.operation(), null), level));
            }
        }
        for (AuthorizationMatrix.ObjectCell cell : matrix.objects()) {
            SignalLevel level = candidate(cell.status(), Technique.BOLA)
                    ? SignalLevel.CANDIDATE
                    : openRecommendation(cell.recommendation(), cell.reviewStatus())
                    ? SignalLevel.RECOMMENDATION : SignalLevel.NONE;
            if (level != SignalLevel.NONE) {
                signals.add(new ObservedSignal(new Coordinate(scenarioId, Technique.BOLA,
                        cell.identity(), cell.operation(), cell.resource()), level));
            }
        }
        return List.copyOf(new LinkedHashSet<>(signals));
    }

    private static boolean candidate(AuthorizationMatrix.Status status, Technique technique) {
        return technique == Technique.BFLA
                ? status == AuthorizationMatrix.Status.BFLA_CANDIDATE
                    || status == AuthorizationMatrix.Status.BFLA_REPRODUCED
                : status == AuthorizationMatrix.Status.BOLA_IDOR_CANDIDATE
                    || status == AuthorizationMatrix.Status.BOLA_REPRODUCED;
    }

    private static boolean openRecommendation(AuthorizationMatrix.TestRecommendation recommendation,
                                              String reviewStatus) {
        return recommendation != null && "UNRESOLVED".equals(reviewStatus);
    }

    private static boolean matches(ObservedSignal signal, LabeledCase expected) {
        return expected != null && signal.level().satisfies(expected.minimumSignal());
    }

    private static LevelScore levelScore(SignalLevel level,
                                         Map<Coordinate, LabeledCase> expected,
                                         Map<Coordinate, ObservedSignal> actual) {
        Set<Coordinate> expectedCoordinates = expected.values().stream()
                .filter(label -> label.minimumSignal() == level)
                .map(LabeledCase::coordinate)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        Set<Coordinate> actualCoordinates = actual.values().stream()
                .filter(signal -> signal.level() == level)
                .map(ObservedSignal::coordinate)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        int truePositives = (int) actualCoordinates.stream().filter(expectedCoordinates::contains).count();
        return new LevelScore(expectedCoordinates.size(), actualCoordinates.size(), truePositives,
                actualCoordinates.size() - truePositives, expectedCoordinates.size() - truePositives);
    }

    private static LabeledCase label(String scenarioId, Technique technique, String identity,
                                     String operation, String resource, AccessRole role, String owner,
                                     ResourcePolicy resourcePolicy, AuthorizationMatrix.Expected expectedAccess,
                                     SignalLevel minimumSignal) {
        return new LabeledCase(new Coordinate(scenarioId, technique, identity, operation, resource),
                role, owner, resourcePolicy, expectedAccess, minimumSignal);
    }

    private static AnalysisConfig accounts(String... ids) {
        AnalysisConfig config = new AnalysisConfig();
        for (String id : ids) {
            AccessRole role = "admin".equals(id) ? AccessRole.ADMIN : AccessRole.USER;
            config.upsertAccount(new AccountProfile(id, id.toUpperCase(Locale.ROOT), SERVICE, role))
                    .bindSession(SERVICE, fingerprint(id), id);
        }
        return config;
    }

    private static RequestRecord record(Source source, String identity, String method, String path,
                                        int status, String body, int sequence) {
        RequestRecord record = new RequestRecord(source, SERVICE, method, path, status, fingerprint(identity));
        record.body = body;
        record.respText = "HTTP/1.1 " + status + " Test\r\nContent-Type: application/json\r\n\r\n" + body;
        record.responseContentType = "application/json";
        record.hasResponse = true;
        record.phase = RunPhase.EXPLORATION;
        record.executionTrust = ExecutionTrust.OBSERVED;
        record.sourceDetail = source == Source.HUMAN ? SourceDetail.BROWSER : SourceDetail.ZAP_SPIDER;
        record.timestamp = 1_800_000_000_000L + sequence;
        return record;
    }

    private static String fingerprint(String identity) {
        return "fp:" + identity;
    }

    private static String operation(String method, String path) {
        return SERVICE + " " + method + " " + path;
    }

    private static String resource(String type, String id) {
        return SERVICE + " " + type + ":" + id;
    }
}
