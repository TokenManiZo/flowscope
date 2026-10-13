import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, Folder, FolderOpen, Pencil, Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InfoHint } from "@/components/ui/info-hint"
import { isWildcardScopeInput, normalizeScopeEntry, normalizeStartUrl, siteScope } from "@/lib/scopeInput"
export { normalizeScopeEntry } from "@/lib/scopeInput"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDeleteProjectMutation, useOpenProjectMutation, useProjectsQuery, useResetProjectTrafficMutation, useStartProjectMutation, useUpdateProjectMutation } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

function suggestName(scopes: readonly string[]): string {
  const first = scopes[0]
  if (!first) return ""
  try {
    const url = new URL(first.replace(/^(https?:\/\/)\*\./i, "$1"))
    return `${url.hostname.replace(/^\*\./, "")}-${url.port || (url.protocol === "https:" ? "443" : "80")}`
  } catch {
    return first.replace(/^https?:\/\//, "").replace(/[:/]/g, "-")
  }
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : null

function projectDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" })
}

function projectSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ""
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
const selectClass = "h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs"

/**
 * 프로젝트 관리 창(사이드바에서 연다). 현재 프로젝트 확인·수정(이름·점검 범위)·기록 비우기·삭제, 다른 프로젝트 전환·삭제,
 * 새 프로젝트 만들기(이름·점검 범위 직접 입력)를 한곳에서 한다. 서버는 열린 프로젝트를 지울 수 없어, 현재 프로젝트 삭제는
 * 고른 다른 프로젝트로 전환한 뒤 지운다.
 */
export function ProjectManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const projects = useProjectsQuery()
  const openProject = useOpenProjectMutation()
  const startProject = useStartProjectMutation()
  const updateProject = useUpdateProjectMutation()
  const resetTraffic = useResetProjectTrafficMutation()
  const deleteProject = useDeleteProjectMutation()
  const active = projects.data?.active ?? null
  const list = projects.data?.projects ?? []
  const others = list.filter(project => project.id !== active?.id && project.readable && project.managed)
  const busy = openProject.isPending || startProject.isPending || updateProject.isPending || resetTraffic.isPending || deleteProject.isPending
  const error = errorMessage(openProject.error ?? startProject.error ?? updateProject.error ?? resetTraffic.error ?? deleteProject.error) ?? (projects.isError ? "프로젝트 목록을 불러오지 못했습니다." : null)

  const [tab, setTab] = useState("manage")
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [switchId, setSwitchId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editScopes, setEditScopes] = useState<string[]>([])
  const [editStartUrl, setEditStartUrl] = useState("")
  const [startUrl, setStartUrl] = useState("")
  const [editNote, setEditNote] = useState<string | null>(null)
  const [fallbackId, setFallbackId] = useState("")
  const [scopes, setScopes] = useState<string[]>([])
  const [name, setName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)

  useEffect(() => { if (!open) { setNotice(null); setEditOpen(false); setSwitchId(null); setQuery("") } }, [open])
  useEffect(() => { setEditOpen(false); setEditScopes([]); setEditNote(null) }, [active?.id])
  useEffect(() => { if (!others.some(project => project.id === fallbackId)) setFallbackId(others[0]?.id ?? "") }, [others, fallbackId])

  const deleteTarget = list.find(project => project.id === deleteId)
  const needle = query.trim().toLowerCase()
  const listed = list
    .filter(project => project.id !== active?.id)
    .filter(project => !needle || project.name.toLowerCase().includes(needle) || project.scope.some(scope => scope.toLowerCase().includes(needle)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const baseScope = siteScope(startUrl)
  const createScopes = [...new Set([...(baseScope ? [baseScope] : []), ...scopes])]
  const suggested = useMemo(() => suggestName(baseScope ? [baseScope] : scopes), [baseScope, scopes])
  const effectiveName = (nameTouched ? name : suggested).trim()
  const nameTaken = (value: string, except?: string) => list.some(project => project.id !== except && project.name.toLowerCase() === value.toLowerCase())
  const duplicateName = effectiveName.length > 0 && nameTaken(effectiveName)
  const canCreate = Boolean(normalizeStartUrl(startUrl).url) && createScopes.length > 0 && effectiveName.length > 0 && !duplicateName && !busy

  const beginEdit = () => {
    if (!active) return
    setEditName(active.name)
    setEditScopes([...active.scope])
    setEditStartUrl(active.startUrl ?? "")
    setEditNote(null)
    setEditOpen(true)
  }
  const saveEdit = () => {
    const nextName = editName.trim()
    if (!active || !nextName || !editScopes.length) return
    if (nameTaken(nextName, active.id)) return setEditNote("같은 이름의 프로젝트가 이미 있습니다.")
    updateProject.mutate({ name: nextName, scope: editScopes.join("\n"), startUrl: editStartUrl.trim() ? normalizeStartUrl(editStartUrl).url ?? editStartUrl : "" }, { onSuccess: () => { setNotice(`"${nextName}" 프로젝트 정보를 저장했습니다.`); setEditOpen(false) } })
  }
  const deleteCurrent = () => {
    const current = active, fallback = others.find(project => project.id === fallbackId)
    if (!current || !fallback) return
    openProject.mutate(fallback.id, { onSuccess: () => deleteProject.mutate(current.id, { onSuccess: () => { setNotice(`"${current.name}" 프로젝트를 삭제하고 "${fallback.name}" 프로젝트로 전환했습니다.`); setEditOpen(false) } }) })
  }
  const createProject = () => {
    const projectName = effectiveName
    startProject.mutate({ name: projectName, scope: createScopes.join("\n"), startUrl: normalizeStartUrl(startUrl).url ?? "" }, { onSuccess: () => {
      setNotice(`"${projectName}" 프로젝트를 만들고 전환했습니다.`)
      setScopes([]); setStartUrl(""); setName(""); setNameTouched(false)
      setTab("manage")
    } })
  }

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
    <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl sm:p-7" aria-describedby="project-manager-description">
      <DialogHeader>
        <DialogTitle className="text-lg">프로젝트 관리</DialogTitle>
        <DialogDescription id="project-manager-description">점검 대상 주소 범위를 직접 정하고 프로젝트를 만들 수 있습니다.</DialogDescription>
      </DialogHeader>

      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="manage">현재 프로젝트</TabsTrigger>
          <TabsTrigger value="create"><Plus className="me-1 size-3.5" aria-hidden="true" />새 프로젝트</TabsTrigger>
        </TabsList>

        <TabsContent value="manage" className="space-y-4 pt-4">
          {notice && <p role="status" className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs"><Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />{notice}</p>}

          <section aria-label="현재 프로젝트" className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">현재 프로젝트</p>
              <div className="flex gap-1.5">
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="outline" size="sm" disabled={!active || busy}><RotateCcw className="me-1 size-3.5" aria-hidden="true" />기록 비우기</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>현재 트래픽을 초기화할까요?</AlertDialogTitle><AlertDialogDescription>수집된 요청 기록과 실행 기록은 복구할 수 없습니다. 프로젝트, 점검 범위, 계정과 정책은 유지됩니다.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => resetTraffic.mutate(undefined, { onSuccess: () => setNotice(`"${active?.name}" 프로젝트의 기록을 비웠습니다.`) })}>기록 비우기</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {!editOpen && <Button variant="outline" size="sm" onClick={beginEdit} disabled={!active || busy}><Pencil className="me-1 size-3.5" aria-hidden="true" />수정</Button>}
              </div>
            </div>
            <div className="mt-2 flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background"><FolderOpen className="size-4 text-emerald-600 dark:text-emerald-300" aria-hidden="true" /></span>
              <div className="min-w-0">
                <h3 className="truncate font-mono text-base font-semibold">{active?.name ?? (projects.isPending ? "불러오는 중" : "미저장 진단")}</h3>
                <p className="mt-2 text-xs text-muted-foreground">시작 주소 <span className="break-all font-mono text-foreground">{active?.startUrl || "미설정 · 빈 브라우저"}</span></p>
                <ul className="mt-2 space-y-1.5" aria-label="현재 점검 범위">
                  {(active?.scope ?? []).map(scope => <li key={scope} className="flex items-center gap-2 font-mono text-sm text-muted-foreground"><Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" /><span className="break-all">{scope}</span></li>)}
                </ul>
              </div>
            </div>

            {editOpen && active && <div className="mt-4 space-y-4 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">프로젝트 수정</h3>
                <Button variant="ghost" size="icon" aria-label="수정 패널 닫기" onClick={() => setEditOpen(false)}><X className="size-4" aria-hidden="true" /></Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-project-name">프로젝트 이름</Label>
                <Input id="edit-project-name" value={editName} onChange={event => { setEditName(event.target.value); setEditNote(null) }} />
              </div>
              <SiteScopeFields id="edit" site={editStartUrl} onSite={setEditStartUrl} scopes={editScopes} onScopes={setEditScopes} editing />
              {editNote && <p role="alert" className="text-xs text-destructive">{editNote}</p>}
              {errorMessage(updateProject.error) && <Alert variant="destructive" aria-label="프로젝트 변경 저장 실패"><AlertDescription>변경 사항을 저장하지 못했습니다. {errorMessage(updateProject.error)}</AlertDescription></Alert>}
              <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between">
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="outline" className="text-destructive hover:text-destructive" disabled={busy}><Trash2 className="me-1 size-3.5" aria-hidden="true" />프로젝트 삭제</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{active.name} 프로젝트를 삭제할까요?</AlertDialogTitle>
                      <AlertDialogDescription>프로젝트 DB와 요청 기록이 영구 삭제되며 복구할 수 없습니다. 열려 있는 프로젝트는 지울 수 없어, 아래 프로젝트로 먼저 전환한 뒤 삭제합니다.</AlertDialogDescription>
                    </AlertDialogHeader>
                    {others.length ? <select aria-label="삭제 후 열 프로젝트" className={selectClass} value={fallbackId} onChange={event => setFallbackId(event.target.value)}>
                      {others.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select> : <p className="text-sm text-muted-foreground">전환할 다른 프로젝트가 없습니다. "새 프로젝트" 탭에서 프로젝트를 먼저 만드세요.</p>}
                    <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={!others.length} onClick={deleteCurrent}>전환하고 삭제</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button disabled={!editName.trim() || !editScopes.length || busy || Boolean(editStartUrl.trim() && !normalizeStartUrl(editStartUrl).url)} onClick={saveEdit}><Save className="me-1 size-3.5" aria-hidden="true" />변경 저장</Button>
              </div>
            </div>}
          </section>

          <section aria-label="프로젝트 전환" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">다른 프로젝트 <span className="font-normal text-muted-foreground">{list.length - (active ? 1 : 0)}</span></h3>
              <div className="relative w-full sm:w-60">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input aria-label="프로젝트 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름·주소 검색" className="h-8 ps-8 text-xs" />
              </div>
            </div>
            {listed.length ? <ul aria-label="프로젝트 목록" className="max-h-80 overflow-y-auto rounded-lg border border-border">
              {listed.map(project => {
                const usable = project.readable && project.managed
                const meta = [project.scope[0], projectDate(project.createdAt), projectSize(project.sizeBytes)].filter(Boolean).join(" · ")
                return <li key={project.id} className="group border-b border-border last:border-b-0">
                  <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                    <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-medium">{project.name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground" title={project.scope.join("\n")}>{meta}{project.scope.length > 1 ? ` 외 ${project.scope.length - 1}개` : ""}</p>
                    </div>
                    {usable ? <div className="flex shrink-0 gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <Button size="sm" variant="secondary" aria-label={`${project.name} 열기`} disabled={busy} onClick={() => setSwitchId(project.id)}><FolderOpen className="me-1 size-3.5" aria-hidden="true" />열기</Button>
                      <Button size="sm" variant="outline" aria-label={`${project.name} 삭제`} className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setDeleteId(project.id)}><Trash2 className="size-3.5" aria-hidden="true" /></Button>
                    </div> : <span className="shrink-0 text-xs text-muted-foreground">{project.managed ? "읽을 수 없음" : "수동 DB"}</span>}
                  </div>
                  {switchId === project.id && <div className="mx-3 mb-2.5 flex flex-col gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs">"{project.name}" 프로젝트로 전환할까요? 현재 프로젝트는 저장된 채로 닫힙니다.</p>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setSwitchId(null)}>취소</Button>
                      <Button size="sm" disabled={busy} onClick={() => openProject.mutate(project.id, { onSuccess: () => { setNotice(`"${project.name}" 프로젝트로 전환했습니다.`); setSwitchId(null) } })}>전환</Button>
                    </div>
                  </div>}
                </li>
              })}
            </ul> : <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">{needle ? "검색과 일치하는 프로젝트가 없습니다." : "다른 프로젝트가 없습니다. \"새 프로젝트\" 탭에서 만들 수 있습니다."}</p>}
            <AlertDialog open={Boolean(deleteTarget)} onOpenChange={next => { if (!next) setDeleteId(null) }}>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>{deleteTarget?.name} 프로젝트를 삭제할까요?</AlertDialogTitle><AlertDialogDescription>프로젝트 DB와 저장된 요청 기록이 영구 삭제되며 복구할 수 없습니다.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const target = deleteTarget; if (target) deleteProject.mutate(target.id, { onSuccess: () => setNotice(`"${target.name}" 프로젝트를 삭제했습니다.`) }) }}>프로젝트 삭제</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>
        </TabsContent>

        <TabsContent value="create" className="space-y-4 pt-4">
          <section className="space-y-2 rounded-lg border border-border p-3">
            <Label htmlFor="project-name" className="text-sm font-semibold">프로젝트 이름</Label>
            <Input id="project-name" value={nameTouched ? name : suggested} placeholder="예: workshop-local" onChange={event => { setNameTouched(true); setName(event.target.value) }} />
            <p className={cn("text-xs", duplicateName ? "text-destructive" : "text-muted-foreground")}>{duplicateName ? "같은 이름의 프로젝트가 이미 있습니다." : nameTouched ? "직접 입력한 이름을 사용합니다." : "비워 두면 시작할 사이트 주소로 이름을 정합니다."}</p>
          </section>
          <SiteScopeFields id="create" site={startUrl} onSite={setStartUrl} scopes={scopes} onScopes={setScopes} />
          <DialogFooter className="sm:justify-end"><Button disabled={!canCreate} onClick={createProject}>프로젝트 만들고 열기</Button></DialogFooter>
        </TabsContent>
      </Tabs>
      {error && !(editOpen && updateProject.error) && <Alert variant="destructive" aria-label={error}><AlertDescription>{error}</AlertDescription></Alert>}
    </DialogContent>
  </Dialog>
}

