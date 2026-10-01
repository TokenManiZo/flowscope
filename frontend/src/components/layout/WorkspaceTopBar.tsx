import { Activity, Menu, Radio, ScanSearch, UserRoundCheck, Zap } from "lucide-react"

import type { AppRoute } from "@/app/routes"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useHumanRunQuery, useProjectsQuery, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import { runStatusLabel } from "@/lib/display/runStatus"

function humanState(active: boolean | undefined, completed: boolean | undefined) {
  return runStatusLabel(active ? "RUNNING" : completed ? "COMPLETED" : "NOT_STARTED")
}

function queryValue<T>(query: { data: T | undefined; isPending: boolean }, render: (data: T) => string) {
  if (query.data !== undefined) return render(query.data)
  return query.isPending ? "불러오는 중" : "확인 불가"
}

/** 상단 상태 표시줄: 실시간 상태 popover와 샘플·HUMAN 기록 표시. 화면 탐색과 프로젝트(선택·저장 상태·관리)는 사이드바로 옮겼다. */
export function WorkspaceTopBar({ onOpenSidebar }: { route: AppRoute; onOpenSidebar?: () => void }) {
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
  const humanRun = queryValue(human, (data) => humanState(data.active, data.completed))
  const recordingAccount = human.data?.active && human.data.accountId
    ? snapshot.data?.accounts.find((account) => account.id === human.data?.accountId)?.label ?? human.data.accountId : null
  const zapState = queryValue(zap, (data) => runStatusLabel(data.state ?? (data.connected ? "READY" : "UNAVAILABLE")))
  const scannerState = queryValue(scanner, (data) => runStatusLabel(data.run.status))

  return (
    <header aria-label="FlowScope 상단 상태" className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)] px-3 py-2">
      {onOpenSidebar && (
        <button
          type="button"
          aria-label="메뉴 열기"
          onClick={onOpenSidebar}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
      )}
      <div className="flex min-w-0 flex-[1_1_42rem] flex-wrap items-center gap-x-3 gap-y-1.5">
        <Popover>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className="shrink-0">상태</Button></PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2">
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
        {snapshot.data?.sampleMode && <span role="note" aria-label="샘플 데이터" title="HUMAN·SCANNER·LLM 표시는 실제 점검 결과가 아니며 네트워크 요청을 만들지 않습니다." className="shrink-0 rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">샘플 데이터 · 실제 점검 결과 아님</span>}
        {recordingAccount && <span role="status" aria-label="HUMAN 기록 계정" className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-600/50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />기록 중: {recordingAccount}</span>}
      </div>
    </header>
  )
}

function StatusItem({ icon: Icon, label, value, className = "" }: { icon: typeof Activity; label: string; value: string; className?: string }) {
  return <span aria-label={`${label} 상태`} className={`flex min-w-0 shrink-0 items-center gap-1.5 border-l border-[var(--flowscope-divider)] pl-3 text-xs ${className}`}><Icon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" /><span className="shrink-0 font-medium">{label}</span><span className="truncate font-medium">{value}</span></span>
}
