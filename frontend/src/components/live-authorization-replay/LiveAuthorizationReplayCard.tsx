import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CircleSlash,
  Loader2,
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
  type LiveReplaySnapshot,
} from "./liveAuthorizationReplayApi";

export interface ReplayAccount {
  id: string;
  name: string;
  role: string;
  status: "ACTIVE" | "SUSPECT" | "UNVERIFIED" | "CONFLICT";
  credentialConflict?: boolean;
}

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
  ACTIVE: "ACTIVE",
  SUSPECT: "SUSPECT",
  UNVERIFIED: "UNVERIFIED",
  CONFLICT: "CONFLICT",
};

export function isAccountSelectable(account: ReplayAccount): boolean {
  return account.status === "ACTIVE" && account.credentialConflict !== true;
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
  const [includeAnonymous, setIncludeAnonymous] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      }
    } catch {
      if (mounted.current) {
        setError("실행 상태를 불러올 수 없습니다.");
      }
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
    (effectiveSelection.length > 0 || includeAnonymous) &&
    !pending;

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
      });
      if (mounted.current) setSnapshot(next);
    } catch {
      if (mounted.current) setError("라이브 검증을 시작할 수 없습니다.");
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
    } catch {
      if (mounted.current) setError("라이브 검증을 중지할 수 없습니다.");
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const isRunning = state === "ACTIVE" || state === "LIMIT_REACHED";

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
              사람이 발생시킨 요청을 선택한 다른 신원으로 안전하게 교차
              검증합니다.
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
        {!isRunning && (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                대상 신원
              </legend>
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
                          disabled={!enabled}
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
                        <Badge
                          variant={
                            account.status === "ACTIVE" ? "outline" : "secondary"
                          }
                          className="font-mono text-[10px]"
                        >
                          {STATUS_LABEL[account.status]}
                        </Badge>
                        {account.credentialConflict && (
                          <span className="flex items-center gap-1 font-mono text-[10px] text-destructive">
                            <CircleSlash className="size-3" aria-hidden="true" />
                            자격 충돌
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
                  aria-label="비로그인(ANON) 포함"
                />
                <Ban className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">비로그인(ANON) 포함</span>
              </label>
            </fieldset>

            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(value) => setAcknowledged(value === true)}
                aria-label="안전 자동 재전송을 허용합니다."
                className="mt-0.5"
              />
              <span className="text-sm">안전 자동 재전송을 허용합니다.</span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleStart} disabled={!canStart}>
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                라이브 검증 시작
              </Button>
            </div>
          </>
        )}

        {isRunning && snapshot && (
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
