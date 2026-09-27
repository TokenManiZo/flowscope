import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock3,
  HelpCircle,
  Link2Off,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

import type {
  ExplorerLoginStatus,
  HumanSessionStatus,
  VerificationSource,
  ZapLoginStatus,
} from "./types";

type Tone = "ok" | "warn" | "bad" | "idle";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  warn: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  bad: "border-destructive/50 text-destructive",
  idle: "border-border text-muted-foreground",
};

const TONE_ICON: Record<Tone, LucideIcon> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
  idle: HelpCircle,
};

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon?: LucideIcon;
}

export const HUMAN_STATUS_META: Record<HumanSessionStatus, StatusMeta> = {
  ACTIVE: { label: "활성", tone: "ok" },
  CAPTURING: { label: "캡처 중", tone: "warn", icon: Clock3 },
  UNVERIFIED: { label: "미확인", tone: "idle" },
  SUSPECT: { label: "의심", tone: "warn" },
  REAUTH_REQUIRED: { label: "재로그인 필요", tone: "warn" },
  REVOKED: { label: "폐기됨", tone: "bad", icon: Link2Off },
};

export const VERIFICATION_META: Record<VerificationSource, StatusMeta> = {
  OPERATOR_ASSERTED: { label: "운영자 확인", tone: "ok" },
  RULE_MATCHED: { label: "규칙 확인", tone: "ok" },
  LEGACY_RESPONSE: { label: "약검증", tone: "warn" },
  NONE: { label: "미검증", tone: "idle" },
};

export const ZAP_STATUS_META: Record<ZapLoginStatus, StatusMeta> = {
  UNVERIFIED: { label: "미확인", tone: "idle" },
  AUTHENTICATING: { label: "로그인 중", tone: "warn", icon: Clock3 },
  VERIFIED_BY_ZAP: { label: "ZAP 확인됨", tone: "ok" },
  FAILED: { label: "실패", tone: "bad" },
};

export const EXPLORER_STATUS_META: Record<ExplorerLoginStatus, StatusMeta> = {
  UNVERIFIED: { label: "미확인", tone: "idle" },
  READY: { label: "준비됨", tone: "ok" },
  NEEDS_INPUT: { label: "입력 필요", tone: "warn" },
  EXPIRED: { label: "만료", tone: "warn", icon: Clock3 },
  FAILED: { label: "실패", tone: "bad" },
};

/** 색상만으로 상태를 구분하지 않도록 텍스트와 아이콘을 함께 표시한다. */
export function StatusBadge({ meta }: { meta: StatusMeta }) {
  const Icon = meta.icon ?? TONE_ICON[meta.tone];
  return (
    <Badge
      variant="outline"
      className={`gap-1 font-mono text-[11px] ${TONE_CLASS[meta.tone]}`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

export function ConflictBadge() {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-destructive/50 font-mono text-[11px] text-destructive"
    >
      <CircleSlash className="size-3" aria-hidden="true" />
      자격 충돌
    </Badge>
  );
}
