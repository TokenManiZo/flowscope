package io.flowscope;

import io.flowscope.core.*;
import io.flowscope.core.parameter.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static io.flowscope.core.parameter.ParameterObservation.*;
import static org.junit.jupiter.api.Assertions.*;

class ParameterExtractorTest {
    @Test void repeated_path_placeholders_are_independent_scalar_slots() {
        var first = ParameterExtractor.extract(normalized("/orders/101/items/202", null, null, null));
        var orderChanged = ParameterExtractor.extract(normalized("/orders/303/items/202", null, null, null));
        var itemChanged = ParameterExtractor.extract(normalized("/orders/101/items/404", null, null, null));
        assertKeys(first, "PATH:/segments/1", "PATH:/segments/3");
        assertTrue(first.observations().stream().allMatch(o -> o.shape() == Shape.SCALAR));
        assertNotEquals(at(first,"PATH:/segments/1").value().digest(), at(orderChanged,"PATH:/segments/1").value().digest());
        assertEquals(at(first,"PATH:/segments/3").value().digest(), at(orderChanged,"PATH:/segments/3").value().digest());
        assertEquals(at(first,"PATH:/segments/1").value().digest(), at(itemChanged,"PATH:/segments/1").value().digest());
        assertNotEquals(at(first,"PATH:/segments/3").value().digest(), at(itemChanged,"PATH:/segments/3").value().digest());
    }

    @Test void sensitive_omissions_are_counted_per_supported_location_without_names_values_or_digests() {
        var requests = List.of(
                normalized("/password/101", null, null, null),
                normalized("/orders", "password=private&token=private", null, null),
                normalized("/orders", null, "application/x-www-form-urlencoded", "password=private&token=private"),
                normalized("/orders", null, "application/json", "{\"password\":{\"nested\":\"private\"},\"safe\":true}"),
                normalized("/graphql", null, "application/json", "{\"variables\":{\"password\":\"private\"}}"),
                normalized("/orders", null, "multipart/form-data; boundary=b", "--b\r\nContent-Disposition: form-data; name=\"password\"\r\n\r\nprivate\r\n--b--\r\n"),
                normalized("/orders", null, "application/xml", "<root><password>private</password></root>"),
                normalized("/orders", null, "application/xml", "<password>private</password>"));
        var expected = List.of(1, 2, 2, 1, 1, 1, 1, 1);
        for (int i = 0; i < requests.size(); i++) {
            var extracted = ParameterExtractor.extract(requests.get(i));
            assertEquals(expected.get(i), extracted.diagnostics().stream()
                    .filter(d -> d.reasonCode().equals("SENSITIVE_PARAMETER_OMITTED")).mapToInt(ParameterDiagnostic::droppedCount).sum(), "location " + i);
            assertFalse(extracted.observations().toString().contains("private"));
            assertFalse(extracted.diagnostics().toString().contains("private"));
        }
    }

    @Test void extracts_path_query_and_named_json_containers_with_evidence_metadata() {
        RequestRecord r = normalized("/api/orders/101", "sort=DESC&tag=a&tag=b", "application/json",
                "{\"filter\":{\"keyword\":\"phone\"},\"items\":[{\"product_id\":7}]}");
        var result = ParameterExtractor.extract(r);
        assertKeys(result, "PATH:/segments/2", "QUERY:/sort", "QUERY:/tag", "JSON_BODY:/filter",
                "JSON_BODY:/filter/keyword", "JSON_BODY:/items", "JSON_BODY:/items/*", "JSON_BODY:/items/*/product_id");
        assertEquals(Shape.OBJECT, at(result, "JSON_BODY:/filter").shape());
        assertEquals(Shape.ARRAY, at(result, "JSON_BODY:/items").shape());
        assertEquals(Shape.ARRAY, at(result, "QUERY:/tag").shape());
        assertTrue(result.observations().stream().allMatch(o -> o.evidenceId().equals("ev-1")
                && o.runId().equals("run-1") && o.source() == Source.HUMAN && o.role() == AccessRole.USER
                && o.phase() == RunPhase.EXPLORATION && o.confidence() == Confidence.OBSERVED));
    }

