package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AdvancedNormalizerTest {

    @Test
    void queryOperationDiscriminatorSeparatesControllerActionsAndKeepsObjectIdentity() {
        RequestRecord current = new RequestRecord(Source.HUMAN, "http://target:18090", "GET",
                "/modules/profile/profile_function.php", 200, "A");
        current.query = "mode=reload_current_memberships&user_uuid=user-a";
        RequestRecord future = new RequestRecord(Source.HUMAN, "http://target:18090", "GET",
                "/modules/profile/profile_function.php", 200, "B");
        future.query = "mode=reload_future_memberships&user_uuid=user-b";
        RequestRecord former = new RequestRecord(Source.HUMAN, "http://target:18090", "GET",
                "/modules/profile/profile_function.php", 200, "A");
        former.query = "mode=reload_former_memberships&user_uuid=user-a";

        Normalizer.normalizeAll(List.of(current, future, former));

        assertEquals("http://target:18090 GET /modules/profile/profile_function.php#mode=reload_current_memberships",
                current.op);
        assertEquals("http://target:18090 GET /modules/profile/profile_function.php#mode=reload_future_memberships",
                future.op);
        assertEquals("http://target:18090 GET /modules/profile/profile_function.php#mode=reload_former_memberships",
                former.op);
        assertEquals("http://target:18090 users:user-a", current.resource);
        assertEquals("http://target:18090 users:user-b", future.resource);
        var graph = io.flowscope.core.graph.FlowGraphBuilder.build(List.of(current, future, former));
        assertEquals(3, graph.nodeCount(io.flowscope.core.graph.FlowGraph.NodeType.OPERATION));
    }

    @Test
    void paginationAndObjectParametersDoNotSplitOperations() {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/users", 200, "A");
        record.query = "page=2&limit=20&userId=101";

        Normalizer.normalizeAll(List.of(record));

        assertEquals("https://t:443 GET /users", record.op);
        assertEquals("https://t:443 users:101", record.resource);
    }

    @Test
    void 쿼리의_객체ID를_추출하고_제어값은_제외한다() {
        RequestRecord r = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/api/order", 200, "A");
        r.query = "orderId=101&page=2&limit=20";
        Normalizer.normalizeAll(List.of(r));

        assertEquals("https://t:443 orders:101", r.resource);
        assertEquals("https://t:443 GET /api/order", r.op);
    }

    @Test
    void GraphQL_operationName으로_엔드포인트_붕괴를_막는다() {
        RequestRecord r = new RequestRecord(Source.LLM, "https://t:443", "POST", "/graphql", 200, "A");
        r.reqBody = "{\"operationName\":\"GetOrder\",\"variables\":{\"orderId\":202}}";
        Normalizer.normalizeAll(List.of(r));

        assertEquals("https://t:443 POST /graphql#GetOrder", r.op);
        assertEquals("https://t:443 orders:202", r.resource);
        assertEquals("GRAPHQL_VARIABLE", Normalizer.resourceEvidence(r));
    }

    @Test
    void 객체_추출_근거를_고정_신뢰도_대신_위치별로_표시한다() {
        RequestRecord path = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/orders/101", 200, "A");
        path.hasResponse = true;
        path.body = "{\"id\":101}";
        RequestRecord query = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/orders", 200, "A");
        query.query = "orderId=102";
        RequestRecord body = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        body.reqBody = "{\"orderId\":103}";
        Normalizer.normalizeAll(List.of(path, query, body));

        assertEquals("PATH_ID", Normalizer.resourceEvidence(path));
        assertEquals("QUERY_ID", Normalizer.resourceEvidence(query));
        assertEquals("BODY_ID", Normalizer.resourceEvidence(body));
    }

    @Test
    void 중첩배열_JSON과_multipart의_명시적_ID를_추출한다() {
        RequestRecord nested = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        nested.reqBody = "{\"items\":[{\"orderId\":104}]}";
        RequestRecord multipart = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        multipart.reqBody = "--x\r\nContent-Disposition: form-data; name=\"orderId\"\r\n\r\n105\r\n--x--";
        Normalizer.normalizeAll(List.of(nested, multipart));

        assertEquals("https://t:443 orders:104", nested.resource);
        assertEquals("https://t:443 orders:105", multipart.resource);
        assertEquals("BODY_ID", Normalizer.resourceEvidence(multipart));
    }

    @Test
    void query_JSON배열_XML의_모든_명시적_ID후보를_근거와_함께_보존한다() {
        RequestRecord query = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/transfer", 200, "A");
        query.query = "fromAccountId=10&toAccountId=20&page=1";
        RequestRecord json = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        json.reqBody = "{\"orderIds\":[101,102],\"items\":[{\"productId\":7}]}";
        RequestRecord xml = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        xml.reqBody = "<request><orderId>103</orderId><userId>9</userId></request>";

        Normalizer.normalizeAll(List.of(query, json, xml));

        assertEquals(List.of("https://t:443 fromaccounts:10", "https://t:443 toaccounts:20"),
                query.resourceReferences.stream().map(ResourceReference::resource).toList());
        assertEquals(List.of("https://t:443 orders:101", "https://t:443 orders:102",
                        "https://t:443 products:7"),
                json.resourceReferences.stream().map(ResourceReference::resource).toList());
        assertEquals(List.of("https://t:443 orders:103", "https://t:443 users:9"),
                xml.resourceReferences.stream().map(ResourceReference::resource).toList());
        assertTrue(json.resourceReferences.stream().allMatch(value -> value.evidence().equals("BODY_ID")));
    }

    @Test
    void 같은_위치에서_복수값이_관측된_도메인_식별자_필드를_객체로_보강한다() {
        RequestRecord first = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/lookup", 200, "A");
        first.reqBody = "{\"customerNo\":\"C-100\",\"documentSeq\":\"D-1\"}";
        RequestRecord second = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/lookup", 200, "A");
        second.reqBody = "{\"customerNo\":\"C-200\",\"documentSeq\":\"D-2\"}";

        Normalizer.normalizeAll(List.of(first, second));

        assertEquals(List.of("https://t:443 customers:C-100", "https://t:443 documents:D-1"),
                first.resourceReferences.stream().map(ResourceReference::resource).toList());
        assertTrue(first.resourceReferences.stream()
                .allMatch(value -> value.evidence().equals("BODY_SEMANTIC_FIELD_CORROBORATED")));
        assertEquals("BODY_SEMANTIC_FIELD_CORROBORATED", Normalizer.resourceEvidence(first));
    }

    @Test
    void 단일_관측이나_제어_보안_필드는_객체로_추측하지_않는다() {
        RequestRecord first = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/search", 200, "A");
        first.query = "pageNo=1&sortKey=name&apiKey=***&customerNo=C-100";
        RequestRecord secondPath = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/other", 200, "A");
        secondPath.query = "customerNo=C-200";

        Normalizer.normalizeAll(List.of(first, secondPath));

        assertNull(first.resource);
        assertTrue(first.resourceReferences.isEmpty());
        assertNull(secondPath.resource);
        assertTrue(secondPath.resourceReferences.isEmpty());
    }

    @Test
    void 같은_query_위치의_복수값은_객체로_보강하지만_일반_code는_제외한다() {
        RequestRecord first = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/lookup", 200, "A");
        first.query = "accountRef=A-1&statusCode=200";
        RequestRecord second = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/lookup", 200, "A");
        second.query = "accountRef=A-2&statusCode=201";

        Normalizer.normalizeAll(List.of(first, second));

        assertEquals("https://t:443 accounts:A-1", first.resource);
        assertEquals(List.of("QUERY_SEMANTIC_FIELD_CORROBORATED"),
                first.resourceReferences.stream().map(ResourceReference::evidence).toList());
    }

    @Test
    void id_문자열_경계가_없는_일반_단어를_명시적_ID로_오인하지_않는다() {
        RequestRecord first = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/devices", 200, "A");
        first.reqBody = "{\"guid\":\"g-1\",\"valid\":true,\"fluid\":\"oil\"}";
        RequestRecord second = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/devices", 200, "A");
        second.reqBody = "{\"guid\":\"g-2\",\"valid\":false,\"fluid\":\"water\"}";

        Normalizer.normalizeAll(List.of(first, second));

        assertEquals(List.of("https://t:443 devices:g-1"),
                first.resourceReferences.stream().map(ResourceReference::resource).toList());
        assertEquals("BODY_SEMANTIC_FIELD_CORROBORATED",
                first.resourceReferences.getFirst().evidence());
    }
}
