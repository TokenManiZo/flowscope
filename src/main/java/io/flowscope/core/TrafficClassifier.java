package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import static io.flowscope.core.TrafficClassification.Disposition;
import static io.flowscope.core.TrafficClassification.TrafficClass;

/** 표준 요청 문맥과 저장된 Evidence만 사용하는 보수적 비파괴 분류기. */
public final class TrafficClassifier {
    public static final int VERSION = 8;

    /** Reason set on HUMAN API traffic captured while no exploration pass was active (D-071). The snapshot reads it to guide a pass start (D-155). */
    public static final String HUMAN_OUTSIDE_EXPLORATION_RUN = "HUMAN_OUTSIDE_EXPLORATION_RUN";

    private static final Set<String> ASSET_DESTINATIONS = Set.of(
            "audio", "font", "image", "manifest", "script", "style", "track", "video");
    private static final Set<String> ASSET_EXTENSIONS = Set.of(
            "js", "mjs", "css", "map", "png", "jpg", "jpeg", "gif", "svg", "ico", "webp",
            "avif", "bmp", "woff", "woff2", "ttf", "eot", "mp3", "mp4", "webm");
    /** 정적 자산이지만 endpoint 선언을 담을 수 있어 탐색 대상으로 남기는 확장자. */
    private static final Set<String> DISCOVERY_ASSET_EXTENSIONS = Set.of("js", "mjs", "map");
    private static final Set<String> TELEMETRY_PATHS = Set.of(
            "/collect", "/analytics", "/telemetry", "/beacon", "/pixel");

    /**
     * 응답 없이 경로만으로 "탐색 가치가 없는 정적 자산"인지 본다. route 후보 frontier에서만 쓴다.
     * JavaScript와 source map은 endpoint 선언을 담으므로 제외하지 않는다.
     */
    public static boolean looksLikeNonDiscoveryAssetPath(String path) {
        String ext = extension(path);
        return !ext.isBlank() && ASSET_EXTENSIONS.contains(ext) && !DISCOVERY_ASSET_EXTENSIONS.contains(ext);
    }

    private TrafficClassifier() {}

    public static TrafficClassification classify(RequestRecord record, AnalysisConfig config) {
        if (!record.hasResponse) {
            return result(inferredClass(record), Disposition.EXCLUDE, false, "NO_RESPONSE");
        }
        if (record.supportingPageUrl != null) {
            return result(TrafficClass.STATIC_ASSET, Disposition.EXCLUDE, false, "SUPPORTING_CROSS_ORIGIN_ASSET");
        }
        if (record.source == Source.UNKNOWN) {
            return result(inferredClass(record), Disposition.EXCLUDE, false, "UNKNOWN_SOURCE");
        }
        if (record.phase == RunPhase.SESSION_SETUP) {
            return result(TrafficClass.AUTH_SESSION, Disposition.EXCLUDE, false, "SESSION_SETUP");
        }
        if (record.source == Source.HUMAN && record.phase == RunPhase.BASELINE) {
            return result(inferredClass(record), Disposition.EXCLUDE, false,
                    HUMAN_OUTSIDE_EXPLORATION_RUN);
        }
        if (record.phase == RunPhase.VALIDATION || record.phase == RunPhase.COACH_PROBE) {
            return result(inferredClass(record), Disposition.EXCLUDE, false, "NON_DISCOVERY_PHASE");
        }
        TrafficOverride override = config == null ? TrafficOverride.AUTO : config.trafficOverride(record.op);
        if (override == TrafficOverride.INCLUDE) {
            return result(TrafficClass.API, Disposition.INCLUDE, true, "USER_INCLUDE");
        }
        if (override == TrafficOverride.REVIEW) {
            return result(inferredClass(record), Disposition.REVIEW, true, "USER_REVIEW");
        }
        if (override == TrafficOverride.EXCLUDE) {
            return result(inferredClass(record), Disposition.EXCLUDE, true, "USER_EXCLUDE");
        }
        if (isPreflight(record)) {
            return result(TrafficClass.PREFLIGHT, Disposition.EXCLUDE, false,
                    "OPTIONS_WITH_ACCESS_CONTROL_REQUEST_METHOD");
        }

        boolean securityRelevant = securityRelevant(record);
        String discoveryMetadataReason = discoveryMetadataReason(record);
        if (discoveryMetadataReason != null && !securityRelevant) {
            return result(TrafficClass.DISCOVERY_METADATA, Disposition.EXCLUDE, false,
                    discoveryMetadataReason);
        }
        if (isStaticAsset(record) && !securityRelevant) {
            return result(TrafficClass.STATIC_ASSET, Disposition.EXCLUDE, false, "ASSET_CONTEXT_AND_TYPE");
        }
        if (isNavigation(record) && !securityRelevant) {
            return result(TrafficClass.NAVIGATION, Disposition.EXCLUDE, false, "DOCUMENT_NAVIGATION");
        }
        if (isTelemetryCandidate(record) && !securityRelevant) {
            return result(TrafficClass.TELEMETRY_CANDIDATE, Disposition.REVIEW, false,
                    "TELEMETRY_PATH_IS_NOT_PROOF");
        }
        if (authorizationResponseOnly(record)) {
            return result(TrafficClass.UNKNOWN, Disposition.REVIEW, false,
                    "AUTHORIZATION_RESPONSE_ONLY");
        }
        if (securityRelevant || isApiRepresentation(record) || isApiFetch(record)) {
            List<String> reasons = new ArrayList<>();
            if (record.resource != null) reasons.add("OBJECT_SIGNAL");
            if (isUnsafe(record.method)) reasons.add("STATE_CHANGING_METHOD");
            if (record.status == 401 || record.status == 403) reasons.add("AUTHORIZATION_RESPONSE");
            if (ResponseEvidence.loginRedirect(record)) reasons.add("LOGIN_REDIRECT");
            if (isApiRepresentation(record)) reasons.add("API_MEDIA_TYPE");
            if (isApiFetch(record)) reasons.add("FETCH_API_CONTEXT");
            if (reasons.isEmpty()) reasons.add("API_EVIDENCE");
            return new TrafficClassification(TrafficClass.API, Disposition.INCLUDE, reasons, false);
        }
        return result(TrafficClass.UNKNOWN, Disposition.REVIEW, false, "AMBIGUOUS_KEEP");
    }