    @Test void decodes_query_names_values_and_preserves_empty_values_and_pointer_escaping() {
        var result = ParameterExtractor.extract(normalized("/orders", "q=hello+world&empty=&flag&a%2Fb=%ED%95%9C&%74oken=hidden", null, null));
        assertKeys(result, "QUERY:/q", "QUERY:/empty", "QUERY:/flag", "QUERY:/a~1b");
        assertEquals("hello world", at(result, "QUERY:/q").value().maskedPreview());
        assertEquals(0, at(result, "QUERY:/empty").value().byteLength());
        assertEquals(3, at(result, "QUERY:/a~1b").value().byteLength());
    }

    @Test void extracts_urlencoded_form_values_independently_from_query() {
        var result = ParameterExtractor.extract(normalized("/orders", "q=x", "application/x-www-form-urlencoded",
                "q=a%2Bb&empty=&password=hidden"));
        assertKeys(result, "QUERY:/q", "FORM:/q", "FORM:/empty");
        assertEquals("a+b", at(result, "FORM:/q").value().maskedPreview());
    }

    @Test void preserves_explicit_null_empty_containers_and_scalar_array_shapes() {
        var result = ParameterExtractor.extract(normalized("/orders", null, "application/json",
                "{\"nil\":null,\"list\":[1,2],\"empty\":[],\"object\":{}}"));
        assertKeys(result, "JSON_BODY:/nil", "JSON_BODY:/list", "JSON_BODY:/list/*", "JSON_BODY:/empty", "JSON_BODY:/object");
        assertEquals(Presence.EXPLICIT_NULL, at(result, "JSON_BODY:/nil").presence());
        assertEquals(Shape.NULL, at(result, "JSON_BODY:/nil").shape());
        assertEquals(Shape.SCALAR, at(result, "JSON_BODY:/list/*").shape());
        assertEquals(ValueType.INTEGER, at(result, "JSON_BODY:/list/*").value().type());
        assertEquals("[1,2]", at(result, "JSON_BODY:/list/*").value().maskedPreview());
        assertNull(at(result, "JSON_BODY:/object").value());
    }

    @Test void graphql_variables_have_their_own_location_without_query_document_values() {
        var result = ParameterExtractor.extract(normalized("/graphql", null, "application/json",
                "{\"operationName\":\"Lookup\",\"query\":\"query Lookup { x }\",\"variables\":{\"filter\":{\"id\":7},\"token\":\"hidden\"}}"));
        assertKeys(result, "GRAPHQL_VARIABLE:/filter", "GRAPHQL_VARIABLE:/filter/id");
    }

    @Test void json_textual_and_numeric_values_keep_actual_types_and_distinct_digests() {
        var text = ParameterExtractor.extract(normalized("/orders", null, "application/json", "{\"code\":\"1\",\"id\":\"550e8400-e29b-41d4-a716-446655440000\"}"));
        var number = ParameterExtractor.extract(normalized("/orders", null, "application/json", "{\"code\":1}"));
        assertEquals(ValueType.STRING, at(text, "JSON_BODY:/code").value().type(), "\"1\"은 STRING");
        assertEquals(ValueType.INTEGER, at(number, "JSON_BODY:/code").value().type(), "1은 INTEGER");
        // digest는 원문 스칼라 기준(PR#11 권한 연결의 exact scalar 매칭 계약)이라 같을 수 있다; 타입 차이는 type과
        // Surface의 distinct 계수가 보존한다.
        assertEquals(at(text, "JSON_BODY:/code").value().digest(), at(number, "JSON_BODY:/code").value().digest());
        assertEquals(ValueType.STRING, at(text, "JSON_BODY:/id").value().type(), "UUID 형식 신호가 실제 타입을 덮어쓰지 않는다");
    }

    @Test void multipart_extracts_text_fields_without_file_bytes() {
        String body = "--x\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\nhello\r\n"
                + "--x\r\nContent-Disposition: form-data; name=\"upload\"; filename=\"a.txt\"\r\nContent-Type: text/plain\r\n\r\nFILE-CONTENT\r\n"
                + "--x\r\nContent-Disposition: form-data; name=\"token\"\r\n\r\nhidden\r\n--x--\r\n";
        var result = ParameterExtractor.extract(normalized("/orders", null, "multipart/form-data; boundary=\"x\"", body));
        assertKeys(result, "MULTIPART_FIELD:/title");
        assertEquals("hello", result.observations().getFirst().value().maskedPreview());
        assertFalse(result.toString().contains("FILE-CONTENT"));
    }

