import { beforeEach, expect, it, vi } from "vitest"
import type { JudgmentCell, JudgmentRow } from "./judgmentProjection"
import { exclusionKey, groupApiJudgments, isExcluded, loadMatrixExclusions, saveMatrixExclusions } from "./apiJudgmentProjection"
const op = "https://demo.test:443 GET /orders/{id}"
const cell = (id: string, status: string, reviewStatus = "UNRESOLVED") => ({ id, status, reviewStatus }) as JudgmentCell
const row = (resource: string, value: JudgmentCell, operation = op): JudgmentRow => ({ key: resource, resource, operation, policy: null, ownerLabel: "A", attention: value.status.includes("CANDIDATE"), cellsByIdentity: { a: value } })
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
it("groups only identical service, method and endpoint, retaining the original highest-priority cell", () => {
  const safe = cell("safe", "EXPECTED_ACCESS"), risk = cell("risk", "BOLA_IDOR_CANDIDATE")
  const rows = [row("1", safe), row("2", risk), row("3", safe, op.replace("GET", "POST")), row("4", safe, op.replace("demo.test", "other.test"))]
  const groups = groupApiJudgments(rows)
  expect(groups).toHaveLength(3)
  expect(groups[0].objectCount).toBe(2)
  expect(groups[0].cellsByIdentity.a).toBe(risk)
  expect(groups[0].countsByIdentity.a).toEqual([{ label: "접근 허용", count: 1 }, { label: "의심", count: 1 }])
  expect(groups[0].attention).toBe(true)
  expect(rows[0].cellsByIdentity.a).toBe(safe)
})
it("keeps confirmed and reproduced results ahead of normal, unknown and dismissed results", () => {
  const values = [cell("safe", "EXPECTED_ACCESS"), cell("unknown", "UNKNOWN_POLICY"), cell("candidate", "BOLA_IDOR_CANDIDATE"), cell("reproduced", "BOLA_IDOR_REPRODUCED"), cell("confirmed", "EXPECTED_ACCESS", "CONFIRMED"), cell("dismissed", "BOLA_IDOR_CANDIDATE", "DISMISSED")]
  expect(groupApiJudgments(values.map((value, i) => row(String(i), value)))[0].cellsByIdentity.a.id).toBe("confirmed")
  expect(groupApiJudgments(values.slice(0, 4).map((value, i) => row(String(i), value)))[0].cellsByIdentity.a.id).toBe("reproduced")
  expect(groupApiJudgments(values.slice(0, 2).map((value, i) => row(String(i), value)))[0].cellsByIdentity.a.id).toBe("unknown")
})
it("excludes an exact object or entire API independently in each matrix view", () => {
  const entry = { key: exclusionKey("object", op, "1"), view: "object" as const, operation: op, resource: "1", label: "one" }
  expect(isExcluded(row("1", cell("a", "EXPECTED_ACCESS")), "object", [entry])).toBe(true)
  expect(isExcluded(row("2", cell("a", "EXPECTED_ACCESS")), "object", [entry])).toBe(false)
  expect(isExcluded(row("1", cell("a", "EXPECTED_ACCESS")), "function", [entry])).toBe(false)
  expect(isExcluded(row("new", cell("a", "EXPECTED_ACCESS")), "object", [{ ...entry, resource: null }])).toBe(true)
})
it("isolates project storage, rejects invalid persisted data and tolerates unavailable storage", () => {
  const entry = { key: exclusionKey("object", op, null), view: "object" as const, operation: op, resource: null, label: "API" }
  expect(saveMatrixExclusions("one", [entry])).toBe(true)
  expect(loadMatrixExclusions("one")).toEqual([entry])
  expect(loadMatrixExclusions("two")).toEqual([])
  localStorage.setItem("flowscope.matrix.exclusions.v1:bad", JSON.stringify([{ ...entry, key: "wrong" }, null]))
  expect(loadMatrixExclusions("bad")).toEqual([])
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota") })
  expect(saveMatrixExclusions("one", [])).toBe(false)
  expect(saveMatrixExclusions(null, [])).toBe(false)
})
