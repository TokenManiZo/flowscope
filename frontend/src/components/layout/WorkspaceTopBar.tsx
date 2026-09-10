import { Activity, Database, Radio, ScanSearch, UserRoundCheck, Zap } from "lucide-react"

import { routeHash, type AppRoute } from "@/app/routes"
import { useHumanRunQuery, useOpenProjectMutation, useProjectsQuery, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import { NewProjectDialog } from "./NewProjectDialog"

function humanState(active: boolean | undefined, completed: boolean | undefined) {
  if (active) return "RUNNING"
  return completed ? "DONE" : "WAITING"
}

function queryValue<T>(query: { data: T | undefined; isPending: boolean }, render: (data: T) => string) {
  if (query.data !== undefined) return render(query.data)
  return query.isPending ? "불러오는 중" : "확인 불가"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : ""
}

export function WorkspaceTopBar({ route }: { route: AppRoute }) {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const projects = useProjectsQuery()
  const openProject = useOpenProjectMutation()
  const scopeData = projects.data?.active?.scope ?? scanner.data?.scope
  const scopePending = projects.isPending && scanner.isPending
  const scope = scopeData !== undefined ? scopeData[0] ?? "미설정" : scopePending ? "불러오는 중" : "확인 불가"
  const scopeReady = scopeData !== undefined ? scopeData.length > 0 ? "준비됨" : "미준비" : scopePending ? "불러오는 중" : "확인 불가"
  const liveCapture = queryValue(snapshot, (data) => String(data.trafficStats.captured))
  const humanRun = queryValue(human, (data) => humanState(data.active, data.completed))
  const zapState = queryValue(zap, (data) => data.state ?? (data.connected ? "READY" : "연결 안 됨"))
  const scannerState = queryValue(scanner, (data) => data.run.status)
  const persistenceState = projects.data?.active
    ? projects.data.saveState === "SAVING" ? "저장 중"
      : projects.data.saveState === "PENDING" ? "저장 대기"
        : projects.data.saveState === "FAILED" ? "저장 실패"
          : projects.data.saveState === "SAVED" ? "저장됨" : "저장 상태 확인 불가"
    : projects.isPending ? "DB 확인 중" : "새 진단 필요"
  const persistenceTitle = projects.data?.saveError || (projects.data?.lastSavedAt ? `마지막 저장 ${projects.data.lastSavedAt}` : projects.data?.directory)
  const projectError = errorMessage(openProject.error) || errorMessage(projects.error)

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
        <label className="flex min-w-0 shrink-0 items-center gap-1 text-xs text-muted-foreground">PROJECT
          <select aria-label="프로젝트 선택" value={projects.data?.active?.id ?? ""}
            disabled={!projects.data || openProject.isPending}
            onChange={(event) => { if (event.target.value) openProject.mutate(event.target.value) }}
            className="h-7 max-w-48 border border-border bg-background px-1 text-foreground">
            <option value="">미저장 진단</option>
            {projects.data?.projects?.map((project) => <option key={project.id} value={project.id}
              disabled={!project.readable || !project.managed}>{project.name}{project.managed ? "" : " · 수동 DB"}</option>)}
          </select>
        </label>
        <span title={persistenceTitle} className={`flex shrink-0 items-center gap-1 text-xs ${projects.data?.saveState === "FAILED" ? "text-destructive" : "text-muted-foreground"}`}><Database className="size-3.5" aria-hidden="true" />{persistenceState}</span>
        <NewProjectDialog defaultScope={scopeData?.join("\n") ?? ""} />
        {projectError && <span role="alert" className="max-w-96 truncate text-xs text-destructive">프로젝트 전환 실패 · {projectError}</span>}
      </div>
      <a href={routeHash("inspection")} className="ml-auto shrink-0 border border-emerald-300 bg-emerald-400 px-2.5 py-1.5 text-xs font-semibold text-black hover:bg-emerald-300">{route === "inspection" ? "점검 계속" : "빠른 시작"}</a>
    </header>
  )
}

function StatusItem({ icon: Icon, label, value, className = "" }: { icon: typeof Activity; label: string; value: string; className?: string }) {
  return <span aria-label={`${label} 상태`} className={`flex min-w-0 shrink-0 items-center gap-1.5 border-l border-[var(--flowscope-divider)] pl-3 text-xs ${className}`}><Icon className="size-3.5 shrink-0 text-emerald-300" aria-hidden="true" /><span className="shrink-0 font-medium">{label}</span><span className="truncate font-medium">{value}</span></span>
}
