import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CircleSlash,
  Cpu,
  Loader2,
  RadioTower,
  Radio,
  ShieldCheck,
  Square,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  liveAuthorizationReplayApi,
  type LiveAuthorizationReplayApiClient,
  type LiveReplayBasisSource,
  type LiveReplaySnapshot,
} from "./liveAuthorizationReplayApi";

export interface ReplayAccount {
  id: string;
  name: string;
  role: string;
  status: "ACTIVE" | "SUSPECT" | "UNVERIFIED" | "CONFLICT";
  credentialConflict?: boolean;
  // NONE | LEGACY_RESPONSE | RULE_MATCHED | OPERATOR_ASSERTED
  verificationSource?: string;
}

// A session is strong enough for active cross-identity replay only when the operator asserted it or a
// stored rule matched. A weak LEGACY_RESPONSE ACTIVE session is intentionally not selectable — the
// backend enforces the same rule via headersForVerifiedAccount.
export function isStrongVerification(source: string | undefined): boolean {
  return source === "OPERATOR_ASSERTED" || source === "RULE_MATCHED";
}

export const VERIFICATION_SOURCE_LABEL: Record<string, string> = {
  OPERATOR_ASSERTED: "운영자 확인",
  RULE_MATCHED: "규칙 확인",
  LEGACY_RESPONSE: "약검증",
  NONE: "미검증",
};

export interface LiveAuthorizationReplayCardProps {
  accounts: ReplayAccount[];
  apiClient?: LiveAuthorizationReplayApiClient;
  className?: string;
}

const POLL_INTERVAL_MS = 1500;

const STATE_LABEL: Record<LiveReplaySnapshot["state"], string> = {
  STOPPED: "중지됨",
  ACTIVE: "검증 중",
  LIMIT_REACHED: "실행 상한 도달",
};

const STATUS_LABEL: Record<ReplayAccount["status"], string> = {
  ACTIVE: "활성",
  SUSPECT: "의심",
  UNVERIFIED: "미확인",
  CONFLICT: "충돌",
};

/** 고를 수 없는 계정의 이유. 상태 값 대신 사용자가 해야 할 일을 짧게 말한다. */
function unavailableReason(account: ReplayAccount): string {
  if (account.credentialConflict) return "자격 충돌";
  if (account.status !== "ACTIVE") return "세션 없음";
  return "세션 확인 필요";
}

const BASIS_SOURCES: Array<{
  id: LiveReplayBasisSource;
  label: string;
  detail: string;
  icon: typeof UserRound;
}> = [
  { id: "HUMAN", label: "HUMAN", detail: "Burp", icon: UserRound },
  { id: "SCANNER", label: "ZAP", detail: "Scanner", icon: RadioTower },
  { id: "LLM", label: "LLM", detail: "Explorer", icon: Cpu },
];

export function isAccountSelectable(account: ReplayAccount): boolean {
  return account.status === "ACTIVE" && account.credentialConflict !== true
    && isStrongVerification(account.verificationSource);
}

function METRICS(snapshot: LiveReplaySnapshot) {
  return [
    { label: "관측 요청", value: snapshot.observed },
    { label: "검증 가능", value: snapshot.eligible },
    { label: "생성된 조합", value: snapshot.queued },
    { label: "안전 요청 전송", value: snapshot.sent },
    { label: "Repeater 초안", value: snapshot.drafted },
    { label: "제외", value: snapshot.skipped },
  ];
}

