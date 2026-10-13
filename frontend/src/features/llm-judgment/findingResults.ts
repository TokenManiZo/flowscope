import type { LlmFinding } from "@/lib/api/types"

export type FindingStatus = "vulnerable" | "inconclusive" | "not_vulnerable" | "unjudged"

export const findingStatusLabel: Record<FindingStatus, string> = {
  vulnerable: "취약", inconclusive: "확인 필요",
  not_vulnerable: "정상", unjudged: "미판정",
}

export function findingStatus(finding: LlmFinding): FindingStatus {
  return finding.judgment || "unjudged"
}

export function findingService(finding: LlmFinding): string {
  try { return new URL(finding.operation.split(/\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i)[0]).host }
  catch { return "" }
}
