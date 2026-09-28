export function routeCandidateTone(applicability: string) {
  if (applicability === "REVIEW") return { color: "#f59e0b", className: "text-amber-700 dark:text-amber-300" }
  if (applicability === "INCLUDE") return { color: "#10b981", className: "text-emerald-700 dark:text-emerald-300" }
  if (applicability === "EXCLUDE") return { color: "#ef4444", className: "text-red-700 dark:text-red-300" }
  return { color: "#6b7280", className: "text-muted-foreground" }
}