    @Test void xml_extracts_namespace_aware_elements_and_attributes_without_sensitive_descendants() {
        var result = ParameterExtractor.extract(normalized("/orders", null, "application/xml",
                "<root xmlns:n=\"urn:items\" id=\"1\"><n:item enabled=\"true\"><name>a</name></n:item><password><nested>hidden</nested></password></root>"));
        assertKeys(result, "XML_PATH:/@id", "XML_PATH:/{urn:items}item", "XML_PATH:/{urn:items}item/@enabled", "XML_PATH:/{urn:items}item/name");
        assertEquals(Shape.OBJECT, at(result, "XML_PATH:/{urn:items}item").shape());
    }

    @Test void xml_doctype_is_rejected_without_exposing_parser_messages() {
        var result = ParameterExtractor.extract(normalized("/orders", null, "application/xml",
                "<!DOCTYPE root [<!ENTITY blocked SYSTEM 'file:///nonexistent-parameter-fixture'>]><root>&blocked;</root>"));
        assertTrue(result.observations().isEmpty());
        assertEquals("INVALID_XML", result.diagnostics().getFirst().reasonCode());
        assertFalse(result.toString().contains("nonexistent-parameter-fixture"));
    }

    @Test void invalid_json_is_rejected_without_exception_text_or_partial_observations() {
        var result = ParameterExtractor.extract(normalized("/orders", "safe=ok", "application/json", "{\"first\":1,\"broken\":"));
        assertKeys(result, "QUERY:/safe");
        assertEquals("INVALID_JSON", result.diagnostics().getFirst().reasonCode());
        assertFalse(result.toString().contains("broken"));
    }

    @Test void body_input_limit_accepts_exactly_one_million_characters_and_rejects_the_next() {
        var accepted = ParameterExtractor.extract(normalized("/orders", null, "application/json", "{\"x\":\"" + "a".repeat(999_992) + "\"}"));
        assertKeys(accepted, "JSON_BODY:/x");
        assertEquals(999_992, accepted.observations().getFirst().value().byteLength());
        var rejected = ParameterExtractor.extract(normalized("/orders", null, "application/json", "{\"x\":\"" + "a".repeat(999_993) + "\"}"));
        assertTrue(rejected.observations().isEmpty());
        assertEquals("INPUT_LIMIT", rejected.diagnostics().getFirst().reasonCode());
    }

    @Test void json_depth_128_is_accepted_and_129_is_rejected() {
        assertEquals(128, ParameterExtractor.extract(normalized("/orders", null, "application/json",
                "{\"x\":".repeat(128) + "1" + "}".repeat(128))).observations().size());
        var rejected = ParameterExtractor.extract(normalized("/orders", null, "application/json",
                "{\"x\":".repeat(129) + "1" + "}".repeat(129)));
        assertTrue(rejected.observations().isEmpty());
        assertEquals("JSON_LIMIT", rejected.diagnostics().getFirst().reasonCode());
    }

    @Test void parameter_path_limit_preserves_ten_thousand_and_reports_only_dropped_count() {
        String query = java.util.stream.IntStream.range(0, 10_001).mapToObj(i -> "p" + i + "=x").collect(Collectors.joining("&"));
        var result = ParameterExtractor.extract(normalized("/orders", query, null, null));
        assertEquals(10_000, result.observations().size());
        assertEquals(new ParameterDiagnostic("https://example.test:443 POST /orders", "PARAMETER_LIMIT", 1), result.diagnostics().getFirst());
    }

    @Test void visited_node_limit_bounds_repeated_values_that_do_not_add_new_paths() {
        var result = ParameterExtractor.extract(normalized("/orders", null, "application/json",
                "[" + "0,".repeat(100_000) + "0]"));
        assertTrue(result.diagnostics().stream().anyMatch(d -> d.reasonCode().equals("NODE_LIMIT")));
        assertTrue(result.observations().size() <= 1);
    }

    @Test void scalar_summary_uses_utf8_sha256_and_masked_bounded_preview() {
        var result = ParameterExtractor.extract(normalized("/orders", "x=abc&long=" + "a".repeat(80) + "&note=token%3Dhidden", null, null));
        var summary = at(result, "QUERY:/x").value();
        assertEquals(3, summary.byteLength());
        assertEquals("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", summary.digest());
        assertEquals("abc", summary.maskedPreview());
        assertEquals(64, at(result, "QUERY:/long").value().maskedPreview().length());
        assertEquals("token=***MASKED***", at(result, "QUERY:/note").value().maskedPreview());
    }

