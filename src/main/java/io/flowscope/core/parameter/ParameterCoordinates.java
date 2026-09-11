package io.flowscope.core.parameter;

import io.flowscope.core.SurfaceAnalysis.ParameterLocation;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * D-143 공통 parameter coordinate 계약. 관측(ParameterExtractor)과 선언(SurfaceAnalyzer 어댑터)이
 * 공유하는 machine identity(canonicalPath)를 만든다. displayName/변수명은 여기서 다루지 않는다.
 *
 * <p>canonicalPath 문법:
 * <ul>
 *   <li>PATH: 빈 세그먼트를 제거한 zero-based 위치의 {@code /segments/N} (단일도 축약하지 않음).</li>
 *   <li>JSON_BODY/GRAPHQL_VARIABLE: RFC6901 기반 pointer + FlowScope 확장(배열 wildcard {@code *},
 *       literal {@code *} → {@code ~2}). token escaping: {@code ~}→{@code ~0}, {@code /}→{@code ~1},
 *       {@code *}→{@code ~2}.</li>
 *   <li>QUERY/FORM_BODY/MULTIPART_BODY: percent-decode한 이름을 escaped token 하나로.</li>
 *   <li>HEADER: ASCII lowercase escaped token.</li>
 *   <li>XML_PATH: namespace prefix가 아니라 {@code {uri}local} escaped token.</li>
 * </ul>
 */
public final class ParameterCoordinates {

    /** 배열 원소 wildcard 세그먼트. literal {@code *}는 {@link #escape}가 {@code ~2}로 피한다. */
    public static final String ARRAY_WILDCARD = "*";

    /** 저장 좌표의 계약 버전. 없는 파일은 LEGACY_V1로 읽는다. */
    public enum CoordinateVersion { LEGACY_V1, FLOW_V2 }

    private ParameterCoordinates() {}

    /** RFC6901(~0,~1) + FlowScope literal {@code *} → {@code ~2}. {@code ~}를 먼저 피해야 한다. */
    public static String escape(String token) {
        return token.replace("~", "~0").replace("/", "~1").replace("*", "~2");
    }

    /** QUERY/FORM_BODY/MULTIPART_BODY: 이미 percent-decode된 이름 하나를 canonicalPath로. */
    public static String nameToken(String decodedName) {
        return "/" + escape(decodedName);
    }

    /** HEADER: ASCII lowercase 후 escaped token. */
    public static String headerToken(String headerName) {
        return "/" + escape(headerName.toLowerCase(Locale.ROOT));
    }

    /** JSON/GraphQL 자식 세그먼트를 붙인다. parent는 root면 빈 문자열. */
    public static String jsonChild(String parentCanonical, String key) {
        return parentCanonical + "/" + escape(key);
    }

    /** JSON/GraphQL 배열 원소 세그먼트를 붙인다. */
    public static String arrayElement(String parentCanonical) {
        return parentCanonical + "/" + ARRAY_WILDCARD;
    }

    /**
     * PATH 선언용: endpoint template의 placeholder 위치를 {@link PathSlotCanonicalizer}로 구해
     * 선언 이름과 무관하게 관측과 같은 {@code /segments/N}을 만든다. 구조 위치가 같으면 이름이 달라도 같은 좌표.
     */
    public static List<PathSlotCanonicalizer.Slot> pathSlots(String template) {
        return PathSlotCanonicalizer.slots(template);
    }

    /** 엔진 Location → 공개 SurfaceAnalysis.ParameterLocation(wire 호환 이름). */
    public static ParameterLocation location(ParameterObservation.Location location) {
        return switch (location) {
            case PATH -> ParameterLocation.PATH;
            case QUERY -> ParameterLocation.QUERY;
            case FORM -> ParameterLocation.FORM_BODY;
            case JSON_BODY -> ParameterLocation.JSON_BODY;
            case GRAPHQL_VARIABLE -> ParameterLocation.GRAPHQL_VARIABLE;
            case MULTIPART_FIELD -> ParameterLocation.MULTIPART_BODY;
            case XML_PATH -> ParameterLocation.XML_PATH;
        };
    }

    /**
     * LEGACY_V1 저장 좌표를 FLOW_V2 canonicalPath로 변환. PATH/QUERY/FORM/MULTIPART/HEADER는 무손실.
     * JSON/GraphQL dot 표기는 literal dot과 중첩을 구분할 수 없어 {@link Optional#empty()}를 반환한다
     * (호출자는 추정 join·Gap 승격을 하지 않고 LEGACY_AMBIGUOUS_COORDINATE로 표시).
     */
    public static Optional<String> legacyToCanonical(ParameterLocation location, String legacyFieldPath,
                                                     String pathTemplate) {
        return switch (location) {
            case PATH -> legacyPathToCanonical(legacyFieldPath, pathTemplate);
            case QUERY, FORM_BODY, MULTIPART_BODY -> Optional.of(nameToken(legacyFieldPath));
            case HEADER -> Optional.of(headerToken(legacyFieldPath));
            case JSON_BODY, GRAPHQL_VARIABLE -> legacyJsonToCanonical(legacyFieldPath);
            case XML_PATH -> Optional.empty();
        };
    }

    /**
     * 기존 JSON/GraphQL fieldPath는 {@code parent.child} 점 표기였다. 점(중첩)·배열·wildcard가 있으면 literal
     * 키와 구조를 구분할 수 없어 ambiguous로 {@link Optional#empty()}를 반환한다. 점 없는 단일 최상위 key만
     * {@code /token}으로 무손실 변환해 관측과 join한다.
     */
    private static Optional<String> legacyJsonToCanonical(String legacyFieldPath) {
        if (legacyFieldPath == null || legacyFieldPath.isBlank()) return Optional.empty();
        if (legacyFieldPath.indexOf('.') >= 0 || legacyFieldPath.indexOf('/') >= 0
                || legacyFieldPath.indexOf('[') >= 0 || legacyFieldPath.indexOf('*') >= 0) {
            return Optional.empty();
        }
        return Optional.of(nameToken(legacyFieldPath));
    }

    private static Optional<String> legacyPathToCanonical(String legacyFieldPath, String pathTemplate) {
        // 기존 형식은 path[index]이며 index는 split("/", -1)의 위치(빈 선행 세그먼트 포함)였다.
        if (legacyFieldPath == null || !legacyFieldPath.startsWith("path[") || !legacyFieldPath.endsWith("]")) {
            return Optional.empty();
        }
        int legacyIndex;
        try {
            legacyIndex = Integer.parseInt(legacyFieldPath.substring(5, legacyFieldPath.length() - 1));
        } catch (NumberFormatException invalid) {
            return Optional.empty();
        }
        String[] rawSegments = pathTemplate == null ? new String[0] : pathTemplate.split("/", -1);
        if (legacyIndex < 0 || legacyIndex >= rawSegments.length) return Optional.empty();
        // legacy index(빈 세그먼트 포함) → 비빈 세그먼트 zero-based 위치로 재계산.
        int nonEmpty = -1;
        for (int i = 0; i <= legacyIndex; i++) {
            if (!rawSegments[i].isEmpty()) nonEmpty++;
        }
        if (nonEmpty < 0 || !rawSegments[legacyIndex].startsWith("{")) return Optional.empty();
        return Optional.of("/segments/" + nonEmpty);
    }
}
