import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import type { AuthorizationMatrix, Cell } from "@/lib/api/types"
import type { ApiGroup } from "./graphHierarchy"
import { GraphScopeSummary } from "./GraphScopeSummary"
import { scopeFindings, undecidedReason } from "./graphScopeFindings"

const svc = "https://demo.test:443"
const cell = (overrides: Partial<Cell>): Cell => ({ idn: "user-1", op: `${svc} GET /orders/{id}`, resource: null, perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: [], ...overrides })
const group = (id: string, label: string, cells: Cell[]): ApiGroup => ({ id, service: svc, key: label, label, cells, operations: [...new Set(cells.map(item => item.op))], routeCandidates: [], endpointCount: new Set(cells.map(item => item.op)).size, sourceCounts: { human: 0, scanner: 0, llm: 0 }, gapCount: 0, routeCandidateCount: 0 })

it("splits server verdicts into IDOR/BFLA candidates (writes first), undecided reasons and per-identity counts", () => {
  const cells = [
    cell({ idn: "user-2", resource: "orders:1", overall: "suspicious", reasons: { human: "객체층(BOLA) 차단 기대(UNKNOWN)인데 대상 객체 응답이 반환됨" } }),
    cell({ idn: "user-2", op: `${svc} DELETE /orders/{id}`, resource: "orders:1", overall: "suspicious", reasons: { human: "객체층(BOLA) 차단 기대인데 상태변경 요청이 성공" } }),
    cell({ op: `${svc} PUT /admin/refund`, overall: "suspicious", reasons: { llm: "기능층(BFLA) 차단 기대: USER 권한이 ADMIN 요구 엔드포인트에 성공" }, perSource: { llm: "suspicious" } }),
    cell({ op: `${svc} POST /coupon`, overall: "undecided", reasons: { human: "404/429/5xx 또는 해석 불가능한 응답" } }),
    cell({ overall: "undecided", resource: "orders:2", reasons: { human: "차단 기대 성공 응답이지만 대상 객체 포함 여부를 확인할 수 없음" } }),
    cell({ op: `${svc} OPTIONS /orders`, overall: "undecided", reasons: { human: "OPTIONS/HEAD는 소유권 성공 증거에서 제외" } }),
  ]
  const found = scopeFindings(cells)
  expect(found.candidates.map(item => [item.method, item.type])).toEqual([["PUT", "BFLA"], ["DELETE", "IDOR"], ["GET", "IDOR"]])
  expect(cells.slice(3).map(undecidedReason)).toEqual(["server", "object", "options"])
  expect(found.identities.find(item => item.idn === "user-1")).toMatchObject({ sources: ["human", "llm"], counts: { suspicious: 1, undecided: 3 } })
})

it("keeps the group panel short: 3 candidates, reason rows that expand, and reveals the API on click", async () => {
  const onRevealOperation = vi.fn()
  const cells = [
    ...Array.from({ length: 5 }, (_, index) => cell({ idn: `user-${index}`, resource: `orders:${index}`, overall: "suspicious", reasons: { human: "객체층(BOLA)" } })),
    ...Array.from({ length: 4 }, (_, index) => cell({ idn: `user-${index}`, op: `${svc} POST /coupon`, overall: "undecided", reasons: { human: "404/429/5xx 또는 해석 불가능한 응답" } })),
  ]
  render(<GraphScopeSummary scope="group" groups={[group("g1", "ORDERS APIs", cells)]} owners={{ "orders:0": "user-9" }} onRevealOperation={onRevealOperation} />)
  const candidates = screen.getByRole("list", { name: "IDOR·BFLA 후보 목록" })
  expect(within(candidates).getAllByRole("listitem")).toHaveLength(3)
  expect(within(candidates).getByText("user-0 → orders:0 (소유자 user-9)")).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "후보 2개 더 보기" }))
  expect(within(candidates).getAllByRole("listitem")).toHaveLength(5)
  const reason = screen.getByRole("button", { name: /서버 오류·없는 경로/ })
  expect(reason).toHaveAttribute("aria-expanded", "false")
  expect(screen.queryByRole("list", { name: "서버 오류·없는 경로 목록" })).not.toBeInTheDocument()
  await userEvent.click(reason)
  expect(within(screen.getByRole("list", { name: "서버 오류·없는 경로 목록" })).getAllByRole("listitem")).toHaveLength(3)
  await userEvent.click(within(candidates).getAllByRole("button")[0])
  expect(onRevealOperation).toHaveBeenCalledWith("g1", `${svc} GET /orders/{id}`)
})