    private static TrafficClass inferredClass(RequestRecord record) {
        if (isPreflight(record)) return TrafficClass.PREFLIGHT;
        if (discoveryMetadataReason(record) != null) return TrafficClass.DISCOVERY_METADATA;
        if (isStaticAsset(record)) return TrafficClass.STATIC_ASSET;
        if (isNavigation(record)) return TrafficClass.NAVIGATION;
        if (isTelemetryCandidate(record)) return TrafficClass.TELEMETRY_CANDIDATE;
        if (securityRelevant(record) || isApiRepresentation(record) || isApiFetch(record)) return TrafficClass.API;
        return TrafficClass.UNKNOWN;
    }

    private static boolean securityRelevant(RequestRecord record) {
        return record.resource != null || isUnsafe(record.method) || record.status == 401 || record.status == 403
                || ResponseEvidence.loginRedirect(record);
    }

    private static boolean authorizationResponseOnly(RequestRecord record) {
        return (record.status == 401 || record.status == 403)
                && record.resource == null
                && !isUnsafe(record.method)
                && !ResponseEvidence.loginRedirect(record)
                && !isApiRepresentation(record)
                && !isApiFetch(record);
    }

    private static boolean isPreflight(RequestRecord record) {
        return "OPTIONS".equals(record.method) && notBlank(record.accessControlRequestMethod);
    }

    private static String discoveryMetadataReason(RequestRecord record) {
        if (!isSafe(record.method)) return null;
        String path = lower(record.path);
        String dest = lower(record.secFetchDest);
        String mime = mediaType(record.responseContentType);
        if (dest.equals("manifest") || path.endsWith(".webmanifest")
                || mime.equals("application/manifest+json")) return "WEB_APP_MANIFEST";
        if (path.equals("/manifest.json")) return "WEB_APP_MANIFEST_PATH";
        if (path.endsWith("/manifest.json") && mime.equals("application/json")
                && webAppManifestBody(record.responseBodyForAnalysis())) return "WEB_APP_MANIFEST_BODY";
        if (path.endsWith(".map") && mime.equals("application/json")) return "SOURCE_MAP";
        if ((dest.equals("serviceworker") || dest.equals("worker"))
                && (mime.contains("javascript") || path.endsWith(".js"))) return "SERVICE_WORKER";
        return null;
    }

    private static boolean webAppManifestBody(String body) {
        if (body == null || body.isBlank() || body.length() > 64 * 1024) return false;
        try {
            JsonNode root = ResponseEvidence.parseBoundedJson(body);
            return root.isObject()
                    && (root.path("name").isTextual() || root.path("short_name").isTextual())
                    && (root.path("icons").isArray() || root.path("start_url").isTextual()
                    || root.path("display").isTextual());
        } catch (IOException | RuntimeException ignored) {
            return false;
        }
    }