export function LiveAuthorizationReplayCard({
  accounts,
  apiClient = liveAuthorizationReplayApi,
  className,
}: LiveAuthorizationReplayCardProps) {
  const [snapshot, setSnapshot] = useState<LiveReplaySnapshot | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [basisSources, setBasisSources] = useState<LiveReplayBasisSource[]>([
    "HUMAN",
  ]);
  const [includeAnonymous, setIncludeAnonymous] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await apiClient.getSnapshot();
      if (mounted.current) {
        setSnapshot(next);
        setLoadFailed(false);
      }
    } catch {
      if (mounted.current) setLoadFailed(true);
    }
  }, [apiClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const state = snapshot?.state ?? "STOPPED";

  // Polling is the only thing torn down on unmount; the run itself keeps going.
  useEffect(() => {
    if (state !== "ACTIVE") return;
    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state, refresh]);

  const selectable = useMemo(
    () => accounts.filter(isAccountSelectable).map((account) => account.id),
    [accounts],
  );

  const effectiveSelection = useMemo(
    () => selectedIds.filter((id) => selectable.includes(id)),
    [selectedIds, selectable],
  );

  const canStart =
    acknowledged &&
    basisSources.length > 0 &&
    (effectiveSelection.length > 0 || includeAnonymous) &&
    !pending &&
    state === "STOPPED";
  // 시작 버튼이 꺼져 있을 때 무엇이 빠졌는지 한 줄로 알려 준다.
  const startHint = pending || state !== "STOPPED" ? null
    : basisSources.length === 0 ? "기준 요청 출처를 1개 이상 선택하세요."
      : effectiveSelection.length === 0 && !includeAnonymous ? "대상 신원을 1개 이상 선택하세요."
        : !acknowledged ? "3번 안전 재전송을 허용하세요." : null;

  const toggleSource = (source: LiveReplayBasisSource) => {
    setBasisSources((current) =>
      current.includes(source)
        ? current.filter((item) => item !== source)
        : [...current, source],
    );
  };

  const toggleAccount = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleStart = async () => {
    setPending(true);
    setError(null);
    try {
      const next = await apiClient.startLive({
        accountIds: effectiveSelection,
        includeAnonymous,
        armed: true,
        basisSources,
      });
      if (mounted.current) setSnapshot(next);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error && error.message ? error.message : "라이브 검증을 시작할 수 없습니다.");
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const handleStop = async () => {
    setPending(true);
    setError(null);
    try {
      const next = await apiClient.stopLive();
      if (mounted.current) setSnapshot(next);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error && error.message ? error.message : "라이브 검증을 중지할 수 없습니다.");
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const isRunning = state === "ACTIVE";
  const hasRunResult = snapshot !== null && state !== "STOPPED";

  return (
    <Card className={cn("border-border/70 bg-card", className)}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Radio className="size-4 text-primary" aria-hidden="true" />
              라이브 교차 신원 검증
            </CardTitle>
            <CardDescription>
              HUMAN·ZAP·LLM에서 관측한 요청을 선택한 신원으로 안전하게 교차 검증합니다.
            </CardDescription>
          </div>
          <Badge
            variant={state === "ACTIVE" ? "default" : "secondary"}
            className="font-mono text-[11px] tracking-wide"
            data-testid="replay-state-badge"
          >
            {state === "ACTIVE" ? (
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            ) : state === "LIMIT_REACHED" ? (
              <AlertTriangle className="size-3" aria-hidden="true" />
            ) : (
              <Square className="size-3" aria-hidden="true" />
            )}
            {STATE_LABEL[state]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {!hasRunResult && (
          <>
            <fieldset className="space-y-2" disabled={pending || isRunning}>
              <legend className="mb-2 text-xs font-medium text-muted-foreground">
                1. 기준 요청 출처
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {BASIS_SOURCES.map((source) => {
                  const Icon = source.icon;
                  return (
                    <label
                      key={source.id}
                      className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 hover:border-border hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={basisSources.includes(source.id)}
                        onCheckedChange={() => toggleSource(source.id)}
                        aria-label={`${source.label} 기준 요청`}
                      />
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{source.label}</span>
                        <span className="block text-xs text-muted-foreground">{source.detail}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <legend className="text-xs font-medium text-muted-foreground">
                  2. 교차 검증 대상 신원
                </legend>
                {selectable.length < accounts.length && (
                  <span className="text-xs text-muted-foreground">
                    사용 가능 {selectable.length} / {accounts.length} ·{" "}
                    <a href="#accounts" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">계정·세션에서 세션 캡처 →</a>
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {accounts.map((account) => {
                  const enabled = isAccountSelectable(account);
                  const checked = selectedIds.includes(account.id);
                  return (
                    <li key={account.id}>
                      <label
                        className={cn(
                          "flex items-center gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 transition-colors",
                          enabled
                            ? "cursor-pointer hover:border-border hover:bg-muted/60"
                            : "cursor-not-allowed opacity-55",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={!enabled || pending || isRunning}
                          onCheckedChange={() => toggleAccount(account.id)}
                          aria-label={account.name}
                        />
                        <UserRound
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {account.name}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {account.role}
                        </span>
                        {enabled ? (
                          <Badge variant="outline" className="text-[10px]" title={account.status}>
                            {STATUS_LABEL[account.status]}
                          </Badge>
                        ) : (
                          <span className={cn("flex items-center gap-1 text-xs", account.credentialConflict ? "text-destructive" : "text-muted-foreground")} title={account.status}>
                            {account.credentialConflict && <CircleSlash className="size-3" aria-hidden="true" />}
                            {unavailableReason(account)}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>

              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 hover:border-border hover:bg-muted/60">
                <Checkbox
                  checked={includeAnonymous}
                  onCheckedChange={(value) => setIncludeAnonymous(value === true)}
                  disabled={pending || isRunning}
                  aria-label="비로그인(ANON) 포함"
                />
                <Ban className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">비로그인(ANON) 포함</span>
              </label>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">3. 안전 재전송 승인</legend>
              <label className={cn("flex cursor-pointer items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5 hover:bg-muted/60", acknowledged ? "border-border" : "border-border/60")}>
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(value) => setAcknowledged(value === true)}
                aria-label="안전 자동 재전송을 허용합니다."
                disabled={pending || isRunning}
              />
              <span className="flex-1 text-sm">GET/HEAD 안전 자동 재전송을 허용합니다.</span>
              <span className={cn("text-xs", acknowledged ? "font-medium text-foreground" : "text-muted-foreground")}>{acknowledged ? "켜짐" : "꺼짐"}</span>
              </label>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleStart} disabled={!canStart}>
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                라이브 검증 시작
              </Button>
              {startHint && <span className="text-xs text-muted-foreground">{startHint}</span>}
            </div>
          </>
        )}

        {hasRunResult && snapshot && (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {METRICS(snapshot).map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5"
                >
                  <dt className="text-xs text-muted-foreground">
                    {metric.label}
                  </dt>
                  <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
                    {metric.value}
                  </dd>
                </div>
              ))}
            </dl>

            {snapshot.lastReason && (
              <p className="font-mono text-xs text-muted-foreground">
                최근 사유 · {snapshot.lastReason}
              </p>
            )}

            {state === "LIMIT_REACHED" && (
              <p
                role="status"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                안전 상한인 200개 조합에 도달했습니다. 새 실행을 시작하려면 현재
                실행을 중지하세요.
              </p>
            )}

            <Button
              variant="destructive"
              onClick={handleStop}
              disabled={pending}
            >
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              라이브 검증 중지
            </Button>
          </>
        )}

        <p className="flex items-start gap-2 border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck
            className="mt-0.5 size-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
          GET/HEAD만 자동 전송됩니다. POST/PUT/PATCH/DELETE는 Burp Repeater
          초안으로만 생성됩니다.
        </p>

        {loadFailed && (
          <p role="alert" className="text-xs text-destructive">
            실행 상태를 불러오지 못했습니다.{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => void refresh()}>다시 시도</button>
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default LiveAuthorizationReplayCard;
