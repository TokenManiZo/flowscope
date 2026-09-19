import { apiFetch, postForm } from "./client"
import { notifyDatasetReplacing } from "@/lib/security/datasetBoundary"
import type {
  AccountSaveResult,
  ApiSuccess,
  EvidencePage,
  HumanRun,
  ImportXmlResult,
  ReplayResult,
  RequestLabDraft,
  RequestLabResult,
  ScannerRunEnvelope,
  ScannerRunMutationResult,
  Snapshot,
  ZapStatus,
  ZapAccount,
  ManagedSession,
  ExplorerRunEnvelope,
  ExplorerAccountSaveResult,
  ReviewStatus,
  ProjectStatus,
} from "./types"

const formSignal = (signal?: AbortSignal): RequestInit => signal === undefined ? {} : { signal }

export const getSnapshot = (signal?: AbortSignal) => apiFetch<Snapshot>("/api/snapshot", formSignal(signal))
export const getEvidence = (operation: string, offset = 0, limit = 200, signal?: AbortSignal) =>
  apiFetch<EvidencePage>(`/api/evidence?${new URLSearchParams({ operation, offset: String(offset), limit: String(limit) })}` as `/api/${string}`, formSignal(signal))
export const getEvidenceById = (eventId: string, signal?: AbortSignal) =>
  apiFetch<EvidencePage>(`/api/evidence?${new URLSearchParams({ eventId })}` as `/api/${string}`, formSignal(signal))
export const getManualAttempts = (signal?: AbortSignal) => apiFetch<readonly { sequence: number; originEvidenceId: string; outcome: string; status: number; evidenceId: string | null; durationMillis: number }[]>("/api/manual-attempts", formSignal(signal))
export const openReplay = (values: { eventId: string; request: string; credentialMode: "ANONYMOUS" | "ACCOUNT"; accountId: string }) =>
  postForm<ReplayResult>("/api/replay", values)
export const getRequestLabDraft = (eventId: string, signal?: AbortSignal) =>
  apiFetch<RequestLabDraft>(`/api/request-lab?${new URLSearchParams({ eventId })}` as `/api/${string}`, formSignal(signal))
export const sendRequestLab = (values: { eventId: string; request: string; credentialMode: "ORIGINAL" | "ANONYMOUS" | "ACCOUNT"; accountId: string }, signal?: AbortSignal) =>
  postForm<RequestLabResult>("/api/request-lab", { action: "send", operationId: crypto.randomUUID(), ...values }, undefined, signal)
export const getProjects = (signal?: AbortSignal) => apiFetch<ProjectStatus>("/api/projects", formSignal(signal))
// Signal only after the server confirms replacement. A failed switch must preserve the current editor and dataset.
const confirmedDatasetReplacement = async <T>(request: Promise<T>): Promise<T> => {
  const result = await request
  notifyDatasetReplacing()
  return result
}
export const startProject = (values: { name: string; scope: string }) =>
  confirmedDatasetReplacement(postForm<ProjectStatus>("/api/projects", { action: "start", ...values }))
export const openProject = (id: string) =>
  confirmedDatasetReplacement(postForm<ProjectStatus>("/api/projects", { action: "open", id }))
export const resetProjectTraffic = () =>
  confirmedDatasetReplacement(postForm<ProjectStatus>("/api/projects", { action: "reset" }))
export const deleteProject = (id: string) =>
  postForm<ProjectStatus>("/api/projects", { action: "delete", id })
export const getHumanRun = (signal?: AbortSignal) => apiFetch<HumanRun>("/api/human-run", formSignal(signal))
export const setHumanRun = (values: { action: "begin"; account: string } | { action: "end"; runId: string }) =>
  postForm<HumanRun>("/api/human-run", values)
export const loadSample = () => confirmedDatasetReplacement(postForm<ApiSuccess>("/api/sample", {}))
export const saveRole = (identity: string, role: string) => postForm<ApiSuccess>("/api/role", { identity, role })
export const saveRequirement = (operation: string, role: string) => postForm<ApiSuccess>("/api/requirement", { operation, role })
export const saveReview = (itemId: string, status: ReviewStatus, note: string, validationEvidenceIds: readonly string[] = []) => postForm<ApiSuccess>("/api/review", { itemId, status, note, ...(validationEvidenceIds.length ? { validationEvidenceIds: validationEvidenceIds.join("\n") } : {}) })
export const saveTrafficOverride = (operation: string, value: string) => postForm<ApiSuccess>("/api/traffic-override", { operation, value })
export const mergeIdentity = (from: string, into: string) => postForm<ApiSuccess>("/api/identity-merge", { from, into })
export const saveAccount = (values: { id: string; label: string; role: string; target: string }) =>
  postForm<AccountSaveResult>("/api/account-save", values)
