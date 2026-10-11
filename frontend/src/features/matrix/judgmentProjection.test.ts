import { describe, expect, it } from "vitest"

import type { AuthorizationMatrix, MatrixFunctionCell, MatrixObjectCell } from "@/lib/api/types"
import { confidenceCodes, findJudgmentItem, isReviewable, judgmentTone, projectJudgmentMatrix, reviewSuffix, withoutService } from "./judgmentProjection"

const service = "https://demo.test:443"
const confidence = (code: string, level: number) => ({ code, level, label: code, basis: `${code} basis` })
const base = { expected: "UNKNOWN" as const, actual: "UNTESTED" as const, policy: confidence("P0", 0), evidence: confidence("E0", 0), oracle: { type: "READ_SEMANTIC", label: "읽기", satisfied: false, requirement: "req" }, gates: [], sourceVerdicts: {}, statusCodes: [], evidenceIds: [], validationVerdict: "NONE", recommendation: null, reviewStatus: "UNRESOLVED" as const, reviewNote: "", reviewEvidenceIds: [] }
const fn = (id: string, identity: string, operation: string, overrides: Partial<MatrixFunctionCell> = {}): MatrixFunctionCell => ({ ...base, id, identity, identityLabel: identity.toUpperCase(), role: "User", operation, status: "COVERAGE_GAP", statusLabel: "미점검", ...overrides })
const obj = (id: string, identity: string, operation: string, resource: string, overrides: Partial<MatrixObjectCell> = {}): MatrixObjectCell => ({ ...base, id, identity, identityLabel: identity.toUpperCase(), role: "User", operation, resource, owner: "a", ownerLabel: "A", relation: "SAME_ROLE_FOREIGN", techniques: ["BOLA"], ownership: confidence("O3", 3), status: "POLICY_ENFORCED", statusLabel: "기대 차단 관측", ...overrides })
const matrix: AuthorizationMatrix = {
  summary: { policyConfirmed: 1, policyReview: 0, bflaCandidates: 0, bolaIdorCandidates: 1, coverageGaps: 1, invalidExperiments: 0, bflaTestRecommendations: 1, bolaIdorTestRecommendations: 0, manualReviewPending: 2, humanConfirmed: 0, humanDismissed: 0 },
  identities: [{ id: "a", label: "A", role: "User", kind: "REGISTERED" }, { id: "b", label: "B", role: "User", kind: "REGISTERED" }],
  functions: [
    fn("function-1", "a", `${service} GET /api/admin/export`, { status: "EXPECTED_ACCESS", statusLabel: "기대 허용 관측", policy: confidence("P3", 3), expected: "ALLOW", actual: "SUCCESS" }),
    fn("function-2", "b", `${service} GET /api/admin/export`, { status: "BFLA_TEST_RECOMMENDED", statusLabel: "BFLA 수동 테스트 추천", policy: confidence("P3", 3), recommendation: { type: "BFLA", basisIdentity: "a", basisIdentityLabel: "A", testIdentity: "b", testIdentityLabel: "B", reason: "r", instruction: "i", stateChanging: false, basisEvidenceIds: ["ev-a"] } }),
    fn("function-3", "a", `${service} GET /api/orders/{id}`, { status: "UNKNOWN_POLICY", statusLabel: "응답 관측 · 기대 정책 미정", actual: "SUCCESS" }),
    fn("function-4", "b", `${service} GET /api/orders/{id}`, { status: "UNKNOWN_POLICY", statusLabel: "응답 관측 · 기대 정책 미정", actual: "SUCCESS" }),
  ],
  objects: [
    obj("object-1", "a", `${service} GET /api/orders/{id}`, `${service} orders:101`, { status: "EXPECTED_ACCESS", statusLabel: "기대 허용 관측", relation: "OWNER", expected: "ALLOW", actual: "SUCCESS", evidenceIds: ["ev-a"] }),
    obj("object-2", "b", `${service} GET /api/orders/{id}`, `${service} orders:101`, { status: "BOLA_IDOR_CANDIDATE", statusLabel: "BOLA/IDOR 후보", expected: "DENY", actual: "SUCCESS", evidenceIds: ["ev-b"], reviewStatus: "CONFIRMED", reviewNote: "reproduced" }),
  ],
  evidence: [{ ...obj("object-2", "b", `${service} GET /api/orders/{id}`, `${service} orders:101`, { status: "BOLA_IDOR_CANDIDATE", statusLabel: "BOLA/IDOR 후보" }), type: "BOLA/IDOR" }, { ...obj("object-1", "a", `${service} GET /api/orders/{id}`, `${service} orders:101`), type: "BOLA" }],
  policyLegend: [], evidenceLegend: [], ownershipLegend: [],
}

