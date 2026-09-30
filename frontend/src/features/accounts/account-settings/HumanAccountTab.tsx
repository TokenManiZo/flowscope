import { useState, type ReactNode } from "react";
import { ChevronDown, ClipboardPaste } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RawViewer, statusTone } from "@/features/inspection/HumanRequestFeed";
import type { AccountSettingsDraft } from "./AccountSettingsSheet";
import { HUMAN_STATUS_META } from "./statusMeta";
import type { AccountSettings, AccountSettingsAdapter, BurpRequestCandidate, LoginProofRule } from "./types";

type Run = (task: () => Promise<AccountSettings | void>) => Promise<void>;

/** 서버가 저장하는 헤더(SessionBroker 관리 헤더)와 같은 목록. 붙여넣기 미리보기에만 쓴다. */
const STORED_HEADERS = /^(authorization|cookie|x-csrf-token|x-xsrf-token|x-csrftoken)$/i;

function clock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}

/** 붙여넣은 블록의 헤더 이름과 저장 여부. 요청 줄처럼 이름이 없는 줄은 건너뛴다. */
export function pastedHeaderNames(block: string): Array<{ name: string; stored: boolean }> {
  return block.split(/\r?\n/).flatMap((line) => {
    const colon = line.indexOf(":");
    const name = colon > 0 ? line.slice(0, colon).trim() : "";
    return name && !/\s/.test(name) ? [{ name, stored: STORED_HEADERS.test(name) }] : [];
  });
}

function Fold({ value, title, hint, info, children }: { value: string; title: string; hint?: string; info: ReactNode; children: ReactNode }) {
  return <AccordionItem value={value} className="rounded-lg border border-border px-4 last:border-b">
    <div className="flex items-center gap-1"><AccordionTrigger className="flex-1">{title}{hint && <span className="ml-2 mr-auto text-xs font-normal text-muted-foreground">{hint}</span>}</AccordionTrigger><InfoHint label={title}>{info}</InfoHint></div>
    <AccordionContent className="space-y-3">{children}</AccordionContent>
  </AccordionItem>;
}

