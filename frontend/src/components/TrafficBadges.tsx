import { cn } from "@/lib/utils"

const methodTone: Record<string, string> = {
  GET: "border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  POST: "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  PUT: "border-orange-500/25 bg-orange-500/10 text-orange-800 dark:text-orange-300",
  PATCH: "border-violet-500/25 bg-violet-500/10 text-violet-800 dark:text-violet-300",
  DELETE: "border-red-500/25 bg-red-500/10 text-red-800 dark:text-red-300",
  HEAD: "border-teal-500/25 bg-teal-500/10 text-teal-800 dark:text-teal-300",
  OPTIONS: "border-yellow-500/25 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300",
}

export function MethodBadge({ method }: { method: string }) {
  return <span className={cn("inline-flex h-[22px] w-[60px] shrink-0 items-center justify-center rounded border font-mono text-[11px] leading-none", methodTone[method.toUpperCase()] ?? "border-border bg-muted text-muted-foreground")}>{method}</span>
}

export function statusTone(status: string): string {
  const code = Number.parseInt(status, 10)
  if (code >= 500 && code <= 599) return "bg-red-500/10 text-red-800 dark:text-red-300"
  if (code >= 400 && code < 500) return "bg-amber-500/10 text-amber-800 dark:text-amber-300"
  if (code >= 300 && code < 400) return "bg-sky-500/10 text-sky-800 dark:text-sky-300"
  if (code >= 200 && code < 300) return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
  return "bg-muted text-muted-foreground"
}

export function HttpStatusBadge({ status }: { status: string | number }) {
  return <span className={cn("inline-flex min-w-9 items-center justify-center rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums", statusTone(String(status)))}>{Number(status) > 0 ? status : "—"}</span>
}

export function SourceMarks({ sources }: { sources: readonly string[] }) {
  const labels = [["human", "H", "HUMAN", "text-sky-800 dark:text-sky-300"], ["scanner", "S", "ZAP", "text-red-800 dark:text-red-300"], ["llm", "L", "LLM", "text-amber-800 dark:text-amber-300"]]
  return <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold" aria-label={labels.filter(([source]) => sources.some((item) => item.toLowerCase() === source)).map(([, , name]) => name).join(" · ") || "관측 없음"}>{labels.map(([source, mark, name, color]) => <span key={source} title={name} className={sources.some((item) => item.toLowerCase() === source) ? color : "text-muted-foreground/40"}>{mark}</span>)}</span>
}
