package io.flowscope.core;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** LLM과 UI가 원본 요청을 정확히 역참조하도록 안정적인 증거 ID를 부여한다. */
public final class EvidenceIds {
    private EvidenceIds() {}

    public static void assign(List<RequestRecord> records) {
        Map<String, Integer> duplicates = new LinkedHashMap<>();
        Set<String> used = new LinkedHashSet<>();
        for (RequestRecord r : records) {
            String material = String.join("\n",
                    r.source.name(), r.sourceDetail.name(), r.orchestrator.name(), r.tool.name(), r.phase.name(),
                    r.executionTrust.name(),
                    String.valueOf(r.runId), r.service, r.method, r.path, String.valueOf(r.query),
                    String.valueOf(r.reqBody), String.valueOf(r.reqText), String.valueOf(r.status),
                    String.valueOf(r.body), String.valueOf(r.respText), String.valueOf(r.location),
                    String.valueOf(r.hasResponse), String.valueOf(r.timestamp), r.fp);
            String digest = digest(material);
            String base = "ev-" + digest.substring(0, 16);
            if (digest.equals(r.contentDigest) && validExisting(r.evidenceId) && used.add(r.evidenceId)) {
                continue;
            }
            r.contentDigest = digest;
            int n = duplicates.merge(base, 1, Integer::sum);
            String candidate = n == 1 ? base : base + "-" + n;
            while (!used.add(candidate)) {
                n = duplicates.merge(base, 1, Integer::sum);
                candidate = base + "-" + n;
            }
            r.evidenceId = candidate;
        }
    }

    private static boolean validExisting(String evidenceId) {
        return evidenceId != null && evidenceId.matches("ev-[0-9a-f]{16}(?:-[2-9][0-9]*)?");
    }

    private static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) out.append(String.format("%02x", b));
            return out.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
