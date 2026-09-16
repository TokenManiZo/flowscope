import { useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useDeleteProjectMutation, useOpenProjectMutation, useProjectsQuery, useResetProjectTrafficMutation } from "@/lib/query/hooks"

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null
}

export function NewProjectDialog() {
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState("")
  const projects = useProjectsQuery()
  const openProject = useOpenProjectMutation()
  const resetTraffic = useResetProjectTrafficMutation()
  const deleteProject = useDeleteProjectMutation()
  const active = projects.data?.active
  const selected = projects.data?.projects.find((project) => project.id === projectId)
  const busy = openProject.isPending || resetTraffic.isPending || deleteProject.isPending

  useEffect(() => {
    if (!open) setProjectId(active?.id ?? "")
  }, [active?.id, open])

  const error = errorMessage(openProject.error ?? resetTraffic.error ?? deleteProject.error)

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
    <DialogTrigger asChild><Button variant="outline" size="sm">프로젝트 관리</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg" aria-describedby="project-management-description">
      <DialogHeader>
        <DialogTitle>프로젝트 관리</DialogTitle>
        <DialogDescription id="project-management-description">Burp에서 적용한 scope별 진단을 열거나 정리합니다.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <section className="grid gap-2 rounded-md border p-3" aria-labelledby="existing-project-heading">
          <div><h3 id="existing-project-heading" className="text-sm font-medium">현재·기존 프로젝트</h3><p className="text-xs text-muted-foreground">현재 프로젝트: {active?.name ?? "미저장 진단"}</p></div>
          <div className="flex gap-2">
            <select className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" aria-label="기존 프로젝트 선택" value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={projects.isPending || !projects.data?.projects.length || busy}>
              <option value="">{projects.isPending ? "프로젝트 불러오는 중" : "프로젝트 선택"}</option>
              {projects.data?.projects.map((project) => <option key={project.id} value={project.id} disabled={!project.readable || !project.managed}>{project.name}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={() => openProject.mutate(projectId, { onSuccess: () => setOpen(false) })} disabled={!projectId || projectId === active?.id || busy}>열기</Button>
          </div>
          {projects.isError && <p className="text-xs text-destructive">프로젝트 목록을 불러오지 못했습니다.</p>}
        </section>

        <section className="grid gap-3 rounded-md border p-3" aria-labelledby="traffic-reset-heading">
          <div><h3 id="traffic-reset-heading" className="text-sm font-medium">트래픽 초기화</h3><p className="text-xs text-muted-foreground">현재 프로젝트와 scope·계정·정책은 유지하고 Evidence와 실행 기록을 비웁니다.</p></div>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={!active || busy}>현재 프로젝트 트래픽 초기화</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>현재 트래픽을 초기화할까요?</AlertDialogTitle><AlertDialogDescription>수집된 Evidence와 실행 기록은 복구할 수 없습니다. 프로젝트, scope, 계정과 정책은 유지됩니다.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => resetTraffic.mutate()}>트래픽 초기화</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

        <section className="grid gap-3 rounded-md border p-3" aria-labelledby="project-delete-heading">
          <div><h3 id="project-delete-heading" className="text-sm font-medium">프로젝트 삭제</h3><p className="text-xs text-muted-foreground">현재 프로젝트는 삭제할 수 없습니다. 다른 프로젝트를 선택한 뒤 삭제하세요.</p></div>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button type="button" variant="destructive" disabled={!selected?.managed || selected.id === active?.id || busy}>선택한 프로젝트 삭제</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>{selected?.name} 프로젝트를 삭제할까요?</AlertDialogTitle><AlertDialogDescription>프로젝트 DB와 저장된 Evidence가 영구 삭제되며 복구할 수 없습니다.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => deleteProject.mutate(projectId, { onSuccess: () => setProjectId(active?.id ?? "") })}>프로젝트 삭제</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

        <section className="rounded-md border p-3"><h3 className="text-sm font-medium">새 트래픽 진단 시작</h3><p className="mt-1 text-xs text-muted-foreground">Burp의 FlowScope 탭에 URL을 입력하고 범위를 적용하거나 새 트래픽 진단 시작을 누르세요. 프로젝트명은 scope host로 자동 생성됩니다.</p></section>
        {error && <Alert variant="destructive" aria-label={error}><AlertDescription>{error}</AlertDescription></Alert>}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>닫기</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
