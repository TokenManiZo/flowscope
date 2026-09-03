import type { HumanRun, LlmRunEnvelope, ScannerRunEnvelope } from "@/lib/api/types"

export type InspectionStage = "scope" | "human" | "scanner" | "llm"

export function automaticInspectionStage(
  scope: readonly string[],
  human: HumanRun | undefined,
  scanner: ScannerRunEnvelope | undefined,
  llm: LlmRunEnvelope | undefined,
): InspectionStage {
  if (scope.length === 0) return "scope"
  if (!human?.completed) return "human"
  if (!isCompletedScannerRun(scanner?.run.status)) return "scanner"
  if (!llm?.completed_lanes.includes("LLM")) return "llm"
  return "llm"
}

export function isCompletedScannerRun(status: string | undefined): boolean {
  return status === "COMPLETED" || status === "COMPLETED_WITH_WARNINGS"
}

export function activeManagedAccountIds(target: string, sessions: readonly { accountId: string; service: string; status: string; capturing: boolean; credentialConflict: boolean }[]): readonly string[] {
  return sessions
    .filter((session) => session.status === "ACTIVE" && !session.capturing && !session.credentialConflict && targetMatchesService(target, session.service))
    .map((session) => session.accountId)
}

function targetMatchesService(target: string, service: string): boolean {
  if (target === service) return true
  try {
    const value = new URL(target)
    const normalized = `${value.protocol}//${value.hostname.toLowerCase()}:${value.port || (value.protocol === "https:" ? "443" : "80")}`
    return normalized === service
  } catch {
    return false
  }
}