    @Test void full_scalar_and_nested_encoded_secret_expressions_never_produce_a_digest() {
        for (String suffix : List.of("token=late-private-value", "token%3Dlate-private-value", "token%253Dlate-private-value")) {
            String value = "a".repeat(80) + " " + suffix;
            var result = ParameterExtractor.extract(normalized("/orders", "note=" + java.net.URLEncoder.encode(value,
                    java.nio.charset.StandardCharsets.UTF_8), null, null));
            var summary = result.observations().getFirst().value();
            assertNull(summary.digest());
            assertTrue(summary.maskedPreview().length() <= 64);
            assertFalse(result.toString().contains("late-private-value"));
        }
    }

    @Test void repeated_values_use_ordered_sequence_summary_and_mixed_types_are_unknown() {
        var result = ParameterExtractor.extract(normalized("/orders", "x=a&x=b", "application/json", "{\"list\":[1,\"two\"]}"));
        assertEquals("[\"a\",\"b\"]", at(result, "QUERY:/x").value().maskedPreview());
        assertEquals(9, at(result, "QUERY:/x").value().byteLength());
        assertEquals(ValueType.UNKNOWN, at(result, "JSON_BODY:/list/*").value().type());
        assertNotEquals(at(result, "QUERY:/x").value().digest(), at(ParameterExtractor.extract(normalized("/orders", "x=b&x=a", null, null)), "QUERY:/x").value().digest());
    }

    @Test void repeated_json_wildcards_preserve_element_shapes_and_count_only_changes_context() {
        var one = ParameterExtractor.extract(normalized("/orders", null, "application/json", "{\"items\":[{\"id\":1}]}"));
        var repeated = ParameterExtractor.extract(normalized("/orders", "x=1&x=2", "application/json", "{\"items\":[{\"id\":1},{\"id\":2}]}"));
        assertEquals(Shape.ARRAY, at(repeated, "JSON_BODY:/items").shape());
        assertEquals(Shape.OBJECT, at(repeated, "JSON_BODY:/items/*").shape());
        assertEquals(Shape.SCALAR, at(repeated, "JSON_BODY:/items/*/id").shape());
        assertEquals(ValueType.INTEGER, at(repeated, "JSON_BODY:/items/*/id").value().type());
        assertEquals(Shape.ARRAY, at(repeated, "QUERY:/x").shape());
        var form = ParameterExtractor.extract(normalized("/orders", null, "application/x-www-form-urlencoded", "x=1&x=2"));
        assertEquals(Shape.ARRAY, at(form, "FORM:/x").shape());
        var sameFieldsRepeated = ParameterExtractor.extract(normalized("/orders", null, "application/json", "{\"items\":[{\"id\":1},{\"id\":2}]}"));
        assertNotEquals(one.observations().getFirst().contextSignature(), sameFieldsRepeated.observations().getFirst().contextSignature());
        var graph = ParameterExtractor.extract(normalized("/graphql", null, "application/json", "{\"variables\":{\"items\":[1,2]}}"));
        assertEquals(Shape.SCALAR, at(graph, "GRAPHQL_VARIABLE:/items/*").shape());
    }

    @Test void mixed_json_wildcard_shapes_are_explicitly_unknown_without_losing_presence() throws Exception {
        var mixed = ParameterExtractor.extract(normalized("/orders", null, "application/json", "{\"items\":[{\"id\":1},2,null]}"));
        var element = at(mixed, "JSON_BODY:/items/*");
        assertEquals("UNKNOWN", element.shape().name());
        assertEquals(Presence.PRESENT, element.presence());
        assertNull(element.value()); // Mixed container subtrees must not be re-serialized into a scalar summary.
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        assertEquals(mixed, mapper.readValue(mapper.writeValueAsString(mixed), ParameterExtraction.class));
        var scalarTypes = ParameterExtractor.extract(normalized("/orders", null, "application/json", "{\"items\":[1,\"two\"]}"));
        assertEquals(Shape.SCALAR, at(scalarTypes, "JSON_BODY:/items/*").shape());
        assertEquals(ValueType.UNKNOWN, at(scalarTypes, "JSON_BODY:/items/*").value().type());
    }

