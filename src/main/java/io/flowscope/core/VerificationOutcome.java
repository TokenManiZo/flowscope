package io.flowscope.core;

/**
 * Describes how one observed response relates to an account's stored verification rule.
 * The caller evaluates the rule (method + normalized target + explicit success indicator) against
 * the actual response and hands the resulting outcome to {@code SessionBroker.observeResponse}.
 * SessionBroker never inspects response bodies for identity on its own; it only consumes this outcome.
 */
public enum VerificationOutcome {
    /** No strong rule applies to this account (no rule, or a target-only rule without a success indicator). */
    NO_RULE,
    /** The response hit the rule's verification endpoint and the explicit success indicator matched. */
    MATCHED,
    /** The response hit the rule's verification endpoint but the success indicator did not match (e.g. a 200 login page). */
    TARGET_FAILED,
    /** A strong rule exists but this response is not the verification endpoint, so it grants no proof. */
    OFF_TARGET
}
