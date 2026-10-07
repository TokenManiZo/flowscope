package io.flowscope.core;

import java.net.URI;
import java.util.Map;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Optional;
import java.time.Instant;

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

    /*
     * 이 여덟 맵은 하나의 정책 상태다. 개별 ConcurrentHashMap으로 나누면 replaceWith 중간의
     * 비어 있는 조합을 독자가 볼 수 있으므로, 모든 접근을 같은 모니터로 직렬화한다.
     */
    private ApiState apiState = ApiState.empty();
    private final Map<String, AccessRole> identityRoles = new LinkedHashMap<>();
    private final Map<String, AccessRole> endpointRequirements = new LinkedHashMap<>();
    private final Map<String, String> resourceOwners = new LinkedHashMap<>();
    private final Map<String, ResourcePolicy> resourcePolicies = new LinkedHashMap<>();
    private final Map<String, AccountProfile> accounts = new LinkedHashMap<>();
    private final Map<String, String> sessionBindings = new LinkedHashMap<>();
    private final Map<String, ReviewDecision> reviews = new LinkedHashMap<>();
    private final Map<String, TrafficOverride> trafficOverrides = new LinkedHashMap<>();
    private final Map<String, AccountVerificationRule> accountVerificationRules = new LinkedHashMap<>();

    public synchronized AnalysisConfig withIdentityRole(String identity, AccessRole role) {
        if (identity != null && role != null) {
            identityRoles.put(identity, role);
            accounts.computeIfPresent(identity, (ignored, account) ->
                    new AccountProfile(account.id(), account.label(), account.service(), role));
        }
        return this;
    }

    public synchronized AnalysisConfig upsertAccount(AccountProfile account) {
        if (account == null) return this;
        AccountProfile existing = accounts.get(account.id());
        if (existing != null && !existing.service().equals(account.service())
                && sessionBindings.containsValue(account.id())) {
            throw new IllegalStateException("unbind account sessions before changing service");
        }
        accounts.put(account.id(), account);
        identityRoles.put(account.id(), account.role());
        if (existing != null && !existing.service().equals(account.service())) {
            // The verification rule's origin no longer matches the account service; drop it as stale.
            accountVerificationRules.remove(account.id());
        }
        return this;
    }

    public synchronized AnalysisConfig removeAccount(String accountId) {
        if (accountId == null) return this;
        accounts.remove(accountId);
        identityRoles.remove(accountId);
        sessionBindings.entrySet().removeIf(entry -> accountId.equals(entry.getValue()));
        resourceOwners.entrySet().removeIf(entry -> accountId.equals(entry.getValue()));
        accountVerificationRules.remove(accountId);
        return this;
    }

    /** Store the login-success rule that lets later auto-captures reach RULE_MATCHED for this account. */
    public synchronized AnalysisConfig withAccountVerificationRule(AccountVerificationRule rule) {
        if (rule == null) return this;
        AccountProfile account = accounts.get(rule.accountId());
        if (account == null) {
            throw new IllegalArgumentException("unknown account for verification rule: " + rule.accountId());
        }
        if (!AccountVerificationRule.originOf(URI.create(account.service())).equalsIgnoreCase(rule.origin())) {
            throw new IllegalArgumentException("verification rule origin does not match account service: "
                    + rule.origin() + " vs " + account.service());
        }
        accountVerificationRules.put(rule.accountId(), rule);
        return this;
    }

    public synchronized AnalysisConfig removeAccountVerificationRule(String accountId) {
        if (accountId != null) accountVerificationRules.remove(accountId);
        return this;
    }

    public synchronized Optional<AccountVerificationRule> verificationRule(String accountId) {
        return Optional.ofNullable(accountId == null ? null : accountVerificationRules.get(accountId));
    }

    public synchronized AnalysisConfig bindSession(String service, String fingerprint, String accountId) {
        String normalizedService = AccountProfile.normalizeService(service);
        String normalizedFingerprint = Fingerprints.safeForStorage(fingerprint);
        if (Fingerprints.ANONYMOUS.equals(normalizedFingerprint)
                || Fingerprints.UNRESOLVED.equals(normalizedFingerprint)) {
            throw new IllegalArgumentException("anonymous or unresolved traffic cannot be bound to an account");
        }
        AccountProfile account = accounts.get(accountId);
        if (account == null) throw new IllegalArgumentException("unknown account: " + accountId);
        String key = sessionKey(normalizedService, normalizedFingerprint);
        if (!account.service().equals(normalizedService)) {
            throw new IllegalArgumentException("session and account services differ");
        }
        String existing = sessionBindings.putIfAbsent(key, accountId);
        if (existing != null && !existing.equals(accountId)) {
            throw new SessionBindingConflictException(existing, accountId);
        }
        return this;
    }

    /** Bind like {@link #bindSession} but replace an existing binding: an explicit operator capture wins over history. */
    public synchronized AnalysisConfig rebindSession(String service, String fingerprint, String accountId) {
        String key = sessionKey(AccountProfile.normalizeService(service), Fingerprints.safeForStorage(fingerprint));
        String previous = sessionBindings.remove(key);
        try {
            return bindSession(service, fingerprint, accountId);
        } catch (RuntimeException error) {
            if (previous != null) sessionBindings.put(key, previous);
            throw error;
        }
    }

    public synchronized AnalysisConfig unbindSession(String service, String fingerprint) {
        sessionBindings.remove(sessionKey(AccountProfile.normalizeService(service), fingerprint));
        return this;
    }

    public synchronized void clearSessionBindings() {
        sessionBindings.clear();
    }

    public synchronized Optional<AccountProfile> boundAccount(String service, String fingerprint) {
        String normalizedService;
        try { normalizedService = AccountProfile.normalizeService(service); }
        catch (RuntimeException error) { return Optional.empty(); }
        return Optional.ofNullable(sessionBindings.get(sessionKey(normalizedService, fingerprint)))
                .map(accounts::get)
                .filter(account -> account.service().equals(normalizedService));
    }

    public synchronized Optional<AccountProfile> account(String accountId) {
        return Optional.ofNullable(accounts.get(accountId));
    }

    public synchronized AnalysisConfig reviewItem(String itemId, ReviewDecision.Status status, String note,
                                     List<String> evidenceIds) {
        ReviewDecision decision = new ReviewDecision(itemId, status, note, evidenceIds, Instant.now());
        reviews.put(itemId, decision);
        return this;
    }

    public synchronized AnalysisConfig restoreReview(ReviewDecision decision) {
        if (decision != null) reviews.put(decision.itemId(), decision);
        return this;
    }

    public synchronized Optional<ReviewDecision> review(String itemId, List<String> evidenceIds) {
        ReviewDecision decision = reviews.get(itemId);
        if (decision == null || !decision.appliesTo(evidenceIds)) return Optional.empty();
        if (decision.policyContext().entrySet().stream().anyMatch(entry -> !entry.getValue().equals(policyValue(entry.getKey())))) {
            return Optional.of(new ReviewDecision(decision.itemId(), ReviewDecision.Status.UNRESOLVED,
                    "접근 규칙 변경으로 재검토 필요 · 이전 " + decision.status().label() + ": " + decision.note(),
                    decision.evidenceIds(), decision.decidedAt(), decision.policyContext(), decision.validationEvidenceIds()));
        }
        return Optional.of(decision);
    }

    /** Capture only the policy coordinates used by this review; unrelated policy edits leave it valid. */
    public synchronized void bindReviewPolicy(String itemId, String identity, String operation, String resource) {
        ReviewDecision decision = reviews.get(itemId);
        if (decision == null) throw new IllegalArgumentException("review not found");
        Map<String, String> context = new LinkedHashMap<>(decision.policyContext());
        if (identity != null) context.put("identity:" + identity, identityRole(identity).name());
        if (operation != null) context.put("operation:" + operation, endpointRequirement(operation).name());
        if (resource != null) context.put("resource:" + resource, resourceOwners.getOrDefault(resource, ""));
        reviews.put(itemId, new ReviewDecision(decision.itemId(), decision.status(), decision.note(),
                decision.evidenceIds(), decision.decidedAt(), context, decision.validationEvidenceIds()));
    }

    public synchronized void attachReviewValidation(String itemId, List<String> evidenceIds) {
        ReviewDecision decision = reviews.get(itemId);
        if (decision == null) throw new IllegalArgumentException("review not found");
        reviews.put(itemId, new ReviewDecision(itemId, decision.status(), decision.note(), decision.evidenceIds(),
                decision.decidedAt(), decision.policyContext(), evidenceIds));
    }

    private String policyValue(String key) {
        if (key.startsWith("identity:")) return identityRole(key.substring(9)).name();
        if (key.startsWith("operation:")) return endpointRequirement(key.substring(10)).name();
        if (key.startsWith("resource:")) return resourceOwners.getOrDefault(key.substring(9), "");
        return "";
    }

    public synchronized ReviewDecision.Status reviewStatus(String itemId, List<String> evidenceIds) {
        return review(itemId, evidenceIds).map(ReviewDecision::status)
                .orElse(ReviewDecision.Status.UNRESOLVED);
    }

    public synchronized void clearReviews() {
        reviews.clear();
    }

    public synchronized AnalysisConfig withTrafficOverride(String operation, TrafficOverride override) {
        if (operation == null || operation.isBlank()) throw new IllegalArgumentException("operation is required");
        if (override == null || override == TrafficOverride.AUTO) trafficOverrides.remove(operation);
        else trafficOverrides.put(operation, override);
        return this;
    }

    public synchronized TrafficOverride trafficOverride(String operation) {
        return operation == null ? TrafficOverride.AUTO
                : trafficOverrides.getOrDefault(operation, TrafficOverride.AUTO);
    }

    public synchronized String identityLabel(String identity) {
        AccountProfile account = accounts.get(identity);
        return account == null ? identity : account.label();
    }

    public synchronized AnalysisConfig withEndpointRequirement(String operation, AccessRole role) {
        if (operation != null && role != null) endpointRequirements.put(operation, role);
        return this;
    }

    public synchronized AnalysisConfig withResourceOwner(String resource, String identity) {
        if (resource == null) return this;
        if (identity == null || identity.isBlank()) resourceOwners.remove(resource);
        else resourceOwners.put(resource, identity.trim());
        return this;
    }

    public synchronized AnalysisConfig withResourcePolicy(String target, ResourcePolicy policy) {
        if (target == null || target.isBlank()) throw new IllegalArgumentException("policy target is required");
        String normalizedTarget = target.trim();
        if (policy == null || policy == ResourcePolicy.UNKNOWN) resourcePolicies.remove(normalizedTarget);
        else resourcePolicies.put(normalizedTarget, policy);
        return this;
    }

    public synchronized AccessRole identityRole(String identity) {
        AccountProfile account = accounts.get(identity);
        if (account != null) return account.role();
        return identityRoles.getOrDefault(identity,
                Fingerprints.ANONYMOUS.equals(identity) ? AccessRole.ANONYMOUS : AccessRole.UNKNOWN);
    }

    public synchronized AccessRole endpointRequirement(String operation) {
        return endpointRequirements.getOrDefault(operation, AccessRole.UNKNOWN);
    }

    public synchronized String resourceOwner(String resource) { return resourceOwners.get(resource); }

    /**
     * API 한 개와 객체 한 개 쌍의 정책 키. 그 API로 그 객체를 다룰 때만 적용된다
     * (예: 이 객체 조회만 공개 — 같은 객체의 수정·삭제와 같은 API의 다른 객체는 그대로 판정).
     */
    public static String operationObjectPolicyKey(String operation, String resource) {
        return operation.trim() + " @ " + resource.trim();
    }

    /** 가장 구체적인 설정이 이긴다: API+객체 쌍 > 객체 > operation 기본값. */
    public synchronized ResourcePolicy resourcePolicy(String operation, String resource) {
        if (operation != null && resource != null) {
            ResourcePolicy pair = resourcePolicies.get(operationObjectPolicyKey(operation, resource));
            if (pair != null) return pair;
        }
        ResourcePolicy exact = resource == null ? null : resourcePolicies.get(resource);
        return exact != null ? exact : resourcePolicies.getOrDefault(operation, ResourcePolicy.UNKNOWN);
    }

    public synchronized Map<String, AccessRole> identityRoles() { return Map.copyOf(identityRoles); }
    public synchronized Map<String, AccessRole> endpointRequirements() { return Map.copyOf(endpointRequirements); }
    public synchronized Map<String, String> resourceOwners() { return Map.copyOf(resourceOwners); }
    public synchronized Map<String, ResourcePolicy> resourcePolicies() { return Map.copyOf(resourcePolicies); }
    public synchronized Map<String, AccountProfile> accounts() { return Map.copyOf(accounts); }
    public synchronized Map<String, String> sessionBindings() { return Map.copyOf(sessionBindings); }
    public synchronized Map<String, ReviewDecision> reviews() { return Map.copyOf(reviews); }
    public synchronized Map<String, TrafficOverride> trafficOverrides() { return Map.copyOf(trafficOverrides); }
    public synchronized Map<String, AccountVerificationRule> accountVerificationRules() {
        return Map.copyOf(accountVerificationRules);
    }

    public synchronized void removeResources(java.util.Set<String> resources) {
        resources.forEach(resourceOwners::remove);
        resourcePolicies.keySet().removeIf(key -> resources.contains(key) || resources.stream().anyMatch(resource -> key.endsWith(" @ " + resource)));
    }

    public synchronized void removeReview(String itemId) { reviews.remove(itemId); }
    public synchronized ApiState apiState() { return apiState; }
    public synchronized void restoreApiState(ApiState value) { apiState = value == null ? ApiState.empty() : value; }
    public synchronized void removeReviews(java.util.Set<String> evidenceIds, java.util.Set<String> operations) {
        reviews.entrySet().removeIf(entry -> operations.stream().anyMatch(op -> entry.getKey().equals(ApiManagement.reviewId(op)))
                || entry.getValue().evidenceIds().stream().anyMatch(evidenceIds::contains)
                || entry.getValue().validationEvidenceIds().stream().anyMatch(evidenceIds::contains));
        operations.forEach(op -> { endpointRequirements.remove(op); trafficOverrides.remove(op); });
        resourcePolicies.keySet().removeIf(key -> operations.stream().anyMatch(op -> (key.equals(op) || key.startsWith(op + " @ "))));
    }

    public void replaceWith(AnalysisConfig other) {
        ConfigSnapshot replacement = other == null ? ConfigSnapshot.empty() : other.snapshot();
        apply(replacement);
    }

    /** 여러 정책 맵을 한 시점에서 함께 읽어야 하는 분석·직렬화용 독립 복사본. */
    public AnalysisConfig snapshotCopy() {
        AnalysisConfig copy = new AnalysisConfig();
        copy.apply(snapshot());
        return copy;
    }

    private synchronized void apply(ConfigSnapshot replacement) {
        apiState = replacement.apiState();
        identityRoles.clear(); identityRoles.putAll(replacement.identityRoles());
        endpointRequirements.clear(); endpointRequirements.putAll(replacement.endpointRequirements());
        resourceOwners.clear(); resourceOwners.putAll(replacement.resourceOwners());
        resourcePolicies.clear(); resourcePolicies.putAll(replacement.resourcePolicies());
        accounts.clear(); accounts.putAll(replacement.accounts());
        sessionBindings.clear(); sessionBindings.putAll(replacement.sessionBindings());
        reviews.clear(); reviews.putAll(replacement.reviews());
        trafficOverrides.clear(); trafficOverrides.putAll(replacement.trafficOverrides());
        accountVerificationRules.clear(); accountVerificationRules.putAll(replacement.accountVerificationRules());
    }

    private synchronized ConfigSnapshot snapshot() {
        return new ConfigSnapshot(Map.copyOf(identityRoles), Map.copyOf(endpointRequirements),
                Map.copyOf(resourceOwners), Map.copyOf(resourcePolicies), Map.copyOf(accounts), Map.copyOf(sessionBindings),
                Map.copyOf(reviews), Map.copyOf(trafficOverrides), Map.copyOf(accountVerificationRules), apiState);
    }

    private record ConfigSnapshot(
            Map<String, AccessRole> identityRoles,
            Map<String, AccessRole> endpointRequirements,
            Map<String, String> resourceOwners,
            Map<String, ResourcePolicy> resourcePolicies,
            Map<String, AccountProfile> accounts,
            Map<String, String> sessionBindings,
            Map<String, ReviewDecision> reviews,
            Map<String, TrafficOverride> trafficOverrides,
            Map<String, AccountVerificationRule> accountVerificationRules, ApiState apiState) {
        static ConfigSnapshot empty() {
            return new ConfigSnapshot(Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(),
                    Map.of(), ApiState.empty());
        }
    }

    private static String sessionKey(String service, String fingerprint) {
        if (service == null || service.isBlank() || fingerprint == null || fingerprint.isBlank()) {
            throw new IllegalArgumentException("service and fingerprint are required");
        }
        return service + "\u0000" + Fingerprints.safeForStorage(fingerprint);
    }
}