    @Test void shared_context_signature_tracks_presence_shape_count_and_explicit_state_not_values() {
        var a = ParameterExtractor.extract(normalized("/orders", "x=a&y=b", null, null));
        var b = ParameterExtractor.extract(normalized("/orders", "y=c&x=d", null, null));
        String context = a.observations().getFirst().contextSignature();
        assertTrue(context.matches("ctx:v1:sha256:[0-9a-f]{64}"));
        assertTrue(a.observations().stream().allMatch(o -> context.equals(o.contextSignature())));
        assertEquals(context, b.observations().getFirst().contextSignature());
        assertNotEquals(context, ParameterExtractor.extract(normalized("/orders", "x=a&y=b&x=c", null, null)).observations().getFirst().contextSignature());
        var otherRole = normalized("/orders", "x=a&y=b", null, null);
        otherRole.role = AccessRole.UNKNOWN;
        assertNotEquals(context, ParameterExtractor.extract(otherRole).observations().getFirst().contextSignature());
    }

    @Test void sensitive_paths_and_descendants_never_emit_names_values_or_digests() {
        var result = ParameterExtractor.extract(normalized("/orders", "token=hidden&keyword=x", "application/json",
                "{\"password\":\"hidden\",\"Authorization\":\"hidden\",\"session\":{\"nested\":7},\"safe\":1}"));
        assertKeys(result, "QUERY:/keyword", "JSON_BODY:/safe");
        assertEquals(List.of(new ParameterDiagnostic("https://example.test:443 POST /orders", "SENSITIVE_PARAMETER_OMITTED", 4)), result.diagnostics());
        assertFalse(result.toString().contains("hidden"));
        assertFalse(result.toString().toLowerCase().contains("password"));
    }

    @Test void extraction_results_defensively_copy_input_lists() {
        var diagnostics = new ArrayList<ParameterDiagnostic>();
        var result = new ParameterExtraction(List.of(), diagnostics);
        diagnostics.add(new ParameterDiagnostic("POST /orders", "INVALID_JSON", 1));
        assertTrue(result.diagnostics().isEmpty());
        assertThrows(UnsupportedOperationException.class, () -> result.diagnostics().add(diagnostics.getFirst()));
    }

    @Test void repeated_scalar_previews_mask_embedded_secret_labels_inside_json_strings() {
        var result = ParameterExtractor.extract(normalized("/orders", "note=token%3DHIDDEN-REPEATED&note=safe", null, null));
        assertFalse(result.toString().contains("HIDDEN-REPEATED"));
        assertTrue(result.observations().getFirst().value().maskedPreview().contains("***MASKED***"));
    }

    @Test void masking_expansion_at_preview_boundary_never_exceeds_sixty_four_characters() {
        var result = ParameterExtractor.extract(normalized("/orders", "note=" + "a".repeat(55) + "+token%3DHIDDEN-BOUNDARY", null, null));
        String preview = result.observations().getFirst().value().maskedPreview();
        assertTrue(preview.length() <= 64);
        assertTrue(ParameterExtractor.isSafeMaskedPreview(preview), "truncation must not leave an unsafe partial marker");
        assertFalse(result.toString().contains("HIDDEN-BOUNDARY"));
    }

    @Test void sensitive_xml_document_root_excludes_its_descendant_values() {
        var result = ParameterExtractor.extract(normalized("/orders", null, "application/xml", "<password><nested>HIDDEN-ROOT</nested></password>"));
        assertTrue(result.observations().isEmpty());
        assertFalse(result.toString().contains("HIDDEN-ROOT"));
    }

    @Test void multipart_binary_parts_without_filename_are_not_text_fields() {
        String body = "--x\r\nContent-Disposition: form-data; name=\"blob\"\r\nContent-Type: application/octet-stream\r\n\r\nBINARY-FIXTURE\r\n--x--\r\n";
        var result = ParameterExtractor.extract(normalized("/orders", null, "multipart/form-data; boundary=x", body));
        assertTrue(result.observations().isEmpty());
    }

    @Test void malformed_path_encoding_produces_raw_free_diagnostic_without_throwing() {
        var record = normalized("/orders/%ZZ", null, null, null);
        record.op = record.service + " POST /orders/{id}";
        var result = ParameterExtractor.extract(record);
        assertTrue(result.observations().isEmpty());
        assertTrue(result.diagnostics().stream().anyMatch(d -> d.reasonCode().equals("INVALID_ENCODING")));
    }

