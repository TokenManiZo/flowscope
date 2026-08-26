package io.flowscope;

import io.flowscope.core.ResponseEvidence;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ResponseEvidenceTest {

    @Test
    void 소유자문자열만으로_대상객체_노출을_확정하지_않는다() {
        assertFalse(ResponseEvidence.showsObject(
                "{\"owner\":\"user-a\",\"message\":\"request completed\"}",
                "https://t:443 orders:7", "user-a"));
    }

    @Test
    void 대상ID가_있으면_owner가_생략된_응답도_객체근거다() {
        assertTrue(ResponseEvidence.showsObject(
                "{\"id\":7,\"description\":\"order\"}",
                "https://t:443 orders:7", "user-a"));
    }

    @Test
    void 대상ID가_있으면_owner표현은_별도_소유자오라클에_맡긴다() {
        assertTrue(ResponseEvidence.showsObject(
                "{\"id\":7,\"owner\":\"user-b\"}",
                "https://t:443 orders:7", "user-a"));
    }

    @Test
    void 대상ID와_확정owner가_같은_객체에_있으면_객체근거다() {
        assertTrue(ResponseEvidence.showsObject(
                "{\"id\":7,\"user\":{\"email\":\"user-a\"}}",
                "https://t:443 orders:7", "user-a"));
    }
}
