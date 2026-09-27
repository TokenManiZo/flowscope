package io.flowscope;

import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AccountVerificationRule;
import io.flowscope.core.AnalysisConfig;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class AnalysisConfigVerificationRuleTest {

    private static AccountVerificationRule rule(String accountId, String origin) {
        return new AccountVerificationRule(accountId, "GET", origin, "/me", "\"id\":\"" + accountId + "\"");
    }

    @Test
    void rejectsRuleForUnknownAccount() {
        AnalysisConfig config = new AnalysisConfig();
        assertThrows(IllegalArgumentException.class,
                () -> config.withAccountVerificationRule(rule("ghost", "https://api.test:443")));
    }

    @Test
    void rejectsRuleWhoseOriginDoesNotMatchTheAccountService() {
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER));
        assertThrows(IllegalArgumentException.class,
                () -> config.withAccountVerificationRule(rule("acct-a", "https://evil.test:443")));
    }

    @Test
    void dropsAStaleRuleWhenTheServiceChanges() {
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER))
                .withAccountVerificationRule(rule("acct-a", "https://api.test:443"));
        assertTrue(config.verificationRule("acct-a").isPresent());

        // Changing the account service to a different origin drops the now-stale rule.
        config.upsertAccount(new AccountProfile("acct-a", "USER A", "https://other.test:443", AccessRole.USER));
        assertTrue(config.verificationRule("acct-a").isEmpty());
    }

    @Test
    void dropsTheRuleWhenTheAccountIsRemoved() {
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER))
                .withAccountVerificationRule(rule("acct-a", "https://api.test:443"));
        config.removeAccount("acct-a");
        assertTrue(config.verificationRule("acct-a").isEmpty());
        assertTrue(config.accountVerificationRules().isEmpty());
    }
}