    @Test void aggregate_coordinate_budget_bounds_shared_prefixes_and_stops_deterministically() {
        String name = "a".repeat(4_000);
        String children = java.util.stream.IntStream.range(0, 500).mapToObj(i -> "\"p" + i + "\":1").collect(Collectors.joining(","));
        var record = normalized("/orders", null, "application/json", "{\"" + name + "\":{" + children + "},\"later\":3}");
        var first = ParameterExtractor.extract(record);
        var second = ParameterExtractor.extract(record);
        assertTrue(first.observations().size() > 0 && first.observations().size() < 250);
        assertTrue(coordinateCost(first) <= 1_000_000);
        assertEquals(first, second);
        assertEquals(new ParameterDiagnostic(record.op, "COORDINATE_LIMIT", 502 - first.observations().size()), first.diagnostics().getFirst());
    }

    @Test void encoded_sensitive_query_name_with_invalid_suffix_is_never_retained() {
        var result = ParameterExtractor.extract(normalized("/orders", "token%ZZ=x&safe=ok", null, null));
        assertKeys(result, "QUERY:/safe");
        assertEquals("INVALID_ENCODING", result.diagnostics().getFirst().reasonCode());
    }

    @Test void observed_named_path_template_is_used_and_path_plus_is_not_form_decoded() {
        var record = normalized("/orders/abc+xyz", null, null, null);
        record.op = record.service + " POST /orders/{orderId}";
        var result = ParameterExtractor.extract(record);
        assertKeys(result, "PATH:/segments/1");
        assertEquals("abc+xyz", result.observations().getFirst().value().maskedPreview());
    }

    @Test void oversized_operation_is_rejected_without_echoing_or_hashing_its_metadata() {
        var record = normalized("/orders", "safe=ok", null, null);
        record.op = "OVERSIZED-METADATA-" + "a".repeat(8_192);
        var result = ParameterExtractor.extract(record);
        assertTrue(result.observations().isEmpty());
        assertEquals(List.of(new ParameterDiagnostic("UNKNOWN_OPERATION", "COORDINATE_LIMIT", 1)), result.diagnostics());
        assertFalse(result.toString().contains("OVERSIZED-METADATA"));
    }

    @Test void repeated_operation_metadata_counts_toward_the_aggregate_coordinate_budget() {
        String query = java.util.stream.IntStream.range(0, 300).mapToObj(i -> "p" + i + "=x").collect(Collectors.joining("&"));
        var record = normalized("/orders", query, null, null);
        record.op = record.service + " POST /" + "a".repeat(8_000);
        var result = ParameterExtractor.extract(record);
        assertTrue(result.observations().size() > 0 && result.observations().size() < 300);
        assertTrue(coordinateCost(result) <= 1_000_000);
        assertEquals("COORDINATE_LIMIT", result.diagnostics().getFirst().reasonCode());
    }

    @Test void oversized_parameter_path_is_not_retained_in_observations_or_diagnostics() {
        var result = ParameterExtractor.extract(normalized("/orders", "oversized" + "a".repeat(8_192) + "=x&later=ok", null, null));
        assertTrue(result.observations().isEmpty());
        assertEquals("COORDINATE_LIMIT", result.diagnostics().getFirst().reasonCode());
        assertFalse(result.toString().contains("oversized"));
    }

    private static int coordinateCost(ParameterExtraction result) {
        return result.observations().stream().mapToInt(o -> o.key().service().length() + o.key().method().length()
                + o.key().operation().length() + o.key().location().name().length() + o.key().canonicalPath().length()).sum();
    }

    @Test void acronym_prefixed_sensitive_query_and_json_paths_are_omitted_entirely() {
        var result = ParameterExtractor.extract(normalized("/orders", "CSRFToken=ACRONYM-VALUE-SENTINEL&APIToken=ACRONYM-VALUE-SENTINEL", "application/json",
                "{\"APIKey\":\"ACRONYM-VALUE-SENTINEL\",\"HTTPAuthorization\":\"ACRONYM-VALUE-SENTINEL\",\"safe\":1}"));
        assertEquals(1, result.observations().size());
        assertEquals("JSON_BODY:/safe", key(result.observations().getFirst()));
        assertFalse(result.toString().contains("ACRONYM-VALUE-SENTINEL"));
        assertFalse(result.toString().contains("CSRFToken"));
        assertFalse(result.toString().contains("APIToken"));
        assertFalse(result.toString().contains("APIKey"));
        assertFalse(result.toString().contains("HTTPAuthorization"));
    }

