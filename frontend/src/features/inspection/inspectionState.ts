import type { HumanRun, ScannerRunEnvelope } from "@/lib/api/types"

export type InspectionStage = "scope" | "human" | "scanner" | "review"

export function automaticInspectionStage(
  scope: readonly string[],
  human: HumanRun | undefined,
  scanner: ScannerRunEnvelope | undefined,
): InspectionStage {
  if (scope.length === 0) return "scope"
  if (!human?.completed) return "human"
  if (!isCompletedScannerRun(scanner?.run.status)) return "scanner"
  return "review"
}

export function isCompletedScannerRun(status: string | undefined): boolean {
  return status === "COMPLETED" || status === "COMPLETED_WITH_WARNINGS"
}

/** sessionStorage key: the accounts page hands the account to preselect for the next HUMAN pass. */
export const HUMAN_ACCOUNT_HANDOFF = "flowscope.humanAccount"

/** Local wall-clock HH:MM:SS for a server instant. */
export function clockTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":")
}

/**
 * HUMAN pass learns the account session itself, so any registered account can start one. With a scope,
 * only accounts of an in-scope service are offered; without one (HUMAN needs no scope) all are offered.
 */
export function humanPassAccounts<T extends { target: string }>(scope: readonly string[], accounts: readonly T[]): readonly T[] {
  if (scope.length === 0) return accounts
  return accounts.filter((account) => scope.some((entry) => targetMatchesService(entry, account.target)))
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
