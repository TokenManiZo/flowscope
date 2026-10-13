import "./index.css"
import { createRoot } from "react-dom/client"
import { AppProviders } from "./app/AppProviders"
import { LlmJudgmentPage } from "./features/llm-judgment/LlmJudgmentPage"
import { snapshotFixture } from "./test/fixtures"
import type { LlmFinding } from "./lib/api/types"

document.documentElement.classList.add("dark")
const now = Date.now()
const findings: LlmFinding[] = [
  { id: "finding-1", operation: "https://shop.example.test GET /api/orders/{id}", identity: "member-a", resource: "order", verdict: "", confidence: "", note: "다른 회원의 주문 조회", evidenceIds: ["ev-1", "ev-5", "ev-6", "ev-7", "ev-8", "ev-9"], createdAt: now - 3000, judgment: "vulnerable", judgmentReason: "다른 회원의 주문 주소와 배송지가 응답에 포함됐습니다.", judgmentEvidenceIds: ["ev-1"], judgedAt: now - 2000 },
  { id: "finding-2", operation: "https://files.example.test GET /share/{token}", identity: "anonymous", resource: "file", verdict: "", confidence: "", note: "공유 링크 접근", evidenceIds: ["ev-2"], createdAt: now - 2500, judgment: "inconclusive", judgmentReason: "응답은 확인됐지만 공유 링크의 공개 정책을 확인하지 못했습니다.", judgmentEvidenceIds: ["ev-2"], judgedAt: now - 1500 },
  { id: "finding-3", operation: "https://admin.example.test GET /reports/{id}", identity: "staff", resource: "report", verdict: "", confidence: "", note: "타 부서 보고서 조회", evidenceIds: ["ev-3"], createdAt: now - 2000, judgment: "not_vulnerable", judgmentReason: "권한 없는 계정의 요청이 HTTP 403으로 차단됐습니다.", judgmentEvidenceIds: ["ev-3"], judgedAt: now - 1000 },
  { id: "finding-4", operation: "https://portal.example.test GET /members/{id}/profile", identity: "member-b", resource: "profile", verdict: "", confidence: "", note: "다른 회원의 프로필 조회 후보", evidenceIds: ["ev-4"], createdAt: now - 1000, judgment: "", judgmentReason: "", judgmentEvidenceIds: [], judgedAt: 0 },
]
const events = [...findings.map((finding, index) => ({ eventId: `ev-${index + 1}`, method: "GET", path: finding.operation.split(" GET ")[1], status: index === 2 ? 403 : 200, op: finding.operation })),
  ...Array.from({ length: 5 }, (_, index) => ({ eventId: `ev-${index + 5}`, method: "GET", path: `/api/orders/${index + 101}`, status: index === 4 ? 403 : 200, op: findings[0].operation }))]
const snapshot = { ...snapshotFixture, events, evidenceOrdinals: Object.fromEntries(events.map((event, index) => [event.eventId, index + 1])) }
const responses: Record<string, unknown> = {
  "/api/snapshot": snapshot,
  "/api/llm-findings": { findings },
  "/api/llm-verify": { status: "SUCCEEDED", accountId: "", message: "판정이 완료됐습니다." },
  "/api/explorer-run": { run: { status: "IDLE", providerReadiness: "READY" }, accounts: [], scope: [] },
  "/api/explorer-models": { models: [], configuredModel: "" },
}
window.fetch = async (input) => {
  const path = String(input)
  const value = path.startsWith("/api/llm-feed") ? { entries: [] } : responses[path] ?? {}
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
}
createRoot(document.getElementById("root")!).render(<AppProviders><LlmJudgmentPage /></AppProviders>)