    @Test void multipart_folded_filename_parameters_never_produce_file_observations() {
        for (String continuation : new String[]{" filename=\"a.txt\"", "\tfilename*=UTF-8''a.txt"}) {
            String body = "--x\r\nContent-Disposition: form-data; name=\"upload\";\r\n" + continuation
                    + "\r\nContent-Type: text/plain\r\n\r\nFOLDED-FILE-SENTINEL\r\n--x--\r\n";
            var result = ParameterExtractor.extract(normalized("/orders", null, "multipart/form-data; boundary=x", body));
            assertTrue(result.observations().isEmpty());
            assertFalse(result.toString().contains("FOLDED-FILE-SENTINEL"));
            assertFalse(result.toString().contains("sha256:"));
        }
    }

    @Test void repeated_same_type_json_member_rejects_the_body_without_partial_observations() {
        var result = ParameterExtractor.extract(normalized("/orders", "q=ok", "application/json",
                "{\"first\":1,\"duplicateKeySentinel\":\"DUPLICATE-VALUE-SENTINEL\",\"duplicateKeySentinel\":\"later\"}"));
        assertEquals(1, result.observations().size());
        assertEquals("QUERY:/q", key(result.observations().getFirst()));
        assertEquals("DUPLICATE_JSON_MEMBER", result.diagnostics().getFirst().reasonCode());
        assertFalse(result.toString().contains("duplicateKeySentinel"));
        assertFalse(result.toString().contains("DUPLICATE-VALUE-SENTINEL"));
    }

    @Test void mixed_type_nested_duplicate_json_member_rejects_the_body_without_key_or_value_digests() {
        var result = ParameterExtractor.extract(normalized("/graphql", null, "application/json",
                "{\"variables\":{\"first\":1,\"duplicateKeySentinel\":\"DUPLICATE-VALUE-SENTINEL\",\"duplicateKeySentinel\":42}}"));
        assertTrue(result.observations().isEmpty());
        assertEquals("DUPLICATE_JSON_MEMBER", result.diagnostics().getFirst().reasonCode());
        assertFalse(result.toString().contains("duplicateKeySentinel"));
        assertFalse(result.toString().contains("DUPLICATE-VALUE-SENTINEL"));
        assertFalse(result.toString().contains("sha256:"));
    }

    @Test void long_uppercase_json_name_is_bounded_before_retention_without_leaking_its_value() {
        var result = ParameterExtractor.extract(normalized("/orders", null, "application/json",
                "{\"" + "A".repeat(100_000) + "\":\"UPPERCASE-NAME-VALUE-SENTINEL\",\"later\":1}"));
        assertTrue(result.observations().isEmpty());
        assertEquals("COORDINATE_LIMIT", result.diagnostics().getFirst().reasonCode());
        assertEquals(2, result.diagnostics().getFirst().droppedCount());
        assertFalse(result.toString().contains("UPPERCASE-NAME-VALUE-SENTINEL"));
    }

    private static RequestRecord normalized(String path, String query, String contentType, String body) {
        var r = new RequestRecord(Source.HUMAN, "https://example.test:443", "POST", path, 200, "A");
        r.op = r.service + " " + Normalizer.normalize(r.method, r.path).op;
        r.query = query;
        r.reqBody = body;
        r.requestContentType = contentType;
        r.evidenceId = "ev-1";
        r.runId = "run-1";
        r.idn = "user-a";
        r.role = AccessRole.USER;
        r.phase = RunPhase.EXPLORATION;
        return r;
    }

    private static String key(ParameterObservation o) { return o.key().location() + ":" + o.key().canonicalPath(); }
    private static ParameterObservation at(ParameterExtraction result, String key) {
        return result.observations().stream().filter(o -> key(o).equals(key)).findFirst().orElseThrow();
    }
    private static void assertKeys(ParameterExtraction result, String... expected) {
        assertEquals(Set.of(expected), result.observations().stream().map(ParameterExtractorTest::key).collect(Collectors.toSet()));
    }
}
