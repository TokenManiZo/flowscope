import type { ReactNode } from "react"

import { InfoHint } from "@/components/ui/info-hint"
import { cn } from "@/lib/utils"

export type RequestLabCredentialMode = "ORIGINAL" | "ANONYMOUS" | "ACCOUNT"

/** 인증 방식 단어(Bearer 등)와 앞 4자만 남긴다. 서버 SessionBroker.preview와 같은 규칙. */
export function credentialPreview(value: string): string {
  const trimmed = value.trim()
  const space = trimmed.indexOf(" ")
  const scheme = space > 0 && space < 16 ? trimmed.slice(0, space + 1) : ""
  const secret = trimmed.slice(scheme.length).trim()
  return `${scheme}${secret.length >= 12 ? secret.slice(0, 4) : ""}••••`
}

/** 원 요청에서 인증값 하나를 골라 가린 미리보기를 만든다(Authorization 우선). */
export function requestCredentialPreview(request: string): string | null {
  const headers = request.split(/\r?\n/)
  for (const name of ["authorization", "cookie"]) {
    const line = headers.find((header) => header.toLowerCase().startsWith(`${name}:`))
    if (line) return `${line.slice(0, line.indexOf(":"))}: ${credentialPreview(line.slice(line.indexOf(":") + 1))}`
  }
  return null
}

const MODES: ReadonlyArray<{ mode: RequestLabCredentialMode; label: string; description: string }> = [
  { mode: "ORIGINAL", label: "원문", description: "기록된 요청을 한 글자도 바꾸지 않고 그대로 보내요." },
  { mode: "ANONYMOUS", label: "비로그인", description: "인증값(쿠키·토큰)을 빼고 보내요. 로그인 없이도 열리는지 볼 때 써요." },
  { mode: "ACCOUNT", label: "현재 세션", description: "원 요청의 인증값을 현재 세션의 최신 인증값으로 바꿔서 보내요." },
]

function IdentityBox({ title, info, name, badge, detail }: { title: string; info: string; name: string; badge?: ReactNode; detail: string }) {
  return <div className="grid min-w-0 gap-1 rounded-lg bg-muted/60 px-3 py-2.5">
    <p className="flex items-center gap-1 text-xs text-muted-foreground">{title}<InfoHint label={title}>{info}</InfoHint></p>
    <p className="flex min-w-0 items-center gap-1.5 font-medium"><span className="truncate">{name}</span>{badge}</p>
    <p className="truncate font-mono text-xs text-muted-foreground" title={detail}>{detail}</p>
  </div>
}

interface Props {
  service: string
  identity: string
  observedCredential: string | null
  requestRetained: boolean
  responseRetained: boolean
  /** 지금 수집 중이거나 가장 최근에 기록된 신원의 세션. 없으면 "현재 세션"을 고를 수 없다. */
  currentSession: { label: string; credential: string | null } | null
  credentialMode: RequestLabCredentialMode
  disabled?: boolean
  hideCredentialControl?: boolean
  onCredentialModeChange(mode: RequestLabCredentialMode): void
}

export function RequestLabMetadata({ service, identity, observedCredential, requestRetained, responseRetained, currentSession, credentialMode, disabled = false, hideCredentialControl = false, onCredentialModeChange }: Props) {
  const selected = MODES.find((item) => item.mode === credentialMode) ?? MODES[0]
  return <section aria-label="Request Lab 메타데이터" className="grid content-start gap-4 bg-muted/20 p-4 lg:grid-cols-3">
    <dl className="grid gap-1 text-sm">
      <dt className="text-xs text-muted-foreground">서비스</dt><dd className="break-all">서비스: {service}</dd>
      {(!requestRetained || !responseRetained) && <dd className="text-xs text-muted-foreground">요청 {requestRetained ? "보존" : "미보존"} · 응답 {responseRetained ? "보존" : "미보존"}</dd>}
    </dl>
    <div className="grid gap-2">
      <IdentityBox title="트래픽 신원" info="이 요청을 보낸 계정의 당시 인증값이에요." name={identity} detail={observedCredential ?? "인증값 없음"} />
      <IdentityBox title="현재 세션" info="지금 수집 중인 계정의 최신 인증값이에요."
        name={currentSession?.label ?? "없음"}
        detail={currentSession ? currentSession.credential ?? "확인 중" : "아직 저장된 최신 인증값이 없어요."} />
    </div>
    {!hideCredentialControl && <div className="grid gap-2">
      <p id="request-lab-mode-label" className="text-sm font-medium">어떤 인증값으로 보낼까요?</p>
      <div role="radiogroup" aria-labelledby="request-lab-mode-label" className="grid grid-cols-3 overflow-hidden rounded-lg border border-border">
        {MODES.map(({ mode, label }) => <button key={mode} type="button" role="radio" aria-checked={credentialMode === mode}
          disabled={disabled || (mode === "ACCOUNT" && !currentSession)} onClick={() => onCredentialModeChange(mode)}
          className={cn("border-r border-border px-2 py-1.5 text-sm last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50", credentialMode === mode ? "bg-primary font-medium text-primary-foreground" : "hover:bg-muted")}>{label}</button>)}
      </div>
      <p className="text-xs text-muted-foreground">{selected.description}</p>
    </div>}
  </section>
}
