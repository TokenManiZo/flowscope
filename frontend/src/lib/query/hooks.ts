import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  bindSession,
  clearTraffic,
  deleteAccount,
  getEvidence,
  getHumanRun,
  getScannerRun,
  getSnapshot,
  getZapStatus,
  importXml,
  loadSample,
  manageSessionCapture,
  mergeIdentity,
  resetIdentities,
  saveAccount,
  saveOwner,
  saveRequirement,
  saveReview,
  saveRole,
  saveTrafficOverride,
  sendRequestLab,
  setHumanRun,
  startScannerRun,
  unbindSession,
  getExplorerRun,
  startExplorerRun,
  controlExplorerRun,
  steerExplorerRun,
  saveExplorerAccount,
  deleteExplorerAccount,
} from "@/lib/api/endpoints"
import type { ReviewStatus, Snapshot } from "@/lib/api/types"
import { FLOW_SCOPE_POLL_INTERVAL_MS, FLOW_SCOPE_STALE_TIME_MS } from "./client"

export const queryKeys = {
  snapshot: ["snapshot"] as const,
  evidence: (operation: string, offset: number, limit: number) => ["evidence", operation, offset, limit] as const,
  humanRun: ["human-run"] as const,
  zapStatus: ["zap-status"] as const,
  scannerRun: ["scanner-run"] as const,
  explorerRun: ["explorer-run"] as const,
}

const pollingOptions = {
  staleTime: FLOW_SCOPE_STALE_TIME_MS,
  refetchInterval: FLOW_SCOPE_POLL_INTERVAL_MS,
  refetchIntervalInBackground: false,
  retry: 1,
}

function hasRevision(value: unknown): value is Pick<Snapshot, "revision"> {
  return typeof value === "object" && value !== null && "revision" in value
    && typeof (value as { revision: unknown }).revision === "number"
}

function retainSnapshotRevision(previous: unknown, next: unknown): unknown {
  return hasRevision(previous) && hasRevision(next) && previous.revision === next.revision ? previous : next
}

export function useSnapshotQuery() {
  return useQuery<Snapshot>({
    queryKey: queryKeys.snapshot,
    queryFn: ({ signal }) => getSnapshot(signal),
    structuralSharing: retainSnapshotRevision,
    ...pollingOptions,
  })
}

export function useEvidenceQuery(operation: string | null, offset: number, limit: number) {
  return useQuery({
    queryKey: queryKeys.evidence(operation ?? "", offset, limit),
    queryFn: ({ signal }) => getEvidence(operation ?? "", offset, limit, signal),
    enabled: operation !== null && operation.length > 0,
    staleTime: FLOW_SCOPE_STALE_TIME_MS,
    retry: 1,
  })
}

export function useHumanRunQuery() {
  return useQuery({ queryKey: queryKeys.humanRun, queryFn: ({ signal }) => getHumanRun(signal), ...pollingOptions })
}

export function useZapStatusQuery() {
  return useQuery({ queryKey: queryKeys.zapStatus, queryFn: ({ signal }) => getZapStatus(signal), ...pollingOptions })
}

export function useScannerRunQuery() {
  return useQuery({ queryKey: queryKeys.scannerRun, queryFn: ({ signal }) => getScannerRun(signal), ...pollingOptions })
}
export function useExplorerRunQuery() {
  return useQuery({ queryKey: queryKeys.explorerRun, queryFn: ({ signal }) => getExplorerRun(signal), ...pollingOptions })
}

function useInvalidatingMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  keys: readonly (readonly string[])[],
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    retry: false,
    onSuccess: async () => { await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))) },
  })
}

export function useClearTrafficMutation() { return useInvalidatingMutation(clearTraffic, [queryKeys.snapshot]) }
export function useLoadSampleMutation() { return useInvalidatingMutation(loadSample, [queryKeys.snapshot]) }
export function useHumanRunMutation() { return useInvalidatingMutation(setHumanRun, [queryKeys.humanRun]) }
export function useScannerRunMutation() { return useInvalidatingMutation(({ target, accounts, anonymous }: { target: string; accounts: string; anonymous: boolean }) => startScannerRun(target, accounts, anonymous), [queryKeys.scannerRun]) }
export function useExplorerStartMutation() { return useInvalidatingMutation(startExplorerRun, [queryKeys.explorerRun, queryKeys.snapshot]) }
export function useExplorerControlMutation() { return useInvalidatingMutation((action: "cancel" | "clear") => controlExplorerRun(action), [queryKeys.explorerRun, queryKeys.snapshot]) }
export function useExplorerSteerMutation() { return useInvalidatingMutation((message: string) => steerExplorerRun(message), [queryKeys.explorerRun]) }
export function useExplorerAccountSaveMutation() { return useInvalidatingMutation(saveExplorerAccount, [queryKeys.explorerRun, queryKeys.snapshot]) }
export function useExplorerAccountDeleteMutation() { return useInvalidatingMutation((id: string) => deleteExplorerAccount(id), [queryKeys.explorerRun, queryKeys.snapshot]) }
export function useRoleMutation() { return useInvalidatingMutation(({ identity, role }: { identity: string; role: string }) => saveRole(identity, role), [queryKeys.snapshot]) }
export function useRequirementMutation() { return useInvalidatingMutation(({ operation, role }: { operation: string; role: string }) => saveRequirement(operation, role), [queryKeys.snapshot]) }
export function useReviewMutation() { return useInvalidatingMutation(({ itemId, status, note }: { itemId: string; status: ReviewStatus; note: string }) => saveReview(itemId, status, note), [queryKeys.snapshot]) }
export function useTrafficOverrideMutation() { return useInvalidatingMutation(({ operation, value }: { operation: string; value: string }) => saveTrafficOverride(operation, value), [queryKeys.snapshot]) }
export function useIdentityMergeMutation() { return useInvalidatingMutation(({ from, into }: { from: string; into: string }) => mergeIdentity(from, into), [queryKeys.snapshot]) }
export function useAccountSaveMutation() { return useInvalidatingMutation(saveAccount, [queryKeys.snapshot]) }
export function useAccountDeleteMutation() { return useInvalidatingMutation(deleteAccount, [queryKeys.snapshot]) }
export function useSessionBindMutation() { return useInvalidatingMutation(({ service, fingerprint, account }: { service: string; fingerprint: string; account: string }) => bindSession(service, fingerprint, account), [queryKeys.snapshot]) }
export function useSessionUnbindMutation() { return useInvalidatingMutation(({ service, fingerprint }: { service: string; fingerprint: string }) => unbindSession(service, fingerprint), [queryKeys.snapshot]) }
export function useSessionCaptureMutation() { return useInvalidatingMutation(({ action, account }: { action: "begin" | "end" | "revoke"; account: string }) => manageSessionCapture(action, account), [queryKeys.snapshot]) }
export function useIdentityResetMutation() { return useInvalidatingMutation(resetIdentities, [queryKeys.snapshot]) }
export function useImportXmlMutation() { return useInvalidatingMutation(({ source, name, xml }: { source: "human" | "scanner" | "llm"; name: string; xml: string }) => importXml(source, name, xml), [queryKeys.snapshot]) }
export function useOwnerMutation() { return useInvalidatingMutation(({ resource, identity }: { resource: string; identity: string }) => saveOwner(resource, identity), [queryKeys.snapshot]) }
export function useRequestLabSendMutation() { return useInvalidatingMutation(sendRequestLab, [queryKeys.snapshot]) }
