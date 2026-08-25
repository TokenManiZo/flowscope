package io.flowscope;

import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.core.TrafficFilter;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class TrafficFilterTest {

    private RequestRecord rec(String method, String path) {
        return new RequestRecord(Source.HUMAN, "https://t:443", method, path, 200, "AAA");
    }

    @Test
    void 정적자산은_노이즈() {
        assertTrue(TrafficFilter.isNoise(rec("GET", "/static/app.4f3a2b.js")));
        assertTrue(TrafficFilter.isNoise(rec("GET", "/assets/main.css")));
        assertTrue(TrafficFilter.isNoise(rec("GET", "/favicon.ico")));
        assertTrue(TrafficFilter.isNoise(rec("GET", "/images/thumb/12.png")));
        assertTrue(TrafficFilter.isNoise(rec("GET", "/robots.txt")));
    }

    @Test
    void 애널리틱스는_노이즈() {
        assertTrue(TrafficFilter.isNoise(rec("POST", "/collect")));
        assertTrue(TrafficFilter.isNoise(rec("GET", "/gtag/js")));
    }

    @Test
    void 진짜_api는_노이즈_아님() {
        assertFalse(TrafficFilter.isNoise(rec("GET", "/api/orders/101")));
        assertFalse(TrafficFilter.isNoise(rec("GET", "/api/users/5")));
        assertFalse(TrafficFilter.isNoise(rec("POST", "/graphql")));
        assertFalse(TrafficFilter.isNoise(rec("GET", "/api/orders/101/items/5")));
    }
}
