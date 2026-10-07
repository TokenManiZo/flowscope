package io.flowscope;

import io.flowscope.core.Normalizer;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class NormalizerTest {

    @Test
    void 단일_id_경로() {
        Normalizer.Normalized n = Normalizer.normalize("GET", "/api/orders/101");
        assertEquals("GET /api/orders/{id}", n.op);
        assertEquals("orders:101", n.resource);
    }

    @Test
    void 부모_체인_중첩_자원() {
        // 리뷰 지적(Q4): /orders/101/items/5 와 /orders/202/items/5 가 items:5 로 충돌하면 안 됨
        Normalizer.Normalized a = Normalizer.normalize("GET", "/api/orders/101/items/5");
        Normalizer.Normalized b = Normalizer.normalize("GET", "/api/orders/202/items/5");
        assertEquals("orders:101/items:5", a.resource);
        assertEquals("orders:202/items:5", b.resource);
        assertNotEquals(a.resource, b.resource, "부모가 다르면 다른 자원이어야 한다");
        assertEquals("GET /api/orders/{id}/items/{id}", a.op);
    }

    @Test
    void uuid_id() {
        Normalizer.Normalized n =
                Normalizer.normalize("GET", "/users/2f1e8b90-7c1a-4d3e-9a2b-1c2d3e4f5a6b/profile");
        assertEquals("users:2f1e8b90-7c1a-4d3e-9a2b-1c2d3e4f5a6b", n.resource);
        assertEquals("GET /users/{id}/profile", n.op);
    }

    @Test
    void 객체없는_경로는_resource_null() {
        // F-06/F-07: 객체 없는 요청은 자원 노드를 만들지 않고 Endpoint 까지만
        Normalizer.Normalized n = Normalizer.normalize("POST", "/api/admin/invites");
        assertNull(n.resource);
        assertEquals("POST /api/admin/invites", n.op);
    }

    @Test
    void 신원은_선택세션으로_결정적() {
        List<RequestRecord> recs = List.of(
                new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/a", 200, "AAA"),
                new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/b", 200, "ADM"),
                new RequestRecord(Source.SCANNER, "https://t:443", "GET", "/c", 200, "BBB"),
                new RequestRecord(Source.SCANNER, "https://t:443", "GET", "/d", 200, "AAA")
        );
        recs.get(0).collectionAccountId = "user-a";
        recs.get(1).collectionAccountId = "user-b";
        if (recs.size() > 2) {
            recs.get(2).collectionAccountId = "user-c";
            recs.get(3).collectionAccountId = "user-a";
        }
        Normalizer.assignIdentities(recs);
        assertEquals("user-a", recs.get(0).idn);
        assertEquals("user-b", recs.get(1).idn);
        assertEquals("user-c", recs.get(2).idn);
        assertEquals("user-a", recs.get(3).idn, "같은 선택 세션은 같은 신원");
    }

    @Test
    void 다른_서비스의_같은_subject도_선택한_세션을_사용한다() {
        List<RequestRecord> recs = List.of(
                new RequestRecord(Source.HUMAN, "https://a:443", "GET", "/", 200, "sub:42"),
                new RequestRecord(Source.HUMAN, "https://b:443", "GET", "/", 200, "sub:42"));
        recs.get(0).collectionAccountId = "user-a";
        recs.get(1).collectionAccountId = "user-b";
        if (recs.size() > 2) {
            recs.get(2).collectionAccountId = "user-c";
            recs.get(3).collectionAccountId = "user-a";
        }
        Normalizer.assignIdentities(recs);
        assertNotEquals(recs.get(0).idn, recs.get(1).idn);
    }
}