export const deleteAccount = (id: string) => postForm<ApiSuccess>("/api/account-delete", { id })
export const bindSession = (service: string, fingerprint: string, account: string) => postForm<ApiSuccess>("/api/session-bind", { service, fingerprint, account })
export const unbindSession = (service: string, fingerprint: string) => postForm<ApiSuccess>("/api/session-unbind", { service, fingerprint })
export const getManagedSessions = (signal?: AbortSignal) => apiFetch<{ sessions: readonly ManagedSession[] }>("/api/session-capture", formSignal(signal))
export const manageSessionCapture = (action: "begin" | "end" | "revoke", account: string) => postForm<ApiSuccess>("/api/session-capture", { action, account })
export const getZapStatus = (signal?: AbortSignal) => apiFetch<ZapStatus>("/api/zap-status", formSignal(signal))
export const getScannerRun = (signal?: AbortSignal) => apiFetch<ScannerRunEnvelope>("/api/scanner-run", formSignal(signal))
export const startScannerRun = (target: string, accounts: string, anonymous: boolean, definitions = "") =>
  postForm<ScannerRunMutationResult>("/api/scanner-run", {
    target,
    accounts,
    anonymous: String(anonymous),
    ...(definitions.trim() ? { definitions } : {}),
  }, [202])
export const cancelScannerRun = () => postForm<ScannerRunMutationResult>("/api/scanner-run", { action: "cancel" })
export const saveZapAccount = (values: { id: string; label: string; role: string; service: string; loginUrl: string; username: string; password: string; loggedInIndicator: string; loggedOutIndicator: string }) =>
  postForm<{ success: true; message: string; account: ZapAccount }>("/api/zap-accounts", { action: "save", ...values })
export const deleteZapAccount = (id: string) => postForm<ApiSuccess>("/api/zap-accounts", { action: "delete", id })
export const getExplorerRun = (signal?: AbortSignal) => apiFetch<ExplorerRunEnvelope>("/api/explorer-run", formSignal(signal))
export const startExplorerRun = (values: { target: string; accounts: string; anonymous: boolean }) =>
  postForm<{ run: ExplorerRunEnvelope["run"] }>("/api/explorer-run", { action: "start", ...values, anonymous: String(values.anonymous) }, [202])
export const controlExplorerRun = (action: "cancel" | "clear" | "recheck") =>
  postForm<{ run: ExplorerRunEnvelope["run"] }>("/api/explorer-run", { action })
export const steerExplorerRun = (message: string) =>
  postForm<{ run: ExplorerRunEnvelope["run"] }>("/api/explorer-run", { action: "steer", message })
export const saveExplorerAccount = (values: {
  id: string; label: string; role: string; loginUrl: string; username: string; password: string;
  loginMode: "AUTO_FORM" | "JSON"; usernameField: string; passwordField: string;
  tokenJsonPath: string; authHeader: string; authPrefix: string; validationUrl: string
}) => postForm<ExplorerAccountSaveResult>("/api/explorer-accounts", { action: "save", ...values })
export const deleteExplorerAccount = (id: string) => postForm<ApiSuccess>("/api/explorer-accounts", { action: "delete", id })
export const resetIdentities = () => postForm<ApiSuccess>("/api/identity-reset", {})
export const importXml = (source: "human" | "scanner" | "llm", name: string, xml: string | ArrayBuffer, signal?: AbortSignal) =>
  apiFetch<ImportXmlResult>(`/api/import-xml?${new URLSearchParams({ source, name })}` as `/api/${string}`, {
    method: "POST",
    headers: { "Content-Type": "application/xml;charset=UTF-8" },
    body: xml,
    ...formSignal(signal),
  })
export const saveOwner = (resource: string, identity: string) => postForm<ApiSuccess>("/api/owner", { resource, identity })
