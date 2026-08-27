package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class AccountSessionTest {
    @Test
    void registeredAccountBindsRotatedSessionsWithoutCrossingServices() {
        AnalysisConfig config = new AnalysisConfig();
        AccountProfile userA = new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER);
        config.upsertAccount(userA)
                .bindSession("https://api.test:443", "sess:first", userA.id())
                .bindSession("https://api.test:443", "sess:rotated", userA.id());

        RequestRecord first = record("https://api.test:443", "sess:first", "/orders/1");
        RequestRecord rotated = record("https://api.test:443", "sess:rotated", "/orders/2");
        RequestRecord otherService = record("https://other.test:443", "sess:first", "/orders/3");
        Pipeline.Result result = Pipeline.run(List.of(first, rotated, otherService), config);

        assertEquals("acct-a", first.idn);
        assertEquals("acct-a", rotated.idn);
        assertNotEquals("acct-a", otherService.idn);
        assertEquals(AccessRole.USER, config.identityRole("acct-a"));
        assertEquals("USER A", result.graph.node("I:acct-a").label);
    }

    @Test
    void rejectsBindingToAnAccountFromAnotherService() {
        AnalysisConfig config = new AnalysisConfig().upsertAccount(
                new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER));
        assertThrows(IllegalArgumentException.class,
                () -> config.bindSession("https://other.test:443", "sess:first", "acct-a"));
    }

    @Test
    void rejectsSilentlyMovingTheSameCredentialFingerprintToAnotherAccount() {
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER))
                .upsertAccount(new AccountProfile("acct-b", "USER B", "https://api.test:443", AccessRole.USER))
                .bindSession("https://api.test:443", "sess:same", "acct-a");

        AnalysisConfig.SessionBindingConflictException conflict = assertThrows(
                AnalysisConfig.SessionBindingConflictException.class,
                () -> config.bindSession("https://api.test:443", "sess:same", "acct-b"));
        assertEquals("acct-a", conflict.existingAccountId());
        assertEquals("acct-b", conflict.requestedAccountId());
        assertEquals("acct-a", config.boundAccount("https://api.test:443", "sess:same").orElseThrow().id());
    }

    @Test
    void removingAccountUnbindsSessionsAndOwnerPolicy() {
        AnalysisConfig config = new AnalysisConfig().upsertAccount(
                new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER));
        config.bindSession("https://api.test:443", "sess:first", "acct-a")
                .withResourceOwner("https://api.test:443 orders:1", "acct-a");

        config.removeAccount("acct-a");

        assertTrue(config.accounts().isEmpty());
        assertTrue(config.sessionBindings().isEmpty());
        assertNull(config.resourceOwner("https://api.test:443 orders:1"));
    }

    @Test
    void boundAccountServiceCannotChangeWithoutExplicitUnbind() {
        AnalysisConfig config = new AnalysisConfig();
        config.upsertAccount(new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER))
                .bindSession("https://api.test:443", "sess:first", "acct-a");

        assertThrows(IllegalStateException.class, () -> config.upsertAccount(
                new AccountProfile("acct-a", "USER A", "https://other.test:443", AccessRole.USER)));
        assertEquals("https://api.test:443", config.account("acct-a").orElseThrow().service());
        assertEquals("acct-a", config.boundAccount("https://api.test:443", "sess:first").orElseThrow().id());
    }

    private static RequestRecord record(String service, String fingerprint, String path) {
        RequestRecord record = new RequestRecord(Source.HUMAN, service, "GET", path, 200, fingerprint);
        record.hasResponse = true;
        record.body = "{}";
        return record;
    }
}
