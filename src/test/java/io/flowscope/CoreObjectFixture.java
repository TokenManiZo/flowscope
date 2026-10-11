package io.flowscope;

import io.flowscope.core.*;
import java.util.*;

/** Recorded sibling IDs provide the corroboration required by the existing PATH OBJ recognizer. */
public final class CoreObjectFixture {
    public static List<RequestRecord> corroborated(List<RequestRecord> records) {
        var out = new ArrayList<>(records);
        Set<String> families = new HashSet<>();
        for (RequestRecord record : records) {
            String path = record.path;
            int slash = path.lastIndexOf('/');
            String token = path.substring(slash + 1);
            if (!token.matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}") && !token.matches("(?:\\d+|(?=.*[A-Za-z])(?=.*\\d)[A-Za-z0-9._~\\-]+)")) continue;
            String family = record.service + " " + record.method + " " + path.substring(0, slash);
            if (!families.add(family)) continue;
            RequestRecord sibling = new RequestRecord(record.source, record.service, record.method,
                    path.substring(0, slash + 1) + "999999991", 200, record.fp);
            sibling.collectionAccountId = record.collectionAccountId;
            sibling.sourceDetail = record.sourceDetail; sibling.phase = record.phase;
            sibling.executionTrust = record.executionTrust; sibling.hasResponse = true; sibling.body = "{\"id\":999999991}";
            sibling.responseContentType = "application/json";
            sibling.evidenceId = null; sibling.timestamp = 999999999;
            sibling.reqText = record.method + " " + sibling.path + " HTTP/1.1\r\nHost: fixture\r\n\r\n";
            sibling.reqBody = null; sibling.query = null; sibling.resource = null; sibling.op = null;
            Normalizer.normalizeAll(List.of(sibling)); EvidenceIds.assign(List.of(sibling));
            sibling.role = record.role; sibling.trafficClassification = TrafficClassifier.classify(sibling, new AnalysisConfig());
            out.add(sibling);
        }
        return out;
    }
    static Pipeline.Result run(List<RequestRecord> records) { return run(records, new AnalysisConfig()); }
    static Pipeline.Result run(List<RequestRecord> records, AnalysisConfig config) { return Pipeline.run(corroborated(records), config); }
    static AuthorizationAnalysis analyze(List<RequestRecord> records, AnalysisConfig config) { return run(records, config).analysis; }
    static String resource(RequestRecord record) {
        RequestRecord copy = record.analysisCopy();
        var result = Pipeline.run(corroborated(List.of(copy)));
        return result.objects.observations().stream().filter(object -> object.eventId().equals(copy.evidenceId))
                .filter(object -> object.kind().equals("PATH")).map(ObservedObjectIndex::resource).findFirst().orElse(null);
    }
}
