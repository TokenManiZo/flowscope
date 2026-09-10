import { useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useStartProjectMutation } from "@/lib/query/hooks"

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null
}

export function NewProjectDialog({ defaultScope = "" }: { defaultScope?: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [scope, setScope] = useState(defaultScope)
  const start = useStartProjectMutation()

  useEffect(() => {
    if (!open) setScope(defaultScope)
  }, [defaultScope, open])

  function submit() {
    if (!scope.trim() || start.isPending) return
    start.mutate({ name: name.trim(), scope: scope.trim() }, {
      onSuccess: () => {
        setName("")
        setOpen(false)
      },
    })
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!start.isPending) setOpen(next) }}>
    <DialogTrigger asChild><Button variant="outline" size="sm">새 진단 시작</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg" aria-describedby="new-project-description">
      <DialogHeader>
        <DialogTitle>새 진단 시작</DialogTitle>
        <DialogDescription id="new-project-description">현재 진단을 로컬 프로젝트 DB에 먼저 보존한 뒤 새 scope로 전환합니다. 기존 Evidence는 삭제하지 않습니다.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2"><Label htmlFor="project-name">프로젝트 이름 (선택)</Label><Input id="project-name" value={name} maxLength={120} placeholder="비우면 scope host를 사용합니다" onChange={(event) => setName(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="project-scope">Exact scope</Label><Textarea id="project-scope" value={scope} placeholder={"https://app.example.com/\nhttps://api.example.com/v1"} onChange={(event) => setScope(event.target.value)} /><p className="text-xs text-muted-foreground">한 줄에 하나의 scheme://host[:port][/path-prefix]를 입력합니다.</p></div>
        {errorMessage(start.error) && <Alert variant="destructive" aria-label={errorMessage(start.error) ?? undefined}><AlertDescription>{errorMessage(start.error)}</AlertDescription></Alert>}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={start.isPending}>취소</Button><Button type="button" onClick={submit} disabled={!scope.trim() || start.isPending}>{start.isPending ? "보존 후 전환 중" : "보존하고 시작"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
