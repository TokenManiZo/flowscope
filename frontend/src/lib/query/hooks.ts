import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  bindSession,
  cancelScannerRun,
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
  saveResourcePolicy,
  saveOperationObjectPolicy,
  saveReview,
  saveRole,
  saveTrafficOverride,
  sendRequestLab,
  setHumanRun,
  startScannerRun,
  unbindSession,
  getExplorerRun,
  getExplorerModels,
  startExplorerRun,
  controlExplorerRun,
  steerExplorerRun,
  openExplorerBrowserLogin,
  completeExplorerBrowserLogin,
  deleteExplorerAccount,
  saveZapAccount,
  deleteZapAccount,
  refreshZapSession,
  getProjects,
  startProject, updateProject,
  openProject,
  resetProjectTraffic,
  deleteProject,
  runAuthorizationReplay,
  draftAuthorizationReplay,
} from "@/lib/api/endpoints"
import type { ReviewStatus, Snapshot } from "@/lib/api/types"
import { FLOW_SCOPE_POLL_INTERVAL_MS, FLOW_SCOPE_STALE_TIME_MS } from "./client"

export const queryKeys = {
  snapshot: ["snapshot"] as const,
  evidence: (datasetRevision: number, operation: string, offset: number, limit: number) => ["evidence", datasetRevision, operation, offset, limit] as const,
  humanRun: ["human-run"] as const,
  zapStatus: ["zap-status"] as const,
  scannerRun: ["scanner-run"] as const,
  explorerRun: ["explorer-run"] as const,
  explorerModels: ["explorer-models"] as const,
  projects: ["projects"] as const,
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

function sameManagedSessions(previous: unknown, next: unknown): boolean {
  const before = (previous as Partial<Snapshot>).managedSessions ?? []
  const after = (next as Partial<Snapshot>).managedSessions ?? []
  return JSON.stringify(before) === JSON.stringify(after)
}

function retainSnapshotRevision(previous: unknown, next: unknown): unknown {
  return hasRevision(previous) && hasRevision(next) && previous.revision === next.revision
    && sameManagedSessions(previous, next) ? previous : next
}

export function useSnapshotQuery() {
  return useQuery<Snapshot>({
    queryKey: queryKeys.snapshot,
    queryFn: ({ signal }) => getSnapshot(signal),
    structuralSharing: retainSnapshotRevision,
    ...pollingOptions,
  })
}

export function useProjectsQuery() {
  return useQuery({ queryKey: queryKeys.projects, queryFn: ({ signal }) => getProjects(signal),
    ...pollingOptions })
}

export function useEvidenceQuery(operation: string | null, offset: number, limit: number, datasetRevision = 0) {
  return useQuery({
    queryKey: queryKeys.evidence(datasetRevision, operation ?? "", offset, limit),
    queryFn: ({ signal }) => getEvidence(operation ?? "", offset, limit, signal),
    enabled: operation !== null && operation.length > 0,
    staleTime: FLOW_SCOPE_STALE_TIME_MS,
    retry: 1,
    gcTime: 0,
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
export function useExplorerModelsQuery(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.explorerModels, queryFn: ({ signal }) => getExplorerModels(signal),
    enabled, staleTime: 60_000, retry: false, refetchOnWindowFocus: false })
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

const projectInvalidations = [queryKeys.projects, queryKeys.snapshot, queryKeys.humanRun,
  queryKeys.scannerRun, queryKeys.explorerRun] as const
export function useStartProjectMutation() { return useInvalidatingMutation(startProject, projectInvalidations) }
export function useUpdateProjectMutation() { return useInvalidatingMutation(updateProject, projectInvalidations) }
export function useOpenProjectMutation() { return useInvalidatingMutation(openProject, projectInvalidations) }
export function useResetProjectTrafficMutation() { return useInvalidatingMutation(resetProjectTraffic, projectInvalidations) }
export function useDeleteProjectMutation() { return useInvalidatingMutation(deleteProject, [queryKeys.projects]) }
export function useLoadSampleMutation() { return useInvalidatingMutation(loadSample, [queryKeys.snapshot]) }
export function useHumanRunMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setHumanRun,
    retry: false,
    onSuccess: (data) => { queryClient.setQueryData(queryKeys.humanRun, data) },
    onSettled: () => {
      void Promise.all([queryKeys.humanRun, queryKeys.snapshot].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    },
  })
}
export function useScannerRunMutation() { return useInvalidatingMutation(({ target, accounts, anonymous, definitions }: { target: string; accounts: string; anonymous: boolean; definitions: string }) => startScannerRun(target, accounts, anonymous, definitions), [queryKeys.scannerRun]) }
export function useScannerCancelMutation() { return useInvalidatingMutation(cancelScannerRun, [queryKeys.scannerRun]) }
export function useZapAccountSaveMutation() { return useInvalidatingMutation(saveZapAccount, [queryKeys.scannerRun, queryKeys.snapshot]) }
export function useZapAccountDeleteMutation() { return useInvalidatingMutation((id: string) => deleteZapAccount(id), [queryKeys.scannerRun, queryKeys.snapshot]) }
export function useZapSessionRefreshMutation() { return useInvalidatingMutation((id: string) => refreshZapSession(id), [queryKeys.scannerRun, queryKeys.snapshot]) }
export function useExplorerStartMutation() { return useInvalidatingMutation(startExplorerRun, [queryKeys.explorerRun, queryKeys.snapshot]) }
export function useExplorerControlMutation() { return useInvalidatingMutation((action: "cancel" | "clear" | "recheck") => controlExplorerRun(action), [queryKeys.explorerRun, queryKeys.snapshot]) }
export function useExplorerSteerMutation() { return useInvalidatingMutation((message: string) => steerExplorerRun(message), [queryKeys.explorerRun]) }
export function useExplorerBrowserLoginMutation() { return useInvalidatingMutation(({ id, url }: { id: string; url: string }) => openExplorerBrowserLogin(id, url), [queryKeys.explorerRun]) }
export function useExplorerBrowserCompleteMutation() { return useInvalidatingMutation((id: string) => completeExplorerBrowserLogin(id), [queryKeys.explorerRun, queryKeys.snapshot]) }
export function useExplorerAccountDeleteMutation() { return useInvalidatingMutation((id: string) => deleteExplorerAccount(id), [queryKeys.explorerRun, queryKeys.snapshot]) }
export function useRoleMutation() { return useInvalidatingMutation(({ identity, role }: { identity: string; role: string }) => saveRole(identity, role), [queryKeys.snapshot]) }
export function useRequirementMutation() { return useInvalidatingMutation(({ operation, role }: { operation: string; role: string }) => saveRequirement(operation, role), [queryKeys.snapshot]) }
export function useOperationObjectPolicyMutation() { return useInvalidatingMutation(({ operation, resource, policy }: { operation: string; resource: string; policy: string }) => saveOperationObjectPolicy(operation, resource, policy), [queryKeys.snapshot]) }
export function useResourcePolicyMutation() { return useInvalidatingMutation(({ target, policy }: { target: string; policy: string }) => saveResourcePolicy(target, policy), [queryKeys.snapshot]) }
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
export function useAuthorizationReplayMutation() { return useInvalidatingMutation(({ itemId, armed }: { itemId: string; armed: boolean }) => runAuthorizationReplay(itemId, armed), [queryKeys.snapshot]) }
export function useAuthorizationReplayDraftMutation() { return useInvalidatingMutation((itemId: string) => draftAuthorizationReplay(itemId), [queryKeys.snapshot]) }
