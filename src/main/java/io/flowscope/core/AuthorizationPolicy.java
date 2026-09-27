package io.flowscope.core;

import java.util.ArrayList;
import java.util.List;

/** 기능(BFLA)과 객체(BOLA) 기대 정책을 독립 평가한 뒤 deny-overrides로 합성한다. */
public final class AuthorizationPolicy {
    public enum LayerDecision { ALLOW, DENY, UNKNOWN }

    public record Evaluation(LayerDecision function, LayerDecision object,
                             LayerDecision combined, List<String> blockingLayers) {}

    private AuthorizationPolicy() {}

    public static LayerDecision function(AccessRole actual, AccessRole required) {
        if (actual == null || required == null || actual == AccessRole.UNKNOWN || required == AccessRole.UNKNOWN) {
            return LayerDecision.UNKNOWN;
        }
        return actual.isKnownAndAtLeast(required) ? LayerDecision.ALLOW : LayerDecision.DENY;
    }

    public static LayerDecision object(ResourcePolicy policy, String identity, AccessRole role,
                                       String owner, AccessRole ownerRole, boolean decisionGradeOwner) {
        ResourcePolicy effective = policy == null ? ResourcePolicy.UNKNOWN : policy;
        boolean anonymous = Fingerprints.ANONYMOUS.equals(identity) || role == AccessRole.ANONYMOUS;
        boolean admin = role == AccessRole.ADMIN;
        return switch (effective) {
            case PUBLIC -> LayerDecision.ALLOW;
            case AUTHENTICATED_SHARED -> anonymous
                    ? LayerDecision.DENY
                    : role == null || role == AccessRole.UNKNOWN
                        ? LayerDecision.UNKNOWN : LayerDecision.ALLOW;
            case ADMIN_ONLY -> admin ? LayerDecision.ALLOW : LayerDecision.DENY;
            case OWNER_ONLY -> {
                if (admin) yield LayerDecision.ALLOW;
                if (anonymous) yield LayerDecision.DENY;
                if (!decisionGradeOwner || owner == null) yield LayerDecision.UNKNOWN;
                yield owner.equals(identity) ? LayerDecision.ALLOW : LayerDecision.DENY;
            }
            case ROLE_SHARED -> {
                if (admin) yield LayerDecision.ALLOW;
                if (anonymous) yield LayerDecision.DENY;
                if (!decisionGradeOwner || owner == null || role == null || ownerRole == null
                        || role == AccessRole.UNKNOWN || ownerRole == AccessRole.UNKNOWN) {
                    yield LayerDecision.UNKNOWN;
                }
                yield owner.equals(identity) || role == ownerRole ? LayerDecision.ALLOW : LayerDecision.DENY;
            }
            case UNKNOWN -> {
                if (!decisionGradeOwner || owner == null) yield LayerDecision.UNKNOWN;
                if (owner.equals(identity) || admin) yield LayerDecision.ALLOW;
                yield LayerDecision.DENY;
            }
        };
    }

    public static Evaluation evaluate(AccessRole actual, AccessRole required, ResourcePolicy policy,
                                      String identity, String owner, AccessRole ownerRole,
                                      boolean decisionGradeOwner) {
        LayerDecision function = function(actual, required);
        LayerDecision object = object(policy, identity, actual, owner, ownerRole, decisionGradeOwner);
        List<String> blockers = new ArrayList<>(2);
        if (function == LayerDecision.DENY) blockers.add("BFLA");
        if (object == LayerDecision.DENY) blockers.add("BOLA");
        LayerDecision combined = blockers.isEmpty()
                ? function == LayerDecision.UNKNOWN || object == LayerDecision.UNKNOWN
                    ? LayerDecision.UNKNOWN : LayerDecision.ALLOW
                : LayerDecision.DENY;
        return new Evaluation(function, object, combined, List.copyOf(blockers));
    }
}