function SiteScopeFields({ id, site, onSite, scopes, onScopes, editing = false }: {
  id: string; site: string; onSite: (value: string) => void; scopes: readonly string[];
  onScopes: (value: string[]) => void; editing?: boolean;
}) {
  const [expanded, setExpanded] = useState(editing)
  const [draft, setDraft] = useState("")
  const [note, setNote] = useState<string | null>(null)
  const base = editing ? null : siteScope(site)
  const start = normalizeStartUrl(site).url
  const commitSite = () => {
    if (isWildcardScopeInput(site)) {
      const parsed = normalizeScopeEntry(site)
      if (!parsed.entry) return setNote(parsed.note ?? "와일드카드 형식을 확인하세요.")
      if (!scopes.some(value => normalizeScopeEntry(value).entry === parsed.entry)) onScopes([...scopes, parsed.entry])
      onSite(""); setExpanded(true)
      setNote("와일드카드는 스코프 범위에 추가했습니다. 실제로 열 사이트 주소를 입력하세요.")
    } else if (site.trim()) {
      const parsed = normalizeStartUrl(site)
      if (parsed.url) onSite(parsed.url)
      setNote(parsed.note ?? null)
    }
  }
  const addScope = () => {
    const parsed = normalizeScopeEntry(draft)
    if (!parsed.entry) return setNote(parsed.note ?? "추가할 스코프 범위를 입력하세요.")
    if ([...(base ? [base] : []), ...scopes].some(value => normalizeScopeEntry(value).entry === parsed.entry)) return setNote("이미 등록된 범위입니다.")
    onScopes([...scopes, parsed.entry]); setDraft(""); setNote(null)
  }
  return <section className="space-y-4 rounded-lg border border-border p-3">
    <div className="space-y-2">
      <div className="flex items-center gap-1"><Label htmlFor={`${id}-start-url`}>시작할 사이트 주소</Label><InfoHint label="시작할 사이트 주소">이 주소로 브라우저를 열어요. 계정·LLM·ZAP 로그인 주소의 기본값으로도 사용합니다. 각 설정에서 개별 수정한 주소는 유지합니다.</InfoHint></div>
      <Input id={`${id}-start-url`} value={site} placeholder="https://app.example.com/" className="font-mono" onChange={event => { onSite(event.target.value); setNote(null) }} onBlur={commitSite} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitSite() } }} />
      <p className="text-xs text-muted-foreground">{editing ? "범위 변경은 이후 수집부터 적용됩니다. 기존 기록은 유지합니다." : start ? `${new URL(start).hostname}의 요청을 기본 수집 범위에 포함합니다.` : "시작할 사이트 주소를 입력하세요."}</p>
    </div>
    <div className="border-t border-border pt-3">
      <div className="flex items-center gap-1"><Button type="button" variant="ghost" size="sm" className="h-auto px-0 py-1" aria-expanded={expanded} aria-controls={`${id}-scope-panel`} onClick={() => setExpanded(!expanded)}><ChevronDown className={cn("size-3.5", !expanded && "-rotate-90")} aria-hidden="true" />다른 도메인도 포함</Button><InfoHint label="다른 도메인도 포함">수집할 스코프 범위를 추가하세요. 도메인이나 URL을 지정할 수 있으며, *.example.com은 루트 도메인과 모든 하위 도메인을 포함합니다.</InfoHint></div>
      {expanded && <div id={`${id}-scope-panel`} className="mt-3 space-y-3">
        {base && <p className="break-all font-mono text-xs text-muted-foreground">기본 범위: {base}</p>}
        <div className="flex gap-2"><Input aria-label="추가할 스코프 범위" value={draft} placeholder="*.example.com 또는 https://api.example.com" className="min-w-0 font-mono text-xs" onChange={event => { setDraft(event.target.value); setNote(null) }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addScope() } }} /><Button variant="secondary" onClick={addScope}>추가</Button></div>
        <ScopeList scopes={scopes} onRemove={scope => onScopes(scopes.filter(value => value !== scope))} />
      </div>}
    </div>
    {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
  </section>
}

function ScopeList({ scopes, onRemove }: { scopes: readonly string[]; onRemove(scope: string): void }) {
  if (!scopes.length) return <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">등록된 주소가 없습니다.</div>
  return <ul aria-label="등록한 점검 대상 주소" className="overflow-hidden rounded-md border border-border">
    {scopes.map(scope => <li key={scope} className="flex min-h-10 items-center gap-3 border-b border-border px-3 last:border-b-0">
      <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-emerald-600 text-white"><Check className="size-3" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1 break-all font-mono text-xs">{scope.replace(/^https?:\/\//, "")}</span>
      <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`${scope} 제거`} onClick={() => onRemove(scope)}><X className="size-3.5" aria-hidden="true" /></Button>
    </li>)}
  </ul>
}
