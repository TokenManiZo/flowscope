package io.flowscope;

import io.flowscope.core.*;
import io.flowscope.core.graph.ObservedObjectProjection;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ObservedObjectProjectionTest {
    @Test void integerPathLabelsPreserveOrderAndNumberOnlyOpaqueObjects() {
        var records = List.of(record("/orders/001", 1), record("/orders/abc123", 2),
                record("/orders/9007199254740993123456789", 3), record("/orders/def456", 4));
        var observations = ObservedObjectProjection.build(records);
        assertEquals(List.of(1,2,3,4), observations.stream().map(ObservedObjectProjection.ObjectObservation::ordinal).toList());
        assertEquals(Arrays.asList("001", null, "9007199254740993123456789", null),
                observations.stream().map(ObservedObjectProjection.ObjectObservation::integerLabel).toList());
        assertEquals(List.of(0,1,0,2), observations.stream().map(ObservedObjectProjection.ObjectObservation::displayOrdinal).toList());
        assertEquals(4, observations.stream().map(ObservedObjectProjection.ObjectObservation::objectKey).distinct().count());
    }
    @Test void numericQueryLabelsRequireOneNonSensitiveValue() {
        for (String query : List.of("id=001", "id=9007199254740993123456789", "id=-10")) {
            var r = record("/lookup", 1); r.query = query;
            assertEquals(query.substring(3), ObservedObjectProjection.build(List.of(r)).getFirst().integerLabel());
        }
        for (String query : List.of("id=1&id=2", "id=1&page=2", "id=", "password=123", "sessionId=123", "id=abc123")) {
            var r = record("/lookup", 1); r.query = query;
            assertNull(ObservedObjectProjection.build(List.of(r)).getFirst().integerLabel(), query);
        }
    }
    @Test void numericBodyLabelsNeverSummarizeCompositeOrSensitiveBodies() {
        for (String body : List.of("{\"id\":9007199254740993123456789}", "{\"id\":\"001\"}", "{\"data\":{\"id\":-10}}")) {
            var r = record("/lookup", 1); r.reqBody = body;
            assertNotNull(ObservedObjectProjection.build(List.of(r)).getFirst().integerLabel(), body);
        }
        for (String body : List.of("{\"id\":1,\"quantity\":2}", "{\"id\":[1]}", "[{\"id\":1}]", "{\"password\":123}", "{\"id\":1.5}")) {
            var r = record("/lookup", 1); r.reqBody = body;
            assertNull(ObservedObjectProjection.build(List.of(r)).getFirst().integerLabel(), body);
        }
        var form = record("/lookup", 1); form.requestContentType = "application/x-www-form-urlencoded"; form.reqBody = "id=001";
        assertEquals("001", ObservedObjectProjection.build(List.of(form)).getFirst().integerLabel());
        form.reqBody = "id=" + "9".repeat(80);
        assertNull(ObservedObjectProjection.build(List.of(form)).getFirst().integerLabel(), "truncated previews must not become labels");
    }

    @Test void onlySuccessfulResponsesCreateObjectsOrCorroboratePaths() {
        var success = record("/orders/101", 1);
        for (int status : List.of(100, 302, 304, 401, 403, 404, 500)) {
            var failed = record("/orders/202", 2, Source.HUMAN, status);
            failed.query = "page=1";
            failed.reqBody = "{\"orderId\":202}";
            assertTrue(ObservedObjectProjection.build(List.of(success, failed)).isEmpty(),
                    "failed traffic must not create query/body objects or corroborate a path: " + status);
        }
        var created = record("/orders/202", 2, Source.HUMAN, 201);
        created.query = "page=1"; created.reqBody = "{\"orderId\":202}";
        var observations = ObservedObjectProjection.build(List.of(success, created));
        assertEquals(2, observations.stream().filter(o -> o.kind().equals("PATH")).count());
        assertEquals(Set.of("PATH", "QUERY", "REQUEST_BODY"),
                new HashSet<>(observations.stream().map(ObservedObjectProjection.ObjectObservation::kind).toList()));
        var failed = record("/orders/202", 2, Source.HUMAN, 404);
        var secondSuccess = record(success.path, 3); secondSuccess.idn = "user-b";
        var confirmed = ObservedObjectProjection.build(List.of(success, secondSuccess, failed));
        assertEquals(2, confirmed.size());
        assertTrue(confirmed.stream().noneMatch(o -> o.eventId().equals(failed.evidenceId)));
    }

    @Test void forbiddenAccessIsRetainedForAnObjectWithSuccessfulEvidence() {
        var success = record("/orders/101", 1);
        var forbidden = record(success.path, 2, Source.HUMAN, 403);
        for (var r : List.of(success, forbidden)) {
            r.query = "orderId=101"; r.reqBody = "{\"orderId\":101}";
        }
        var observations = ObservedObjectProjection.build(List.of(success, forbidden));
        assertEquals(6, observations.size());
        assertEquals(3, observations.stream().filter(o -> o.eventId().equals(forbidden.evidenceId)).count());
        assertEquals(3, observations.stream().map(ObservedObjectProjection.ObjectObservation::objectKey).distinct().count());
        assertTrue(ObservedObjectProjection.build(List.of(forbidden)).isEmpty());
    }

    @Test void experimentExcludesWholeResponseObjectsByDefault() {
        var r = record("/products", 1); r.body = "{\"items\":[{\"id\":1}]}";
        assertTrue(ObservedObjectProjection.build(List.of(r)).isEmpty());
        assertEquals("RESPONSE_BODY", ObservedObjectProjection.build(List.of(r), true).getFirst().kind());
    }
    @Test void ordinaryFieldNamesAreNeverSuppressedBySensitiveSubstrings() {
        for (String field : List.of("id", "orderid", "orderId", "page", "pageID", "sessionName",
                "tokenCount", "secretNumber", "authorizationStatus", "cookieCount")) {
            var a = record("/lookup", 1); a.query = field + "=1";
            var b = record("/lookup", 2); b.query = field + "=2";
            var query = ObservedObjectProjection.build(List.of(a,b));
            assertNotEquals(query.get(0).objectKey(), query.get(1).objectKey(), field);
            a.query = null; b.query = null;
            a.reqBody = "{\"" + field + "\":1}"; b.reqBody = "{\"" + field + "\":2}";
            var bodies = ObservedObjectProjection.build(List.of(a,b));
            assertNotEquals(bodies.get(0).objectKey(), bodies.get(1).objectKey(), field);
        }
    }
    @Test void sessionIdValuesDoNotCreateAdditionalObjectsAndSinglePostBodyIsVisible() {
        var a = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        a.hasResponse = true; a.evidenceId = "post-1"; a.reqBody = "{\"orderid\":1,\"sessionId\":\"one\"}";
        Normalizer.normalizeAll(List.of(a));
        var one = ObservedObjectProjection.build(List.of(a));
        assertEquals(1, one.size()); assertEquals("REQUEST_BODY", one.getFirst().kind());
        var b = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        b.hasResponse = true; b.evidenceId = "post-2"; b.reqBody = "{\"orderid\":1,\"sessionId\":\"two\"}";
        Normalizer.normalizeAll(List.of(b));
        var two = ObservedObjectProjection.build(List.of(a,b));
        assertEquals(two.get(0).objectKey(), two.get(1).objectKey());
    }
    private static RequestRecord record(String path, int number) {
        return record(path, number, Source.HUMAN);
    }
    private static RequestRecord record(String path, int number, Source source) {
        return record(path, number, source, 200);
    }
    private static RequestRecord record(String path, int number, Source source, int status) {
        var r = new RequestRecord(source, "https://t:443", "GET", path, status, "A");
        r.hasResponse = true; r.evidenceId = "event-" + number; r.timestamp = number;
        r.collectionAccountId = number % 2 == 1 ? "user-a" : "user-b";
        Normalizer.normalizeAll(List.of(r));
        return r;
    }
    @Test void requiresTwoIdentitiesOrSourcesRatherThanRepeatedRequests() {
        var a = record("/posts/12313213", 1);
        assertTrue(ObservedObjectProjection.build(List.of(a)).isEmpty());
        assertTrue(ObservedObjectProjection.build(List.of(a, a)).isEmpty());
        var b = record(a.path, 2);
        b.idn = a.idn;
        assertTrue(ObservedObjectProjection.build(List.of(a,b)).isEmpty());
        b.idn = "user-b";
        var out = ObservedObjectProjection.build(List.of(a, b));
        assertEquals(2, out.size()); assertEquals(out.getFirst().objectKey(), out.getLast().objectKey());
        assertEquals(1, out.getLast().ordinal());
    }
    @Test void separateSourcesCorroborateTheSameIdentityButRunIdsDoNot() {
        var a = record("/posts/100", 1);
        var b = record(a.path, 2); b.idn = a.idn;
        a.runId = "run-a"; b.runId = "run-b";
        assertTrue(ObservedObjectProjection.build(List.of(a,b)).isEmpty());
        for (Source source : List.of(Source.SCANNER, Source.LLM)) {
            b = record(a.path, 2, source); b.idn = a.idn;
            assertEquals(2, ObservedObjectProjection.build(List.of(a,b)).size());
        }
        b.executionTrust = ExecutionTrust.UNVERIFIED_RUNTIME;
        assertTrue(ObservedObjectProjection.build(List.of(a,b)).isEmpty());
    }
    @Test void genuineAnonymousObservationCountsButAutomaticValidationDoesNot() {
        var a = record("/posts/100", 1);
        var anon = record(a.path, 2); anon.idn = Fingerprints.ANONYMOUS;
        assertEquals(2, ObservedObjectProjection.build(List.of(a,anon)).size());
        anon = record(a.path, 2, Source.SCANNER); anon.idn = Fingerprints.ANONYMOUS;
        for (RunPhase phase : List.of(RunPhase.AUTHORIZATION_REPLAY, RunPhase.VALIDATION, RunPhase.COACH_PROBE)) {
            anon.phase = phase;
            assertTrue(ObservedObjectProjection.build(List.of(a,anon)).isEmpty());
        }
        anon.phase = RunPhase.UNKNOWN; anon.sourceDetail = SourceDetail.AUTHORIZATION_REPLAY;
        assertTrue(ObservedObjectProjection.build(List.of(a,anon)).isEmpty());
    }
    @Test void differingPathValuesCorroborateOneIdentityAndSource() {
        var a = record("/posts/opaqueA123", 1);
        var b = record("/posts/opaqueB456", 2); b.idn = a.idn;
        var out = ObservedObjectProjection.build(List.of(a,b));
        assertEquals(2, out.size());
        assertEquals(out.get(0).apiKey(), out.get(1).apiKey());
    }
    @Test void crapiStringIdsBecomeThreeObjectsAndRecentStaysAnApi() {
        var a = record("/community/posts/7bLfZ8nkq40LJuVovEVVLS", 1);
        var b = record("/community/posts/n6q4X6y6BXx7CbGKCytRii", 2);
        var c = record("/community/posts/BvFq9vBre9Bvmmk3xv6", 3);
        var recent = record("/community/posts/recent", 4);
        var out = ObservedObjectProjection.build(List.of(a, b, c, recent));
        assertEquals(3, out.size());
        assertEquals(1, out.stream().map(ObservedObjectProjection.ObjectObservation::apiKey).distinct().count());
        assertEquals(List.of(1,2,3), out.stream().map(ObservedObjectProjection.ObjectObservation::ordinal).toList());
        assertNull(a.resource, "display projection must not rewrite canonical analysis resource");
    }
    @Test void structureFindsStringIdsAndKeepsParentScopesAndFixedSuffixes() {
        var out = ObservedObjectProjection.build(List.of(record("/api/101/detail/5", 1),record("/api/101/detail/6", 2),record("/api/202/detail/1", 3),record("/api/202/detail/2", 4)));
        assertEquals(4, out.size());
        assertEquals(out.get(0).apiKey(), out.get(1).apiKey());
        assertNotEquals(out.get(0).apiKey(), out.get(2).apiKey());
        assertEquals(List.of(1,2,1,2), out.stream().map(ObservedObjectProjection.ObjectObservation::ordinal).toList());
        assertEquals("https://t:443 GET /api/{id_0}/detail/{id_1}", out.getFirst().apiFamily());
        assertTrue(out.getFirst().apiKey().endsWith("/api/101/detail/{id_1}"));
        var strings = ObservedObjectProjection.build(List.of(record("/orders/alpha/detail", 4),record("/orders/beta/detail", 5)));
        assertTrue(strings.isEmpty(), "alphabetic route parts never become objects");
    }
    @Test void postActionsWithDifferentInputSchemasStaySeparateApisWithoutPhantomPathObjects() {
        var login = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/api/auth/login", 200, "A");
        login.reqBody = "{\"email\":\"a@t\",\"password\":\"secret\"}";
        var signup = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/api/auth/signup", 200, "A");
        signup.reqBody = "{\"email\":\"a@t\",\"password\":\"secret\",\"name\":\"A\",\"number\":1}";
        var verify = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/api/auth/verify", 200, "A");
        verify.query = "token=abc";
        int i = 0;
        for (var r : List.of(login, signup, verify)) { r.hasResponse = true; r.evidenceId = "post-action-" + ++i; }
        Normalizer.normalizeAll(List.of(login, signup, verify));
        var out = ObservedObjectProjection.build(List.of(login, signup, verify));
        assertEquals(3, out.size());
        assertEquals(2, out.stream().filter(o -> "REQUEST_BODY".equals(o.kind())).count());
        assertEquals(1, out.stream().filter(o -> "QUERY".equals(o.kind())).count());
        assertEquals(3, out.stream().map(ObservedObjectProjection.ObjectObservation::apiKey).distinct().count());
    }
    @Test void actualPostQueryAndBodyRemainSeparateAndNumericPathIdsAreSupported() {
        var a = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders/101", 200, "A");
        var b = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders/202", 200, "A");
        int i = 0;
        for (var r : List.of(a,b)) { r.hasResponse = true; r.evidenceId = "post-order-" + ++i; r.reqBody = "{\"orderid\":1}"; r.query = "page=1"; }
        Normalizer.normalizeAll(List.of(a,b));
        var out = ObservedObjectProjection.build(List.of(a,b));
        assertEquals(6, out.size());
        assertEquals(Set.of("PATH", "QUERY", "REQUEST_BODY"), new HashSet<>(out.stream().map(ObservedObjectProjection.ObjectObservation::kind).toList()));
    }
    @Test void methodAndServiceAndUntrustedTrafficDoNotCorroborate() {
        var a = record("/posts/100", 1);
        var b = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/posts/200", 200, "A");
        b.hasResponse = true; b.evidenceId = "event-2"; Normalizer.normalizeAll(List.of(b));
        assertTrue(ObservedObjectProjection.build(List.of(a,b)).isEmpty());
        b = record("/posts/200", 2); b.executionTrust = ExecutionTrust.UNVERIFIED_RUNTIME;
        assertTrue(ObservedObjectProjection.build(List.of(a,b)).isEmpty());
    }
    @Test void queryObjectsUseAllFieldsAndCompareCombinationsWithoutRequiringTwoObservations() {
        var a = record("/lookup", 1); a.query = "page=1&userid=1";
        var b = record("/lookup", 2); b.query = "userid=1&page=1";
        var c = record("/lookup", 3); c.query = "page=2&userid=1";
        var out = ObservedObjectProjection.build(List.of(a,b,c));
        assertEquals(3, out.size()); assertEquals(List.of("/page", "/userid"), out.getFirst().fields());
        assertEquals(out.get(0).objectKey(), out.get(1).objectKey());
        assertEquals(List.of(1,1,2), out.stream().map(ObservedObjectProjection.ObjectObservation::ordinal).toList());
        assertEquals(1, ObservedObjectProjection.build(List.of(a)).size());
    }
    @Test void queryPreservesRepeatedValueOrderAndNeverUsesPasswordValueInObjectIdentity() {
        var a = record("/lookup", 1); a.query = "a=1&a=2&password=first-secret";
        var b = record("/lookup", 2); b.query = "a=2&a=1&password=second-secret";
        var c = record("/lookup", 3); c.query = "a=1&a=2&password=third-secret";
        var out = ObservedObjectProjection.build(List.of(a,b,c));
        assertNotEquals(out.get(0).objectKey(), out.get(1).objectKey());
        assertEquals(out.get(0).objectKey(), out.get(2).objectKey());
        assertFalse(out.toString().contains("first-secret"));
    }
    @Test void bodyCombinesNestedTypedDataWithoutUsingSensitiveValuesOrKeyOrder() {
        var a = record("/lookup", 1); a.reqBody = "{\"userID\":1,\"password\":\"one\",\"items\":[{\"id\":5}]}";
        var b = record("/lookup", 2); b.reqBody = "{\"items\":[{\"id\":5}],\"password\":\"two\",\"userID\":1}";
        var c = record("/lookup", 3); c.reqBody = "{\"userID\":\"1\",\"password\":\"three\",\"items\":[{\"id\":5}]}";
        var out = ObservedObjectProjection.build(List.of(a,b,c));
        assertEquals(3, out.size()); assertEquals("REQUEST_BODY", out.getFirst().kind());
        assertEquals(out.get(0).objectKey(), out.get(1).objectKey());
        assertNotEquals(out.get(0).objectKey(), out.get(2).objectKey());
        assertEquals(List.of("/items/*/id", "/password", "/userID"), out.getFirst().fields());
        assertEquals(1, ObservedObjectProjection.build(List.of(a)).size());
    }
    @Test void bodyKeepsArrayOrderAndParsesFormXmlAndRejectsInvalidJson() {
        var a = record("/lookup", 1); a.reqBody = "{\"ids\":[1,2]}";
        var b = record("/lookup", 2); b.reqBody = "{\"ids\":[2,1]}";
        var out = ObservedObjectProjection.build(List.of(a,b));
        assertNotEquals(out.get(0).objectKey(), out.get(1).objectKey());
        var form = record("/lookup", 3); form.requestContentType = "application/x-www-form-urlencoded"; form.reqBody = "userID=1&password=abc";
        assertEquals(1, ObservedObjectProjection.build(List.of(form)).size());
        var xml = record("/lookup", 4); xml.requestContentType = "application/xml"; xml.reqBody = "<request><id>1</id></request>";
        assertEquals(1, ObservedObjectProjection.build(List.of(xml)).size());
        var invalid = record("/lookup", 5); invalid.reqBody = "{\"id\":1,\"id\":2}";
        assertTrue(ObservedObjectProjection.build(List.of(invalid)).isEmpty());
    }
    @Test void pathQueryAndBodyAllRemainVisibleWithoutChangingCanonicalCoordinates() {
        var a = record("/orders/101", 1); a.query = "page=1"; a.reqBody = "{\"userID\":9,\"password\":\"secret\"}";
        var b = record("/orders/202", 2);
        var original = a.op + "\0" + a.resource;
        var out = ObservedObjectProjection.build(List.of(a,b));
        assertEquals(Set.of("PATH","QUERY","REQUEST_BODY"), new HashSet<>(out.stream().filter(o -> o.eventId().equals(a.evidenceId)).map(ObservedObjectProjection.ObjectObservation::kind).toList()));
        assertEquals(original, a.op + "\0" + a.resource);
    }
    @Test void parameterlessGetUsesWholeResponseRatherThanSplittingArrayItems() {
        var a = record("/products", 1); a.body = "{\"items\":[{\"id\":1},{\"id\":2}],\"total\":2}";
        var b = record("/products", 2); b.body = "{\"total\":2,\"items\":[{\"id\":1},{\"id\":2}]}";
        var c = record("/products", 3); c.body = "{\"items\":[{\"id\":2},{\"id\":1}],\"total\":2}";
        var out = ObservedObjectProjection.build(List.of(a,b,c), true);
        assertEquals(3, out.size()); assertEquals("RESPONSE_BODY", out.getFirst().kind());
        assertEquals(List.of(1,1,2), out.stream().map(ObservedObjectProjection.ObjectObservation::ordinal).toList());
        assertEquals(1, ObservedObjectProjection.build(List.of(a), true).size());
    }
    @Test void responseFallbackCannotBypassTheSinglePathGateOrDuplicateRequestObjects() {
        var a = record("/products/123", 1); a.body = "{\"id\":123}";
        assertTrue(ObservedObjectProjection.build(List.of(a), true).isEmpty());
        var b = record("/products", 2); b.query = "page=1"; b.body = "{\"id\":123}";
        assertEquals(List.of("QUERY"), ObservedObjectProjection.build(List.of(b), true).stream().map(ObservedObjectProjection.ObjectObservation::kind).toList());
        var c = record("/products", 3); c.reqBody = "{\"id\":1}"; c.body = "{\"id\":123}";
        assertEquals(List.of("REQUEST_BODY"), ObservedObjectProjection.build(List.of(c), true).stream().map(ObservedObjectProjection.ObjectObservation::kind).toList());
    }
    @Test void responseXmlIsNormalizedAndExternalEntitiesHtmlAndErrorsAreRejected() {
        var a = record("/products", 1); a.responseContentType = "application/xml"; a.body = "<items><id>1</id><password>one</password></items>";
        var b = record("/products", 2); b.responseContentType = "application/xml"; b.body = "<items>\n <id>1</id><password>two</password>\n</items>";
        var out = ObservedObjectProjection.build(List.of(a,b), true);
        assertEquals(2, out.size()); assertEquals(out.get(0).objectKey(), out.get(1).objectKey());
        var evil = record("/products", 3); evil.responseContentType = "application/xml"; evil.body = "<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><x>&e;</x>";
        assertTrue(ObservedObjectProjection.build(List.of(evil), true).isEmpty());
        var html = record("/products", 4); html.responseContentType = "text/html"; html.body = "<html><body>hello</body></html>";
        assertTrue(ObservedObjectProjection.build(List.of(html), true).isEmpty());
        var error = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/products", 500, "A"); error.hasResponse = true; error.evidenceId = "error"; error.body = "{\"error\":true}"; Normalizer.normalizeAll(List.of(error));
        assertTrue(ObservedObjectProjection.build(List.of(error), true).isEmpty());
    }

    @Test void alphabeticGetAndPostRoutesStayLiteralWithQueryAndBodyObjects() {
        var rows = new ArrayList<RequestRecord>();
        int number = 0;
        for (String method : List.of("GET", "POST")) for (String name : List.of("unsplash", "timezones", "instances")) {
            var r = new RequestRecord(Source.HUMAN, "https://t:443", method, "/api/" + name + "/", 200, "A");
            r.hasResponse = true; r.evidenceId = "literal-" + ++number;
            r.query = "query="; r.reqBody = "{\"name\":\"alice\"}";
            rows.add(r);
        }
        Normalizer.normalizeAll(rows);
        var out = ObservedObjectProjection.build(rows);
        assertEquals(12, out.size());
        assertTrue(out.stream().noneMatch(o -> "PATH".equals(o.kind())));
        for (var r : rows) for (var o : out.stream().filter(o -> r.evidenceId.equals(o.eventId())).toList())
            assertEquals(r.service + " " + r.method + " " + r.path, o.apiKey());
    }
    @Test void parentScopesAndFixedSuffixesCannotCorroborateEachOther() {
        var a = record("/orgs/10/orders/101", 1);
        var b = record("/orgs/20/orders/202", 2);
        assertTrue(ObservedObjectProjection.build(List.of(a,b)).isEmpty());
        var otherIdentity = record(a.path, 4);
        var out = ObservedObjectProjection.build(List.of(a,b,otherIdentity));
        assertEquals(2, out.size());
        assertTrue(out.stream().allMatch(o -> o.apiKey().contains("/orgs/10/orders/")));
        var detail = record("/orders/101/detail", 3);
        var history = record("/orders/202/history", 4);
        assertTrue(ObservedObjectProjection.build(List.of(detail,history)).isEmpty());
    }
    @Test void versionsStayLiteralAndRootNumericPathsAreSupported() {
        var rows = List.of(record("/api/v1/orders/101", 1),record("/api/v1/orders/202", 2),
                record("/api/v2/orders/101", 3),record("/api/v2/orders/202", 4));
        var out = ObservedObjectProjection.build(rows);
        assertEquals(4, out.size());
        assertTrue(out.stream().allMatch(o -> o.apiFamily() == null));
        assertEquals(2, out.stream().map(ObservedObjectProjection.ObjectObservation::apiKey).distinct().count());
        var root = ObservedObjectProjection.build(List.of(record("/101", 1),record("/202", 2)));
        assertEquals(2, root.size());
        assertTrue(root.getFirst().apiKey().endsWith("GET /{id}"));
    }
    @Test void encodedLettersAndLetterOnlyHexCannotBecomePathObjectsOrLeakLegacyTemplates() {
        for (String value : List.of("%61%62%63", "aaaaaaaaaaaaaaaa", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")) {
            var a = record("/items/" + value + "/", 1); a.query = "page=1";
            var b = record(a.path, 2); b.query = a.query;
            var out = ObservedObjectProjection.build(List.of(a,b));
            assertEquals(2, out.size());
            assertTrue(out.stream().allMatch(o -> "QUERY".equals(o.kind())));
            assertTrue(out.stream().allMatch(o -> o.apiKey().endsWith(a.path)));
        }
        var encoded = ObservedObjectProjection.build(List.of(record("/items/%61%62%63%31", 1),record("/items/abc2", 2)));
        assertEquals(2, encoded.size());
    }
    @Test void rawSlashVariantsAndQuerySlashesRemainDistinctFromPathParameters() {
        var a = record("/api/unsplash/", 1); a.query = "query=&file=a%2Fb";
        var b = record("/api/unsplash", 2); b.query = a.query;
        var out = ObservedObjectProjection.build(List.of(a,b));
        assertEquals(2, out.size());
        assertEquals(List.of("/file", "/query"), out.getFirst().fields());
        assertNotEquals(out.getFirst().apiKey(), out.getLast().apiKey());
        assertNotEquals(out.getFirst().objectKey(), out.getLast().objectKey());
    }
}
