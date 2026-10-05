import type { Snapshot } from "@/lib/api/types"
import { judgmentTone } from "@/features/matrix/judgmentProjection"

export const apiColors = [
  { id: "yellow", label: "노랑", swatch: "#eab308", dark: "#302915", light: "#fef9df", classes: "bg-yellow-100/70 dark:bg-yellow-950/50" },
  { id: "orange", label: "주황", swatch: "#f97316", dark: "#352315", light: "#fff0df", classes: "bg-orange-100/70 dark:bg-orange-950/50" },
  { id: "red", label: "빨강", swatch: "#ef4444", dark: "#351d22", light: "#fff0f0", classes: "bg-red-100/70 dark:bg-red-950/50" },
  { id: "pink", label: "분홍", swatch: "#ec4899", dark: "#321c2e", light: "#fff0f7", classes: "bg-pink-100/70 dark:bg-pink-950/50" },
  { id: "purple", label: "보라", swatch: "#a855f7", dark: "#2b2140", light: "#f7f0ff", classes: "bg-purple-100/70 dark:bg-purple-950/50" },
  { id: "blue", label: "파랑", swatch: "#3b82f6", dark: "#192a40", light: "#edf5ff", classes: "bg-blue-100/70 dark:bg-blue-950/50" },
  { id: "green", label: "초록", swatch: "#22c55e", dark: "#193229", light: "#edfcf2", classes: "bg-green-100/70 dark:bg-green-950/50" },
  { id: "gray", label: "회색", swatch: "#94a3b8", dark: "#28303b", light: "#f1f5f9", classes: "bg-slate-100 dark:bg-slate-800" },
] as const
export function apiOperation(operation: string): string { return operation.split("#", 1)[0] }
export function apiConfirmed(snapshot: Pick<Snapshot, "apiMarks" | "authorizationMatrix">, operation: string): boolean {
  const op = apiOperation(operation)
  if (snapshot.apiMarks?.[op]?.registered) return true
  const matrix = snapshot.authorizationMatrix
  return [...(matrix?.functions ?? []), ...(matrix?.objects ?? []), ...(matrix?.evidence ?? [])].some(item => apiOperation(item.operation) === op && item.reviewStatus === "CONFIRMED" && judgmentTone(item.status) === "risk")
}
export function apiTint(snapshot: Pick<Snapshot, "apiMarks">, operation: string): string {
  return apiColors.find(color => color.id === snapshot.apiMarks?.[apiOperation(operation)]?.color)?.classes ?? ""
}
