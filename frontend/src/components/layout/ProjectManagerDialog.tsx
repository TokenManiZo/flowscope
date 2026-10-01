import { useEffect, useMemo, useState } from "react"
import { Check, FolderOpen, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ProjectEntry } from "@/lib/api/types"
import { useDeleteProjectMutation, useOpenProjectMutation, useProjectsQuery, useResetProjectTrafficMutation, useStartProjectMutation, useUpdateProjectMutation } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

/** 점검 대상 주소를 서버 exact scope 형식(scheme://host:port[/path])으로 맞춘다. 쿼리·조각은 뺀다. */
export function normalizeScopeEntry(raw: string): { entry: string | null; note?: string } {
  const value = raw.trim()
  if (!value) return { entry: null }
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return { entry: null, note: "http 또는 https 주소만 등록할 수 있습니다." }
    const port = url.port || (url.protocol === "https:" ? "443" : "80")
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
    const entry = `${url.protocol}//${url.hostname}:${port}${path}`
    return url.search || url.hash ? { entry, note: "쿼리와 뒷부분은 제외하고 등록했습니다." } : { entry }
  } catch {
    return { entry: null, note: "주소 형식이 올바르지 않습니다. 예: http://127.0.0.1:8888" }
  }
}

function suggestName(scopes: readonly string[]): string {
  const first = scopes[0]
  if (!first) return ""
  try {
    const url = new URL(first)
    return `${url.hostname}-${url.port || (url.protocol === "https:" ? "443" : "80")}`
  } catch {
    return first.replace(/^https?:\/\//, "").replace(/[:/]/g, "-")
  }
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : null
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
  const [pickedId, setPickedId] = useState("")
  const [confirmSwitch, setConfirmSwitch] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editScopes, setEditScopes] = useState<string[]>([])
  const [editDraft, setEditDraft] = useState("")
  const [editNote, setEditNote] = useState<string | null>(null)
  const [fallbackId, setFallbackId] = useState("")
  const [scopeDraft, setScopeDraft] = useState("")
  const [scopes, setScopes] = useState<string[]>([])
  const [scopeNote, setScopeNote] = useState<string | null>(null)
  const [scopeError, setScopeError] = useState(false)
  const [name, setName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)

  useEffect(() => { if (!open) { setNotice(null); setEditOpen(false); setConfirmSwitch(false) } }, [open])
  useEffect(() => { if (!pickedId || !list.some(project => project.id === pickedId)) setPickedId(others[0]?.id ?? "") }, [list, others, pickedId])
  useEffect(() => { if (!others.some(project => project.id === fallbackId)) setFallbackId(others[0]?.id ?? "") }, [others, fallbackId])

  const picked = list.find(project => project.id === pickedId)
  const suggested = useMemo(() => suggestName(scopes), [scopes])
  const effectiveName = (nameTouched ? name : suggested).trim()
  const nameTaken = (value: string, except?: string) => list.some(project => project.id !== except && project.name.toLowerCase() === value.toLowerCase())
  const duplicateName = effectiveName.length > 0 && nameTaken(effectiveName)
  const canCreate = scopes.length > 0 && effectiveName.length > 0 && !duplicateName && !busy

  const addTo = (draft: string, current: readonly string[], onAdd: (entry: string) => void, onNote: (note: string | null, failed: boolean) => void) => {
    const { entry, note } = normalizeScopeEntry(draft)
    if (!entry) return onNote(note ?? "대상 주소를 입력하세요.", true)
    if (current.includes(entry)) return onNote("이미 등록된 대상입니다.", true)
    onAdd(entry)
    onNote(note ?? null, false)
  }
  const beginEdit = () => {
    if (!active) return
    setEditName(active.name)
    setEditScopes([...active.scope])
    setEditDraft("")
    setEditNote(null)
    setEditOpen(true)
  }
  const saveEdit = () => {
    const nextName = editName.trim()
    if (!active || !nextName || !editScopes.length) return
    if (nameTaken(nextName, active.id)) return setEditNote("같은 이름의 프로젝트가 이미 있습니다.")
    updateProject.mutate({ name: nextName, scope: editScopes.join("\n") }, { onSuccess: () => { setNotice(`"${nextName}" 프로젝트 정보를 저장했습니다.`); setEditOpen(false) } })
  }
  const deleteCurrent = () => {
    const current = active, fallback = others.find(project => project.id === fallbackId)
    if (!current || !fallback) return
    openProject.mutate(fallback.id, { onSuccess: () => deleteProject.mutate(current.id, { onSuccess: () => { setNotice(`"${current.name}" 프로젝트를 삭제하고 "${fallback.name}" 프로젝트로 전환했습니다.`); setEditOpen(false) } }) })
  }
  const createProject = () => {
    const projectName = effectiveName
    startProject.mutate({ name: projectName, scope: scopes.join("\n") }, { onSuccess: () => {
      setNotice(`"${projectName}" 프로젝트를 만들고 전환했습니다.`)
      setScopes([]); setScopeDraft(""); setScopeNote(null); setName(""); setNameTouched(false)
      setTab("manage")
    } })
  }

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
    <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl" aria-describedby="project-manager-description">
      <DialogHeader>
        <DialogTitle>프로젝트 관리</DialogTitle>
        <DialogDescription id="project-manager-description">점검 대상 주소 범위를 직접 정하고 프로젝트를 만들 수 있습니다.</DialogDescription>
      </DialogHeader>

      <Tabs value={tab} onValueChange={setTab}>
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
                    <AlertDialogHeader><AlertDialogTitle>현재 트래픽을 초기화할까요?</AlertDialogTitle><AlertDialogDescription>수집된 관측 기록과 실행 기록은 복구할 수 없습니다. 프로젝트, 점검 범위, 계정과 정책은 유지됩니다.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => resetTraffic.mutate(undefined, { onSuccess: () => setNotice(`"${active?.name}" 프로젝트의 기록을 비웠습니다.`) })}>기록 비우기</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {!editOpen && <Button variant="outline" size="sm" onClick={beginEdit} disabled={!active || busy}><Pencil className="me-1 size-3.5" aria-hidden="true" />수정</Button>}
              </div>
            </div>
            <div className="mt-2 flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background"><FolderOpen className="size-4 text-emerald-600 dark:text-emerald-300" aria-hidden="true" /></span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{active?.name ?? (projects.isPending ? "불러오는 중" : "미저장 진단")}</h3>
                <ul className="mt-2 space-y-1.5" aria-label="현재 점검 범위">
                  {(active?.scope ?? []).map(scope => <li key={scope} className="flex items-center gap-2 font-mono text-xs text-muted-foreground"><Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" /><span className="break-all">{scope}</span></li>)}
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
              <div className="space-y-2">
                <Label htmlFor="edit-scope-input">점검 대상 주소</Label>
                <div className="flex gap-2">
                  <Input id="edit-scope-input" value={editDraft} placeholder="https://service.example.com:443" className="font-mono text-xs"
                    onChange={event => { setEditDraft(event.target.value); setEditNote(null) }}
                    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTo(editDraft, editScopes, entry => { setEditScopes(current => [...current, entry]); setEditDraft("") }, note => setEditNote(note)) } }} />
                  <Button variant="secondary" onClick={() => addTo(editDraft, editScopes, entry => { setEditScopes(current => [...current, entry]); setEditDraft("") }, note => setEditNote(note))}>추가</Button>
                </div>
                <ScopeList scopes={editScopes} onRemove={scope => setEditScopes(current => current.filter(item => item !== scope))} />
                <p className={cn("text-xs", editNote ? "text-destructive" : "text-muted-foreground")}>{editNote ?? "범위를 바꾸면 이후 수집은 새 범위를 따르고, 이미 모은 기록은 그대로 둡니다."}</p>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between">
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="outline" className="text-destructive hover:text-destructive" disabled={busy}><Trash2 className="me-1 size-3.5" aria-hidden="true" />프로젝트 삭제</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{active.name} 프로젝트를 삭제할까요?</AlertDialogTitle>
                      <AlertDialogDescription>프로젝트 DB와 관측 기록이 영구 삭제되며 복구할 수 없습니다. 열려 있는 프로젝트는 지울 수 없어, 아래 프로젝트로 먼저 전환한 뒤 삭제합니다.</AlertDialogDescription>
                    </AlertDialogHeader>
                    {others.length ? <select aria-label="삭제 후 열 프로젝트" className={selectClass} value={fallbackId} onChange={event => setFallbackId(event.target.value)}>
                      {others.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select> : <p className="text-sm text-muted-foreground">전환할 다른 프로젝트가 없습니다. "새 프로젝트" 탭에서 프로젝트를 먼저 만드세요.</p>}
                    <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={!others.length} onClick={deleteCurrent}>전환하고 삭제</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button disabled={!editName.trim() || !editScopes.length || busy} onClick={saveEdit}><Save className="me-1 size-3.5" aria-hidden="true" />변경 저장</Button>
              </div>
            </div>}
          </section>

          <section aria-label="프로젝트 전환" className="space-y-2 rounded-lg border border-border p-3">
            <h3 className="text-sm font-semibold">프로젝트 전환</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select aria-label="기존 프로젝트 선택" className={selectClass} value={pickedId} disabled={!others.length || busy} onChange={event => { setPickedId(event.target.value); setConfirmSwitch(false) }}>
                {!others.length && <option value="">다른 프로젝트 없음</option>}
                {list.filter(project => project.id !== active?.id).map((project: ProjectEntry) => <option key={project.id} value={project.id} disabled={!project.readable || !project.managed}>{project.name}{project.managed ? "" : " · 수동 DB"}</option>)}
              </select>
              <Button variant="secondary" disabled={!picked || busy} onClick={() => setConfirmSwitch(true)}><FolderOpen className="me-1 size-3.5" aria-hidden="true" />열기</Button>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="outline" className="text-destructive hover:text-destructive" disabled={!picked?.managed || busy}><Trash2 className="me-1 size-3.5" aria-hidden="true" />삭제</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>{picked?.name} 프로젝트를 삭제할까요?</AlertDialogTitle><AlertDialogDescription>프로젝트 DB와 저장된 관측 기록이 영구 삭제되며 복구할 수 없습니다.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const target = picked; if (target) deleteProject.mutate(target.id, { onSuccess: () => setNotice(`"${target.name}" 프로젝트를 삭제했습니다.`) }) }}>프로젝트 삭제</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            {confirmSwitch && picked && <div className="flex flex-col gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs">"{picked.name}" 프로젝트로 전환할까요? 현재 프로젝트는 저장된 채로 닫힙니다.</p>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmSwitch(false)}>취소</Button>
                <Button size="sm" disabled={busy} onClick={() => { const target = picked; openProject.mutate(target.id, { onSuccess: () => { setNotice(`"${target.name}" 프로젝트로 전환했습니다.`); setConfirmSwitch(false) } }) }}>전환</Button>
              </div>
            </div>}
          </section>
        </TabsContent>

        <TabsContent value="create" className="space-y-4 pt-4">
          <section className="space-y-2 rounded-lg border border-border p-3">
            <Label htmlFor="project-name" className="text-sm font-semibold">프로젝트 이름</Label>
            <Input id="project-name" value={nameTouched ? name : suggested} placeholder="예: workshop-local" onChange={event => { setNameTouched(true); setName(event.target.value) }} />
            <p className={cn("text-xs", duplicateName ? "text-destructive" : "text-muted-foreground")}>{duplicateName ? "같은 이름의 프로젝트가 이미 있습니다." : nameTouched ? "직접 입력한 이름을 사용합니다." : "비워 두면 첫 번째 점검 대상 주소로 이름을 정합니다."}</p>
          </section>
          <section className="space-y-2 rounded-lg border border-border p-3">
            <Label htmlFor="scope-input" className="text-sm font-semibold">점검 대상 주소</Label>
            <div className="flex gap-2">
              <Input id="scope-input" value={scopeDraft} placeholder="http://127.0.0.1:8888" className="font-mono text-xs"
                onChange={event => { setScopeDraft(event.target.value); setScopeNote(null); setScopeError(false) }}
                onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTo(scopeDraft, scopes, entry => { setScopes(current => [...current, entry]); setScopeDraft("") }, (note, failed) => { setScopeNote(note); setScopeError(failed) }) } }} />
              <Button variant="secondary" onClick={() => addTo(scopeDraft, scopes, entry => { setScopes(current => [...current, entry]); setScopeDraft("") }, (note, failed) => { setScopeNote(note); setScopeError(failed) })}>추가</Button>
            </div>
            <ScopeList scopes={scopes} onRemove={scope => setScopes(current => current.filter(item => item !== scope))} />
            <p className={cn("text-xs", scopeError ? "text-destructive" : "text-muted-foreground")}>{scopeNote ?? "한 줄에 하나씩 추가합니다. 주소와 포트까지 정확히 적어 주세요. 현재 프로젝트는 저장된 채로 보존됩니다."}</p>
          </section>
          <DialogFooter className="sm:justify-end"><Button disabled={!canCreate} onClick={createProject}>프로젝트 만들고 열기</Button></DialogFooter>
        </TabsContent>
      </Tabs>
      {error && <Alert variant="destructive" aria-label={error}><AlertDescription>{error}</AlertDescription></Alert>}
    </DialogContent>
  </Dialog>
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