    private static boolean isStaticAsset(RequestRecord record) {
        if (!isSafe(record.method)) return false;
        String dest = lower(record.secFetchDest);
        String mime = mediaType(record.responseContentType);
        String ext = extension(record.path);
        if (ASSET_DESTINATIONS.contains(dest)) return mimeMatchesDestination(mime, dest)
                || (mime.isBlank() && ASSET_EXTENSIONS.contains(ext));
        if (!ext.isBlank() && ASSET_EXTENSIONS.contains(ext)) return mimeMatchesExtension(mime, ext);
        return "/favicon.ico".equals(lower(record.path)) && (mime.equals("image/x-icon") || mime.equals("image/vnd.microsoft.icon"));
    }

    private static boolean isNavigation(RequestRecord record) {
        if (!isSafe(record.method)) return false;
        String dest = lower(record.secFetchDest);
        return (dest.equals("document") || dest.equals("iframe"))
                && mediaType(record.responseContentType).equals("text/html");
    }

    private static boolean isTelemetryCandidate(RequestRecord record) {
        return TELEMETRY_PATHS.contains(lower(record.path));
    }

    private static boolean isApiRepresentation(RequestRecord record) {
        return isApiMediaType(record.requestContentType) || isApiMediaType(record.responseContentType);
    }

    private static boolean isApiMediaType(String value) {
        String mime = mediaType(value);
        return mime.equals("application/json") || mime.endsWith("+json") || mime.equals("application/graphql")
                || mime.equals("application/xml") || mime.endsWith("+xml")
                || mime.equals("application/x-protobuf") || mime.equals("application/grpc");
    }

    private static boolean isApiFetch(RequestRecord record) {
        String dest = lower(record.secFetchDest);
        String mode = lower(record.secFetchMode);
        return dest.equals("empty") && (mode.equals("cors") || mode.equals("same-origin"));
    }

    private static boolean mimeMatchesDestination(String mime, String destination) {
        if (mime.isBlank()) return false;
        return switch (destination) {
            case "script" -> mime.contains("javascript") || mime.equals("application/wasm");
            case "style" -> mime.equals("text/css");
            case "image" -> mime.startsWith("image/");
            case "font" -> mime.startsWith("font/") || mime.contains("font") || mime.contains("woff");
            case "audio" -> mime.startsWith("audio/");
            case "video", "track" -> mime.startsWith("video/") || mime.equals("text/vtt");
            case "manifest" -> mime.contains("manifest");
            default -> false;
        };
    }

    private static boolean mimeMatchesExtension(String mime, String extension) {
        if (mime.isBlank()) return false;
        if (Set.of("js", "mjs").contains(extension)) return mime.contains("javascript");
        if (extension.equals("map")) return mime.equals("application/json");
        if (extension.equals("css")) return mime.equals("text/css");
        if (Set.of("png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "avif", "bmp").contains(extension)) {
            return mime.startsWith("image/");
        }
        if (Set.of("woff", "woff2", "ttf", "eot").contains(extension)) return mime.startsWith("font/") || mime.contains("font") || mime.contains("woff");
        if (extension.equals("mp3")) return mime.startsWith("audio/");
        return Set.of("mp4", "webm").contains(extension) && mime.startsWith("video/");
    }

    private static boolean isSafe(String method) {
        return "GET".equals(method) || "HEAD".equals(method);
    }

    private static boolean isUnsafe(String method) {
        return Set.of("POST", "PUT", "PATCH", "DELETE").contains(method);
    }

    private static String mediaType(String value) {
        String lower = lower(value);
        int semicolon = lower.indexOf(';');
        return semicolon < 0 ? lower : lower.substring(0, semicolon).trim();
    }

    private static String extension(String path) {
        String value = lower(path);
        int slash = value.lastIndexOf('/');
        String last = slash < 0 ? value : value.substring(slash + 1);
        int dot = last.lastIndexOf('.');
        return dot > 0 && dot < last.length() - 1 ? last.substring(dot + 1) : "";
    }

    private static String lower(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }

    private static TrafficClassification result(TrafficClass type, Disposition disposition,
                                                boolean override, String... reasons) {
        return new TrafficClassification(type, disposition, List.of(reasons), override);
    }
}
