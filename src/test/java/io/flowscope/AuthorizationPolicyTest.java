package io.flowscope;

import io.flowscope.core.AccessRole;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.AuthorizationPolicy;
import io.flowscope.core.Fingerprints;
import io.flowscope.core.ResourcePolicy;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AuthorizationPolicyTest {
    @Test
    void 객체별_정책은_operation_기본값보다_우선한다() {
        String operation = "https://api.test:443 GET /api/orders/{id}";
        AnalysisConfig config = new AnalysisConfig()
                .withResourcePolicy(operation, ResourcePolicy.PUBLIC)
                .withResourcePolicy("https://api.test:443 orders:7", ResourcePolicy.OWNER_ONLY);

        assertEquals(ResourcePolicy.OWNER_ONLY,
                config.resourcePolicy(operation, "https://api.test:443 orders:7"));
        assertEquals(ResourcePolicy.PUBLIC,
                config.resourcePolicy(operation, "https://api.test:443 orders:8"));
        assertEquals(ResourcePolicy.UNKNOWN,
                config.resourcePolicy("https://api.test:443 GET /api/profile", null));
    }

    @Test
    void API와_객체_쌍_정책은_그_쌍에만_적용된다() {
        String read = "https://api.test:443 GET /api/orders/{id}";
        String write = "https://api.test:443 PATCH /api/orders/{id}";
        String first = "https://api.test:443 orders:101";
        String second = "https://api.test:443 orders:202";
        AnalysisConfig config = new AnalysisConfig()
                .withResourcePolicy(first, ResourcePolicy.OWNER_ONLY)
                .withResourcePolicy(AnalysisConfig.operationObjectPolicyKey(read, first), ResourcePolicy.PUBLIC);

        assertEquals(ResourcePolicy.PUBLIC, config.resourcePolicy(read, first));
        // 같은 API의 다른 객체와 같은 객체의 쓰기 요청은 그대로다(D-013).
        assertEquals(ResourcePolicy.UNKNOWN, config.resourcePolicy(read, second));
        assertEquals(ResourcePolicy.OWNER_ONLY, config.resourcePolicy(write, first));

        config.withResourcePolicy(AnalysisConfig.operationObjectPolicyKey(read, first), ResourcePolicy.UNKNOWN);
        assertEquals(ResourcePolicy.OWNER_ONLY, config.resourcePolicy(read, first));
    }

    @Test
    void 객체정책_여섯종류를_평가한다() {
        assertEquals(AuthorizationPolicy.LayerDecision.ALLOW,
                object(ResourcePolicy.PUBLIC, "user-b", AccessRole.USER, "user-a", AccessRole.USER, true));
        assertEquals(AuthorizationPolicy.LayerDecision.DENY,
                object(ResourcePolicy.OWNER_ONLY, "user-b", AccessRole.USER, "user-a", AccessRole.USER, true));
        assertEquals(AuthorizationPolicy.LayerDecision.ALLOW,
                object(ResourcePolicy.ROLE_SHARED, "user-b", AccessRole.USER, "user-a", AccessRole.USER, true));
        assertEquals(AuthorizationPolicy.LayerDecision.DENY,
                object(ResourcePolicy.ROLE_SHARED, "reviewer", AccessRole.LV1, "user-a", AccessRole.USER, true));
        assertEquals(AuthorizationPolicy.LayerDecision.ALLOW,
                object(ResourcePolicy.AUTHENTICATED_SHARED, "user-b", AccessRole.USER, null, AccessRole.UNKNOWN, false));
        assertEquals(AuthorizationPolicy.LayerDecision.DENY,
                object(ResourcePolicy.AUTHENTICATED_SHARED, Fingerprints.ANONYMOUS, AccessRole.ANONYMOUS,
                        null, AccessRole.UNKNOWN, false));
        assertEquals(AuthorizationPolicy.LayerDecision.UNKNOWN,
                object(ResourcePolicy.AUTHENTICATED_SHARED, "unresolved", AccessRole.UNKNOWN,
                        null, AccessRole.UNKNOWN, false));
        assertEquals(AuthorizationPolicy.LayerDecision.DENY,
                object(ResourcePolicy.ADMIN_ONLY, "user-a", AccessRole.USER, "user-a", AccessRole.USER, true));
        assertEquals(AuthorizationPolicy.LayerDecision.ALLOW,
                object(ResourcePolicy.ADMIN_ONLY, "admin", AccessRole.ADMIN, "user-a", AccessRole.USER, true));
        assertEquals(AuthorizationPolicy.LayerDecision.UNKNOWN,
                object(ResourcePolicy.UNKNOWN, "user-b", AccessRole.USER, "user-a", AccessRole.USER, false));
    }

    @Test
    void 기능과_객체층은_deny_overrides로_합성한다() {
        AuthorizationPolicy.Evaluation functionBlock = AuthorizationPolicy.evaluate(
                AccessRole.USER, AccessRole.ADMIN, ResourcePolicy.PUBLIC,
                "user-a", "user-a", AccessRole.USER, true);
        assertEquals(AuthorizationPolicy.LayerDecision.DENY, functionBlock.combined());
        assertEquals(List.of("BFLA"), functionBlock.blockingLayers());

        AuthorizationPolicy.Evaluation bothBlock = AuthorizationPolicy.evaluate(
                AccessRole.USER, AccessRole.ADMIN, ResourcePolicy.ADMIN_ONLY,
                "user-a", "user-a", AccessRole.USER, true);
        assertEquals(AuthorizationPolicy.LayerDecision.DENY, bothBlock.combined());
        assertEquals(List.of("BFLA", "BOLA"), bothBlock.blockingLayers());
    }

    private static AuthorizationPolicy.LayerDecision object(ResourcePolicy policy, String identity,
                                                              AccessRole role, String owner,
                                                              AccessRole ownerRole, boolean decisionGrade) {
        return AuthorizationPolicy.object(policy, identity, role, owner, ownerRole, decisionGrade);
    }
}
