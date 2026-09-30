package io.flowscope.core;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
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
            List<String> material = new ArrayList<>(24);
            material.add(r.source.name()); material.add(r.sourceDetail.name());
            material.add(r.orchestrator.name()); material.add(r.tool.name()); material.add(r.phase.name());
            material.add(r.executionTrust.name()); material.add(r.runId); material.add(r.laneAccountId);
            if (r.supportingPageUrl != null) {
                material.add("supporting-asset");
                material.add(r.supportingPageUrl);
            }
            if (r.replayBasisIdentity != null || r.replayBasisEvidenceId != null) {
                material.add("authorization-replay");
                material.add(r.replayBasisIdentity);
                material.add(r.replayBasisEvidenceId);
            }
            material.add(r.service);
            material.add(r.method); material.add(r.path); material.add(r.query);
            addPayload(material, r.requestPayload, r.reqBody, r.reqText);
            material.add(String.valueOf(r.status));
            addPayload(material, r.responsePayload, r.body, r.respText);
            material.add(r.location); material.add(String.valueOf(r.hasResponse));
            material.add(String.valueOf(r.timestamp)); material.add(r.fp);
            String digest = digest(material);
            String base = "ev-" + digest.substring(0, 16);
            boolean sameContent = digest.equals(r.contentDigest)
                    || (validExisting(r.evidenceId) && legacyDigest(r).equals(r.contentDigest));
            if (sameContent && validExisting(r.evidenceId) && used.add(r.evidenceId)) {
                r.contentDigest = digest;
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

    private static void addPayload(List<String> material, StoredPayload payload, String body, String message) {
        if (payload == null) {
            material.add("inline");
            material.add(body);
            material.add(message);
        } else {
            material.add("stored");
            material.add(payload.digest());
        }
    }

    private static boolean validExisting(String evidenceId) {
        return evidenceId != null && evidenceId.matches("ev-[0-9a-f]{16}(?:-[2-9][0-9]*)?");
    }

    /** beta.23 이하 프로젝트의 Evidence ID를 보존하며 새 framed digest로 한 번에 이행한다. */
    private static String legacyDigest(RequestRecord r) {
        String material = String.join("\n",
                r.source.name(), r.sourceDetail.name(), r.orchestrator.name(), r.tool.name(), r.phase.name(),
                r.executionTrust.name(), String.valueOf(r.runId), r.service, r.method, r.path,
                String.valueOf(r.query), legacyPayload(r.requestPayload, r.reqBody, r.reqText),
                String.valueOf(r.status), legacyPayload(r.responsePayload, r.body, r.respText),
                String.valueOf(r.location), String.valueOf(r.hasResponse), String.valueOf(r.timestamp), r.fp);
        return digest(material.getBytes(StandardCharsets.UTF_8));
    }

    private static String legacyPayload(StoredPayload payload, String body, String message) {
        return payload == null ? String.valueOf(body) + "\n" + String.valueOf(message) : payload.digest();
    }

    private static String digest(List<String> values) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String value : values) {
                if (value == null) {
                    digest.update(new byte[]{-1, -1, -1, -1});
                    continue;
                }
                byte[] field = value.getBytes(StandardCharsets.UTF_8);
                digest.update(new byte[]{
                        (byte) (field.length >>> 24), (byte) (field.length >>> 16),
                        (byte) (field.length >>> 8), (byte) field.length});
                digest.update(field);
            }
            return hex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String digest(byte[] material) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(material));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) out.append(String.format("%02x", value));
        return out.toString();
    }
}