it("orders site groups by candidates, then undecided, and marks clean groups", () => {
  render(<GraphScopeSummary scope="site" groups={[
    group("a", "CLEAN APIs", [cell({})]),
    group("b", "WARN APIs", [cell({ overall: "undecided", reasons: { human: "404/429/5xx" } })]),
    group("c", "HOT APIs", [cell({ overall: "suspicious", reasons: { human: "객체층(BOLA)" } })]),
  ]} />)
  const rows = within(screen.getByRole("list", { name: "API 그룹 목록" })).getAllByRole("button")
  // 모두 0이어도 "문제 없음"이 아니라 관측한 범위에서 의심이 없다는 사실만 적는다.
  expect(rows.map(row => row.textContent)).toEqual(["HOT APIs· 1후보 1", "WARN APIs· 1확인 1", "CLEAN APIs· 1관측된 의심 없음"])
})

it("shows the judgment matrix's test recommendations for the scope, same values as the matrix, with a link to it", async () => {
  const onRevealOperation = vi.fn()
  const op = `${svc} GET /orders/{id}`, other = `${svc} GET /elsewhere`
  const rec = (id: string, operation: string, status: string, extra = {}) => ({ id, operation, status, recommendation: { type: "", basisIdentity: "a", basisIdentityLabel: "USER 1", testIdentity: "anon", testIdentityLabel: "ANONYMOUS", reason: "" }, ...extra })
  const matrix = {
    functions: [rec("f1", op, "BFLA_TEST_RECOMMENDED"), rec("f2", other, "BFLA_TEST_RECOMMENDED"), rec("f3", op, "POLICY_ENFORCED", { recommendation: null })],
    objects: [rec("o1", op, "BOLA_IDOR_TEST_RECOMMENDED", { resource: "orders:7" }), rec("o2", op, "BOLA_IDOR_CANDIDATE", { resource: "orders:8" })],
  } as unknown as AuthorizationMatrix
  render(<GraphScopeSummary scope="group" groups={[group("g1", "ORDERS APIs", [cell({})])]} matrix={matrix} onRevealOperation={onRevealOperation} />)
  const stat = screen.getByText("테스트 추천", { selector: "dt" }).parentElement!
  expect(stat).toHaveTextContent("2")
  expect(stat).toHaveTextContent("BFLA 1 · BOLA/IDOR 1")
  const list = screen.getByRole("list", { name: "테스트 추천 목록" })
  expect(within(list).getByText("USER 1 요청 → ANONYMOUS 세션으로 · orders:7")).toBeVisible()
  expect(screen.getByRole("link", { name: "판정 매트릭스에서 2개 모두 보기 →" })).toHaveAttribute("href", "#matrix")
  await userEvent.click(within(list).getAllByRole("button")[0])
  expect(onRevealOperation).toHaveBeenCalledWith("g1", op)
})

it("counts each identity's APIs by their most urgent verdict so the parts add up to the API count", () => {
  render(<GraphScopeSummary scope="group" groups={[group("g1", "ORDERS APIs", [
    cell({ resource: "orders:1", overall: "allow" }), cell({ resource: "orders:2", overall: "untested" }),
    cell({ op: `${svc} GET /me`, overall: "allow" }),
  ])]} />)
  expect(screen.getByRole("listitem", { name: "user-1 접근 요약" })).toHaveTextContent("API 2개에 접근 — 허용 1 · 판정 보류 1")
})
