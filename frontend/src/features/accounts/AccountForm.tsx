import { useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Account } from "@/lib/api/types"

const roles = ["User", "LV1", "LV2", "Admin", "Unknown"] as const

export interface AccountValues {
  id: string
  label: string
  role: string
  target: string
}

const emptyValues: AccountValues = { id: "", label: "", role: "User", target: "" }

export function AccountForm({ account, pending, error, onSave }: {
  account: Account | null
  pending: boolean
  error: string | null
  onSave: (values: AccountValues, onSuccess: () => void) => void
}) {
  const [values, setValues] = useState<AccountValues>(emptyValues)

  useEffect(() => {
    setValues(account ? { id: account.id, label: account.label, role: account.role, target: account.target } : emptyValues)
  }, [account])

  return (
    <form className="grid gap-3" onSubmit={(event) => {
      event.preventDefault()
      onSave(values, () => setValues(emptyValues))
    }}>
      <Input type="hidden" value={values.id} readOnly aria-label="등록 계정 ID" />
      <div className="grid gap-1">
        <Label htmlFor="account-label">등록 계정 표시 이름</Label>
        <Input id="account-label" value={values.label} onChange={(event) => setValues((current) => ({ ...current, label: event.target.value }))} required disabled={pending} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="account-role">등록 계정 역할</Label>
        <Select value={values.role} onValueChange={(role) => setValues((current) => ({ ...current, role }))} disabled={pending}>
          <SelectTrigger id="account-role" aria-label="등록 계정 역할"><SelectValue /></SelectTrigger>
          <SelectContent>{roles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="account-target">등록 계정 대상 서비스</Label>
        <Input id="account-target" value={values.target} onChange={(event) => setValues((current) => ({ ...current, target: event.target.value }))} required disabled={pending} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "계정 저장 중" : "계정 저장"}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => setValues(emptyValues)}>입력 초기화</Button>
      </div>
      {error && <Alert variant="destructive" aria-label={error}><AlertDescription>{error}</AlertDescription></Alert>}
    </form>
  )
}
