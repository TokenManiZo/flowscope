package io.flowscope.core;

import java.util.Map;
import java.util.List;
import java.util.Optional;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

/** 사용자 확정 정책값. 권한은 추정값보다 사용자의 명시값을 우선한다. */
public final class AnalysisConfig {
    public static final class SessionBindingConflictException extends IllegalStateException {
        private final String existingAccountId;
        private final String requestedAccountId;

        public SessionBindingConflictException(String existingAccountId, String requestedAccountId) {
            super("인증 지문이 이미 다른 계정에 연결되어 있습니다: " + existingAccountId
                    + " (먼저 기존 연결을 해제하세요.)");
            this.existingAccountId = existingAccountId;
            this.requestedAccountId = requestedAccountId;
        }

        public String existingAccountId() { return existingAccountId; }
        public String requestedAccountId() { return requestedAccountId; }
    }

    private final Map<String, AccessRole> identityRoles = new ConcurrentHashMap<>();
    private final Map<String, AccessRole> endpointRequirements = new ConcurrentHashMap<>();
    private final Map<String, String> resourceOwners = new ConcurrentHashMap<>();
    private final Map<String, AccountProfile> accounts = new ConcurrentHashMap<>();
    private final Map<String, String> sessionBindings = new ConcurrentHashMap<>();
    private final Map<String, ReviewDecision> reviews = new ConcurrentHashMap<>();
    private final Map<String, TrafficOverride> trafficOverrides = new ConcurrentHashMap<>();

    public AnalysisConfig withIdentityRole(String identity, AccessRole role) {
        if (identity != null && role != null) {
            identityRoles.put(identity, role);
            accounts.computeIfPresent(identity, (ignored, account) ->
                    new AccountProfile(account.id(), account.label(), account.service(), role));
        }
        return this;
    }

    public AnalysisConfig upsertAccount(AccountProfile account) {
        if (account == null) return this;
        AccountProfile existing = accounts.get(account.id());
        if (existing != null && !existing.service().equals(account.service())
                && sessionBindings.containsValue(account.id())) {
            throw new IllegalStateException("unbind account sessions before changing service");
        }
        accounts.put(account.id(), account);
        identityRoles.put(account.id(), account.role());
        return this;
    }

    public AnalysisConfig removeAccount(String accountId) {
        if (accountId == null) return this;
        accounts.remove(accountId);
        identityRoles.remove(accountId);
        sessionBindings.entrySet().removeIf(entry -> accountId.equals(entry.getValue()));
        resourceOwners.entrySet().removeIf(entry -> accountId.equals(entry.getValue()));
        return this;
    }

    public AnalysisConfig bindSession(String service, String fingerprint, String accountId) {
        AccountProfile account = accounts.get(accountId);
        if (account == null) throw new IllegalArgumentException("unknown account: " + accountId);
        String key = sessionKey(service, fingerprint);
        if (!account.service().equals(service)) {
            throw new IllegalArgumentException("session and account services differ");
        }
        String existing = sessionBindings.putIfAbsent(key, accountId);
        if (existing != null && !existing.equals(accountId)) {
            throw new SessionBindingConflictException(existing, accountId);
        }
        return this;
    }

    public AnalysisConfig unbindSession(String service, String fingerprint) {
        sessionBindings.remove(sessionKey(service, fingerprint));
        return this;
    }

    public void clearSessionBindings() {
        sessionBindings.clear();
    }

    public Optional<AccountProfile> boundAccount(String service, String fingerprint) {
        return Optional.ofNullable(sessionBindings.get(sessionKey(service, fingerprint)))
                .map(accounts::get)
                .filter(account -> account.service().equals(service));
    }

    public Optional<AccountProfile> account(String accountId) {
        return Optional.ofNullable(accounts.get(accountId));
    }

    public AnalysisConfig reviewItem(String itemId, ReviewDecision.Status status, String note,
                                     List<String> evidenceIds) {
        ReviewDecision decision = new ReviewDecision(itemId, status, note, evidenceIds, Instant.now());
        reviews.put(itemId, decision);
        return this;
    }

    public AnalysisConfig restoreReview(ReviewDecision decision) {
        if (decision != null) reviews.put(decision.itemId(), decision);
        return this;
    }

