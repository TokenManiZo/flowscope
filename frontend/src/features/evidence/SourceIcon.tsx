import { Bot, CircleHelp, ScanLine, UserRound } from "lucide-react"

import type { Source } from "@/lib/api/types"

/** 요청 주체 아이콘. 그래프 카드·범례와 같은 모양·색을 쓴다(HUMAN 사람, SCANNER 스캐너, LLM 로봇). */
const sourceIcons: Record<Source, { Icon: typeof UserRound; className: string; label: string }> = {
  human: { Icon: UserRound, className: "text-blue-600 dark:text-blue-400", label: "사람" },
  scanner: { Icon: ScanLine, className: "text-red-600 dark:text-red-400", label: "스캐너" },
  llm: { Icon: Bot, className: "text-zinc-700 dark:text-zinc-300", label: "LLM" },
  unknown: { Icon: CircleHelp, className: "text-zinc-500", label: "미확인" },
}

export function SourceIcon({ source, labelled = false }: { source: Source; labelled?: boolean }) {
  const { Icon, className, label } = sourceIcons[source] ?? sourceIcons.unknown
  return <Icon role={labelled ? "img" : undefined} aria-label={labelled ? label : undefined} aria-hidden={labelled ? undefined : true} className={`size-3.5 shrink-0 ${className}`} />
}