function StoredCredentials({ settings, pending, run, adapter }: { settings: AccountSettings; pending: boolean; run: Run; adapter: AccountSettingsAdapter }) {
  const [editing, setEditing] = useState(false);
  const [block, setBlock] = useState("");
  const [error, setError] = useState("");
  const credentials = settings.human.credentials ?? [];
  const hasSession = settings.human.status !== "UNVERIFIED" && settings.human.status !== "REVOKED";
  const names = pastedHeaderNames(block);
  const source = settings.human.verificationSource === "OPERATOR_ASSERTED" ? "직접 입력" : "자동 수집";
  const updated = settings.human.lastRecordedAt ? ` · ${clock(settings.human.lastRecordedAt)}` : "";
  const save = () => {
    if (!names.some((header) => header.stored)) { setError("Cookie나 Authorization 헤더를 찾지 못했어요."); return; }
    void run(async () => { const next = await adapter.registerCredential(settings.id, block); setBlock(""); setEditing(false); return next; });
  };
  return <section aria-label="저장된 인증값" className="rounded-lg border border-border p-4">
    <div className="flex items-center gap-1.5">
      <h3 className="font-medium">저장된 인증값</h3>
      <InfoHint label="저장된 인증값">이 계정이 로그인했다는 증거(쿠키·토큰)예요. 이 값으로 요청을 다시 보낼 수 있어요.</InfoHint>
      {credentials.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{source}{updated}</span>}
    </div>
    {credentials.length ? <dl className="mt-3 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 font-mono text-xs">
      {credentials.map((credential) => <div key={credential.name} className="contents"><dt className="text-muted-foreground">{credential.name}</dt><dd className="truncate" title={credential.preview}>{credential.preview}</dd></div>)}
    </dl> : <p className="mt-2 text-sm text-muted-foreground">아직 없어요. 점검에서 이 계정으로 둘러보면 자동으로 채워져요.</p>}
    {editing ? <div className="mt-3 space-y-2">
      <Label htmlFor="cred-headers" className="text-xs font-normal text-muted-foreground">Burp 요청의 헤더를 그대로 붙여넣으세요.</Label>
      <Textarea id="cred-headers" value={block} onChange={(event) => { setBlock(event.target.value); setError(""); }} rows={5} className="font-mono text-xs" placeholder={"Authorization: Bearer ...\nCookie: session=..."} autoComplete="off" spellCheck={false} />
      {names.length > 0 && <ul aria-label="붙여넣은 헤더" className="flex flex-wrap gap-1.5">{names.map((header, index) => <li key={`${header.name}-${index}`} className={`rounded-md px-2 py-0.5 font-mono text-[11px] ${header.stored ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{header.stored ? "저장" : "무시"} · {header.name}</li>)}</ul>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2"><Button size="sm" disabled={pending || !block.trim()} onClick={save}>저장</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(false); setBlock(""); setError(""); }}>취소</Button></div>
    </div> : <div className="mt-3 flex gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}><ClipboardPaste aria-hidden="true" />헤더 붙여넣기로 {credentials.length ? "교체" : "입력"}</Button>
      {hasSession && <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => void run(() => adapter.revokeHumanSession(settings.id))}>인증값 지우기</Button>}
    </div>}
  </section>;
}

const CANDIDATE_COLUMNS = "grid grid-cols-[3.5rem_4.5rem_minmax(0,1fr)_auto_1rem] items-center gap-3";

function CandidateRow({ candidate, open, onToggle, onLink, pending }: { candidate: BurpRequestCandidate; open: boolean; onToggle: () => void; onLink: () => void; pending: boolean }) {
  return <li className="border-t border-border first:border-t-0">
    <div className={`${CANDIDATE_COLUMNS} px-3 py-2 text-sm hover:bg-muted/50`}>
      <span><span className={`rounded-full px-2 py-0.5 font-mono text-xs ${statusTone(String(candidate.status))}`}>{candidate.status}</span></span>
      <span><span className="inline-block min-w-12 rounded border border-border px-1.5 text-center font-mono text-[11px]">{candidate.method}</span></span>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${candidate.method} ${candidate.path} 원문 ${open ? "접기" : "보기"}`} className="truncate text-left font-mono text-xs focus-visible:outline-none" title={candidate.path}>{candidate.path}</button>
      {candidate.eligible ? <Button size="sm" variant="outline" disabled={pending} onClick={onLink}>이 요청 연결</Button>
        : <span className="text-xs text-muted-foreground" title={candidate.reason}>연결 불가</span>}
      <button type="button" onClick={onToggle} tabIndex={-1} aria-hidden="true" className="text-muted-foreground"><ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>
    </div>
    {open && <div className="grid gap-3 bg-muted/30 p-3 lg:grid-cols-2">
      {!candidate.eligible && <p className="text-xs text-muted-foreground lg:col-span-2">{candidate.reason}</p>}
      <RawViewer label="요청" value={candidate.request ?? ""} available={Boolean(candidate.request)} />
      <RawViewer label="응답" value={candidate.response ?? ""} available={Boolean(candidate.response)} />
    </div>}
  </li>;
}

/** 세션은 HUMAN pass가 잡는다. 여기서는 저장된 인증값을 보여 주고, 필요할 때만 펼치는 보조 기능을 둔다. */
export function HumanAccountTab({ settings, draft, patch, pathError, markError, pending, run, adapter }: {
  settings: AccountSettings; draft: AccountSettingsDraft; patch: (value: Partial<AccountSettingsDraft>) => void;
  pathError: string | null; markError: string | null; pending: boolean; run: Run; adapter: AccountSettingsAdapter;
}) {
  const [openCandidate, setOpenCandidate] = useState<string | null>(null);
  const tiles: Array<[string, string, boolean]> = [
    ["인증값", settings.human.credentialConflict ? "자격 충돌" : HUMAN_STATUS_META[settings.human.status].label, false],
    ["마지막 기록", settings.human.lastRecordedAt ? clock(settings.human.lastRecordedAt) : "—", true],
    ["마지막 API", settings.human.lastRecordedApi || "—", true],
  ];
  return <TabsContent value="human" className="space-y-4">
    <div className="grid grid-cols-3 gap-3" role="group" aria-label="HUMAN 인증값 요약">{tiles.map(([label, value, mono]) => <div key={label} className="min-w-0 rounded-lg bg-muted px-3 py-2.5"><p className="text-xs text-muted-foreground">{label}</p><p title={value} className={mono ? "truncate font-mono text-sm font-medium" : "font-semibold"}>{value}</p></div>)}</div>
    <StoredCredentials settings={settings} pending={pending} run={run} adapter={adapter} />
    <Accordion type="multiple" className="space-y-2">
      <Fold value="candidates" title="기록된 요청에서 가져오기" info="이미 Burp에 기록된 요청 하나를 골라, 그 요청의 로그인 값을 이 계정에 저장해요.">
        {settings.candidates.length ? <ul aria-label="기록된 요청" className="overflow-hidden rounded-md border border-border">
          {settings.candidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} pending={pending} open={openCandidate === candidate.id}
            onToggle={() => setOpenCandidate((current) => current === candidate.id ? null : candidate.id)}
            onLink={() => void run(() => adapter.linkBurpRequest(settings.id, candidate.id))} />)}
        </ul> : <p className="text-sm text-muted-foreground">연결할 수 있는 요청이 없어요.{settings.candidateBlockReasons[0] ? ` ${settings.candidateBlockReasons[0]}` : ""}</p>}
      </Fold>
      <Fold value="proof" title="로그인 확인 규칙" hint="선택" info={"\"이 주소에서 이 글자가 보이면 로그인 성공\"이라고 알려 주는 규칙이에요. 비워 둬도 돼요."}>
        <div className="grid gap-2 sm:grid-cols-[7rem_1fr]"><div className="grid gap-1.5"><Label htmlFor="proof-method">method</Label><Select value={draft.proof.method} onValueChange={(value) => patch({ proof: { ...draft.proof, method: value as LoginProofRule["method"] } })}><SelectTrigger id="proof-method"><SelectValue /></SelectTrigger><SelectContent>{["GET", "HEAD", "POST"].map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1.5"><Label htmlFor="proof-path">검증 요청 path</Label><Input id="proof-path" value={draft.proof.path} onChange={(event) => patch({ proof: { ...draft.proof, path: event.target.value } })} className="font-mono" /></div></div>
        {pathError && <p role="alert" className="text-xs text-destructive">{pathError}</p>}
        <div className="grid gap-1.5"><Label htmlFor="proof-mark">응답 표식</Label><Input id="proof-mark" value={draft.proof.responseMark} onChange={(event) => patch({ proof: { ...draft.proof, responseMark: event.target.value } })} className="font-mono" />{markError && <p role="alert" className="text-xs text-destructive">{markError}</p>}</div>
        <p className="text-xs text-muted-foreground">둘 다 비우면 규칙을 지워요.</p>
      </Fold>
    </Accordion>
  </TabsContent>;
}
