import { Activity, Radio, ScanSearch, UserRoundCheck, Zap } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useHumanRunQuery, useProjectsQuery, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import { runStatusLabel } from "@/lib/display/runStatus"
import { cn } from "@/lib/utils"

function humanState(active: boolean | undefined, completed: boolean | undefined, paused: boolean) {
  if (active && paused) return "일시 정지"
  return runStatusLabel(active ? "RUNNING" : completed ? "COMPLETED" : "NOT_STARTED")
}

function queryValue<T>(query: { data: T | undefined; isPending: boolean }, render: (data: T) => string) {
  if (query.data !== undefined) return render(query.data)
  return query.isPending ? "불러오는 중" : "확인 불가"
}

/**
 * 사이드바 프로젝트 블록 안의 실시간 상태: 샘플 데이터·HUMAN 기록 계정 표시와 [실시간 상태] popover.
 * 상단 상태 표시줄을 없애면서 이리로 옮겼다. 접힌 막대에서는 아이콘 버튼만 남긴다.
 */
export function SidebarLiveStatus({ collapsed = false }: { collapsed?: boolean }) {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const projects = useProjectsQuery()
  const scopeData = projects.data?.active?.scope ?? scanner.data?.scope
  const scopePending = projects.isPending && scanner.isPending
  const scope = scopeData !== undefined ? scopeData[0] ?? "미설정" : scopePending ? "불러오는 중" : "확인 불가"
  const scopeReady = scopeData !== undefined ? scopeData.length > 0 ? "준비됨" : "미준비" : scopePending ? "불러오는 중" : "확인 불가"
  const liveCapture = queryValue(snapshot, (data) => String(data.trafficStats.captured))
  const humanRun = queryValue(human, (data) => humanState(data.active, data.completed, data.runs?.length ? data.runs.every((run) => run.paused) : !!data.paused))
  const recordingRun = (human.data?.runs ?? (human.data?.active ? [human.data] : [])).find((run) => !run.paused)
  const recordingAccount = recordingRun?.accountId
    ? snapshot.data?.accounts.find((account) => account.id === recordingRun.accountId)?.label ?? recordingRun.accountId : null
  const zapState = queryValue(zap, (data) => runStatusLabel(data.state ?? (data.connected ? "READY" : "UNAVAILABLE")))
  const scannerState = queryValue(scanner, (data) => runStatusLabel(data.run.status))

  return <>
    {!collapsed && (snapshot.data?.sampleMode || recordingAccount) && <div className="mt-1.5 grid gap-1 text-[11px]">
      {snapshot.data?.sampleMode && <span role="note" aria-label="샘플 데이터" title="HUMAN·SCANNER·LLM 표시는 실제 점검 결과가 아니며 네트워크 요청을 만들지 않습니다." className="font-semibold text-amber-700 dark:text-amber-300">샘플 데이터 · 실제 점검 결과 아님</span>}
      {recordingAccount && <span role="status" aria-label="HUMAN 기록 계정" className="flex min-w-0 items-center gap-1.5 text-muted-foreground"><span className="size-1.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" /><span className="truncate">기록 중 {recordingAccount}</span></span>}
    </div>}
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="실시간 상태" title={collapsed ? "실시간 상태" : undefined}
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <Activity className="size-3.5 shrink-0" aria-hidden="true" />
          <span className={cn(collapsed && "sr-only")}>실시간 상태</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 p-2">
        <div aria-label="실시간 분석 상태" className="grid gap-1">
          <StatusItem icon={Activity} label="SCOPE" value={scope} className="max-w-72" />
          <StatusItem icon={Activity} label="SCOPE READY" value={scopeReady} />
          <StatusItem icon={Radio} label="LIVE" value={liveCapture} />
          <StatusItem icon={UserRoundCheck} label="HUMAN" value={humanRun} />
          <StatusItem icon={Zap} label="ZAP" value={zapState} />
          <StatusItem icon={ScanSearch} label="SCANNER" value={scannerState} />
        </div>
      </PopoverContent>
    </Popover>
  </>
}

function StatusItem({ icon: Icon, label, value, className = "" }: { icon: typeof Activity; label: string; value: string; className?: string }) {
  return <span aria-label={`${label} 상태`} className={`flex min-w-0 shrink-0 items-center gap-1.5 border-l border-[var(--flowscope-divider)] pl-3 text-xs ${className}`}><Icon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" /><span className="shrink-0 font-medium">{label}</span><span className="truncate font-medium">{value}</span></span>
}