    public Optional<ReviewDecision> review(String itemId, List<String> evidenceIds) {
        ReviewDecision decision = reviews.get(itemId);
        return decision != null && decision.appliesTo(evidenceIds) ? Optional.of(decision) : Optional.empty();
    }

    public ReviewDecision.Status reviewStatus(String itemId, List<String> evidenceIds) {
        return review(itemId, evidenceIds).map(ReviewDecision::status)
                .orElse(ReviewDecision.Status.UNRESOLVED);
    }

    public void clearReviews() {
        reviews.clear();
    }

    public AnalysisConfig withTrafficOverride(String operation, TrafficOverride override) {
        if (operation == null || operation.isBlank()) throw new IllegalArgumentException("operation is required");
        if (override == null || override == TrafficOverride.AUTO) trafficOverrides.remove(operation);
        else trafficOverrides.put(operation, override);
        return this;
    }

    public TrafficOverride trafficOverride(String operation) {
        return operation == null ? TrafficOverride.AUTO
                : trafficOverrides.getOrDefault(operation, TrafficOverride.AUTO);
    }

    public String identityLabel(String identity) {
        AccountProfile account = accounts.get(identity);
        return account == null ? identity : account.label();
    }

    /** 정규화가 만든 가명 신원을 사용자가 등록한 계정으로 치환한다. */
    public void applyIdentityBindings(List<RequestRecord> records) {
        if (records == null || sessionBindings.isEmpty()) return;
        for (RequestRecord record : records) {
            String accountId = sessionBindings.get(sessionKey(record.service, record.fp));
            AccountProfile account = accountId == null ? null : accounts.get(accountId);
            if (account != null && account.service().equals(record.service)) record.idn = accountId;
        }
    }

    public AnalysisConfig withEndpointRequirement(String operation, AccessRole role) {
        if (operation != null && role != null) endpointRequirements.put(operation, role);
        return this;
    }

    public AnalysisConfig withResourceOwner(String resource, String identity) {
        if (resource == null) return this;
        if (identity == null || identity.isBlank()) resourceOwners.remove(resource);
        else resourceOwners.put(resource, identity.trim());
        return this;
    }

    public AccessRole identityRole(String identity) {
        AccountProfile account = accounts.get(identity);
        if (account != null) return account.role();
        return identityRoles.getOrDefault(identity,
                "anon".equals(identity) ? AccessRole.ANONYMOUS : AccessRole.UNKNOWN);
    }

    public AccessRole endpointRequirement(String operation) {
        return endpointRequirements.getOrDefault(operation, AccessRole.UNKNOWN);
    }

    public String resourceOwner(String resource) { return resourceOwners.get(resource); }

    public Map<String, AccessRole> identityRoles() { return Map.copyOf(identityRoles); }
    public Map<String, AccessRole> endpointRequirements() { return Map.copyOf(endpointRequirements); }
    public Map<String, String> resourceOwners() { return Map.copyOf(resourceOwners); }
    public Map<String, AccountProfile> accounts() { return Map.copyOf(accounts); }
    public Map<String, String> sessionBindings() { return Map.copyOf(sessionBindings); }
    public Map<String, ReviewDecision> reviews() { return Map.copyOf(reviews); }
    public Map<String, TrafficOverride> trafficOverrides() { return Map.copyOf(trafficOverrides); }

    public void replaceWith(AnalysisConfig other) {
        identityRoles.clear();
        endpointRequirements.clear();
        resourceOwners.clear();
        accounts.clear();
        sessionBindings.clear();
        reviews.clear();
        trafficOverrides.clear();
        if (other == null) return;
        identityRoles.putAll(other.identityRoles());
        endpointRequirements.putAll(other.endpointRequirements());
        resourceOwners.putAll(other.resourceOwners());
        accounts.putAll(other.accounts());
        sessionBindings.putAll(other.sessionBindings());
        reviews.putAll(other.reviews());
        trafficOverrides.putAll(other.trafficOverrides());
    }

    private static String sessionKey(String service, String fingerprint) {
        if (service == null || service.isBlank() || fingerprint == null || fingerprint.isBlank()) {
            throw new IllegalArgumentException("service and fingerprint are required");
        }
        return service + "\u0000" + Fingerprints.safeForStorage(fingerprint);
    }
}