describe("judgment matrix projection", () => {
  it("builds function rows per operation and object rows per operation·resource without recomputing status", () => {
    const functions = projectJudgmentMatrix(matrix, "function", false)
    expect(functions.rows.map((row) => row.operation)).toEqual([`${service} GET /api/admin/export`, `${service} GET /api/orders/{id}`])
    expect(functions.rows[0].policy?.code).toBe("P3")
    expect(functions.rows[0].cellsByIdentity.b.status).toBe("BFLA_TEST_RECOMMENDED")
    expect(functions.identities.map((identity) => identity.id)).toEqual(["a", "b"])
    const objects = projectJudgmentMatrix(matrix, "object", false)
    expect(objects.rows).toHaveLength(1)
    expect(objects.rows[0]).toMatchObject({ resource: `${service} orders:101`, ownerLabel: "A", policy: null })
    expect(objects.rows[0].cellsByIdentity.b.status).toBe("BOLA_IDOR_CANDIDATE")
  })

  it("filters attention rows and evidence rows while counting what it hid", () => {
    const attention = projectJudgmentMatrix(matrix, "function", true)
    expect(attention.rows.map((row) => row.operation)).toEqual([`${service} GET /api/admin/export`, `${service} GET /api/orders/{id}`])
    expect(attention.hiddenRows).toBe(0)
    const objects = projectJudgmentMatrix(matrix, "object", true)
    expect(objects.rows).toHaveLength(1)
    const evidence = projectJudgmentMatrix(matrix, "evidence", true)
    expect(evidence.evidenceRows.map((row) => row.id)).toEqual(["object-2"])
    expect(evidence.hiddenRows).toBe(1)
    expect(projectJudgmentMatrix({ ...matrix, objects: [matrix.objects[0]] }, "object", true).rows).toHaveLength(0)
  })

  it("maps tones, review suffixes, reviewability and confidence chips from server values", () => {
    expect(judgmentTone("BOLA_IDOR_CANDIDATE")).toBe("risk")
    expect(judgmentTone("POLICY_ENFORCED")).toBe("ok")
    expect(judgmentTone("INVALID_EXPERIMENT")).toBe("invalid")
    expect(judgmentTone("COVERAGE_GAP")).toBe("gap")
    expect(judgmentTone("OWNERSHIP_UNKNOWN")).toBe("unknown")
    expect(reviewSuffix("CONFIRMED")).toBe(" · 사용자 확정")
    expect(reviewSuffix("DISMISSED")).toBe(" · 정상/기각")
    expect(reviewSuffix("UNRESOLVED")).toBe("")
    expect(isReviewable(matrix.functions[1])).toBe(true)
    expect(isReviewable(matrix.objects[1])).toBe(true)
    expect(isReviewable(matrix.objects[0])).toBe(false)
    expect(confidenceCodes(matrix.objects[1])).toEqual(["P0", "E0", "O3"])
    expect(confidenceCodes(matrix.functions[0])).toEqual(["P3", "E0"])
    expect(withoutService(`${service} GET /api/orders/{id}`)).toBe("GET /api/orders/{id}")
    expect(withoutService("GET /orders")).toBe("GET /orders")
  })

  it("finds items across functions, objects and evidence rows by server id only", () => {
    expect(findJudgmentItem(matrix, "function-2")?.status).toBe("BFLA_TEST_RECOMMENDED")
    expect(findJudgmentItem(matrix, "object-2")?.reviewStatus).toBe("CONFIRMED")
    expect(findJudgmentItem(matrix, "missing")).toBeNull()
    expect(findJudgmentItem(matrix, null)).toBeNull()
  })
})
