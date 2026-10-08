import { apiOperation } from "@/features/api-management/apiAppearance"

/** Display paths may be synthetic. Management always targets original API keys. */
export function graphApiOperations(node: { kind: string; selection: { operation?: string | null }; displayOperations?: readonly string[] }): string[] {
  if (!["operation", "observed-operation", "operation-group"].includes(node.kind)) return []
  return [...new Set((node.displayOperations?.length ? node.displayOperations : [node.selection.operation ?? ""]).filter(Boolean).map(apiOperation))]
}
