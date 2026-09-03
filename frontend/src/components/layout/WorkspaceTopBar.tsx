import { Activity, Database, Radio, ScanSearch, Sparkles, UserRoundCheck, Zap } from "lucide-react"

import { routeHash, type AppRoute } from "@/app/routes"
import { useHumanRunQuery, useLlmRunQuery, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"

function humanState(active: boolean | undefined, completed: boolean | undefined) {
  if (active) return "RUNNING"
  return completed ? "DONE" : "WAITING"
}

function queryValue<T>(query: { data: T | undefined; isPending: boolean }, render: (data: T) => string) {
  if (query.data !== undefined) return render(query.data)
  return query.isPending ? "불러오는 중" : "확인 불가"
}

export function WorkspaceTopBar({ route }: { route: AppRoute }) {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const llm = useLlmRunQuery()
  const scopeData = scanner.data?.scope ?? llm.data?.scope
  const scopePending = scanner.isPending || llm.isPending
  const scope = scopeData !== undefined ? scopeData[0] ?? "미설정" : scopePending ? "불러오는 중" : "확인 불가"
  const scopeReady = scopeData !== undefined ? scopeData.length > 0 ? "준비됨" : "미준비" : scopePending ? "불러오는 중" : "확인 불가"
  const liveCapture = queryValue(snapshot, (data) => String(data.trafficStats.captured))
  const humanRun = queryValue(human, (data) => humanState(data.active, data.completed))
  const zapState = queryValue(zap, (data) => data.state ?? (data.connected ? "READY" : "연결 안 됨"))
  const scannerState = queryValue(scanner, (data) => data.run.status)
  const llmState = queryValue(llm, (data) => data.run.status)

  return (
    <header aria-label="FlowScope 상단 상태" className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)] px-3 py-2">
      <div className="flex min-w-0 flex-[1_1_42rem] flex-wrap items-center gap-x-3 gap-y-1.5">
        <a href={routeHash("dashboard")} aria-label="FlowScope" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden="true" className="grid size-7 place-items-center border border-emerald-400/50 bg-emerald-400/10 text-emerald-300"><ScanSearch className="size-4" /></span>
          <span>FlowScope</span>
        </a>
        <StatusItem icon={Activity} label="SCOPE" value={scope} className="max-w-72" />
        <StatusItem icon={Activity} label="SCOPE READY" value={scopeReady} />
        <StatusItem icon={Radio} label="LIVE" value={liveCapture} />
        <StatusItem icon={UserRoundCheck} label="HUMAN" value={humanRun} />
        <StatusItem icon={Zap} label="ZAP" value={zapState} />
        <StatusItem icon={ScanSearch} label="SCANNER" value={scannerState} />
        <StatusItem icon={Sparkles} label="LLM" value={llmState} />
        <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">PROJECT<select aria-label="프로젝트 선택" defaultValue="flowscope" className="h-7 border border-border bg-background px-1 text-foreground"><option value="flowscope">FlowScope</option></select></label>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Database className="size-3.5" aria-hidden="true" />DB 준비됨</span>
      </div>
      <a href={routeHash("inspection")} className="ml-auto shrink-0 border border-emerald-300 bg-emerald-400 px-2.5 py-1.5 text-xs font-semibold text-black hover:bg-emerald-300">{route === "inspection" ? "점검 계속" : "빠른 시작"}</a>
    </header>
  )
}

function StatusItem({ icon: Icon, label, value, className = "" }: { icon: typeof Activity; label: string; value: string; className?: string }) {
  return <span aria-label={`${label} 상태`} className={`flex min-w-0 shrink-0 items-center gap-1.5 border-l border-[var(--flowscope-divider)] pl-3 text-xs ${className}`}><Icon className="size-3.5 shrink-0 text-emerald-300" aria-hidden="true" /><span className="shrink-0 font-medium">{label}</span><span className="truncate font-medium">{value}</span></span>
}
