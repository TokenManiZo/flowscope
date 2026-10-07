package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class AccountSessionTest {
    @Test
    void selectedAccountKeepsRotatedCredentialsAcrossObservedServices() {
        AnalysisConfig config = new AnalysisConfig();
        AccountProfile userA = new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER);
        config.upsertAccount(userA)
                .bindSession("https://api.test:443", "sess:first", userA.id())
                .bindSession("https://api.test:443", "sess:rotated", userA.id());

        RequestRecord first = record("https://api.test:443", "sess:first", "/orders/1");
        RequestRecord rotated = record("https://api.test:443", "sess:rotated", "/orders/2");
        RequestRecord otherService = record("https://other.test:443", "sess:first", "/orders/3");
        first.collectionAccountId = "acct-a";
        rotated.collectionAccountId = "acct-a";
        otherService.collectionAccountId = "acct-a";
        Pipeline.Result result = Pipeline.run(List.of(first, rotated, otherService), config);

        assertEquals("acct-a", first.idn);
        assertEquals("acct-a", rotated.idn);
        assertEquals("acct-a", otherService.idn);
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
    void anOperatorCaptureRebindsCredentialsThatAnOlderMistakeBoundToAnotherAccount() {
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER))
                .upsertAccount(new AccountProfile("acct-b", "USER B", "https://api.test:443", AccessRole.USER))
                .bindSession("https://api.test:443", "sub:b@b.com", "acct-a");

        config.rebindSession("https://api.test:443", "sub:b@b.com", "acct-b");

        assertEquals("acct-b", config.boundAccount("https://api.test:443", "sub:b@b.com").orElseThrow().id());
        assertThrows(IllegalArgumentException.class, () -> config.rebindSession("https://api.test:443", "sub:b@b.com", "missing"));
        assertEquals("acct-b", config.boundAccount("https://api.test:443", "sub:b@b.com").orElseThrow().id());
    }

    @Test
    void humanEvidenceKeepsItsCapturedAccountAfterFingerprintIsRebound() {
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER))
                .upsertAccount(new AccountProfile("acct-b", "USER B", "https://api.test:443", AccessRole.USER))
                .bindSession("https://api.test:443", "sess:same", "acct-a");
        RequestRecord record = record("https://api.test:443", "sess:same", "/orders/1");
        record.laneAccountId = "acct-a";

        config.unbindSession("https://api.test:443", "sess:same");
        config.bindSession("https://api.test:443", "sess:same", "acct-b");

        Pipeline.Result result = Pipeline.run(List.of(record), config);
        assertEquals("acct-a", result.records.getFirst().idn);
        assertEquals("USER A", result.graph.node("I:acct-a").label);
        assertNull(result.graph.node("I:acct-b"));
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

    @Test
    void 서비스의_기본포트와_대소문자를_정규화해_세션을_연결한다() {
        AnalysisConfig config = new AnalysisConfig().upsertAccount(
                new AccountProfile("acct-a", "USER A", "https://API.TEST", AccessRole.USER));

        config.bindSession("https://api.test", "sess:first", "acct-a");

        assertEquals("acct-a", config.boundAccount(
                "https://API.TEST:443/", "sess:first").orElseThrow().id());
    }

    @Test
    void 인증지문_연결해제는_선택세션을_바꾸지_않는다() {
        AnalysisConfig config = new AnalysisConfig().upsertAccount(
                new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER));
        config.bindSession("https://api.test:443", "sess:first", "acct-a");
        RequestRecord record = record("https://api.test:443", "sess:first", "/orders/1");
        record.collectionAccountId = "acct-a";
        assertEquals("acct-a", Pipeline.run(List.of(record), config).records.getFirst().idn);

        config.unbindSession("https://api.test", "sess:first");

        assertEquals("acct-a", Pipeline.run(List.of(record), config).records.getFirst().idn);
    }

    @Test
    void 선택계정이_없으면_지문추출실패도_비로그인이다() {
        RequestRecord unresolved = record("https://api.test:443", "", "/orders/1");
        RequestRecord anonymous = record("https://api.test:443", "anon", "/orders/2");

        Pipeline.Result result = Pipeline.run(List.of(unresolved, anonymous));

        assertEquals(AuthState.ANONYMOUS, result.records.get(0).authState);
        assertEquals("anon", result.records.get(0).idn);
        assertEquals(AccessRole.ANONYMOUS, result.records.get(0).role);
        assertEquals(AuthState.ANONYMOUS, result.records.get(1).authState);
        assertEquals("anon", result.records.get(1).idn);
    }

    @Test
    void 정책스냅샷은_계정과_세션바인딩을_같은시점에_복사한다() {
        AnalysisConfig config = new AnalysisConfig().upsertAccount(
                new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER));
        config.bindSession("https://api.test:443", "sess:first", "acct-a");

        AnalysisConfig snapshot = config.snapshotCopy();
        config.removeAccount("acct-a");

        assertTrue(config.accounts().isEmpty());
        assertEquals("acct-a", snapshot.boundAccount(
                "https://api.test:443", "sess:first").orElseThrow().id());
    }

    @Test
    void 비인증과_지문추출실패는_등록계정에_연결하지_않는다() {
        AnalysisConfig config = new AnalysisConfig().upsertAccount(
                new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER));

        assertThrows(IllegalArgumentException.class,
                () -> config.bindSession("https://api.test:443", "anon", "acct-a"));
        assertThrows(IllegalArgumentException.class,
                () -> config.bindSession("https://api.test:443", "", "acct-a"));
        assertTrue(config.sessionBindings().isEmpty());
    }

    private static RequestRecord record(String service, String fingerprint, String path) {
        RequestRecord record = new RequestRecord(Source.HUMAN, service, "GET", path, 200, fingerprint);
        record.hasResponse = true;
        record.body = "{}";
        return record;
    }
}
