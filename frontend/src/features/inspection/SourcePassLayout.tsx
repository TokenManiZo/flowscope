import { useRef, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RecordResizeHandle, useRecordView, type RecordView } from "./RecordView"

export interface SourceStatusTile {
  label: string
  value: string
  mono?: boolean
}

export interface SourceFeedItem {
  id: string
  badge: string
  ordinal?: string
  title: string
  status: string
  detail?: string
  /** 표 형태 피드의 오른쪽 시각 열(HH:MM:SS). */
  time?: string
  /** 계정 열을 회색으로(비로그인·미등록 로그인). */
  mutedDetail?: boolean
}

export interface SourcePassLayoutProps {
  /** 소스 이름(HUMAN·ZAP·LLM). aria-label 접두어로만 쓴다. */
  label: string
  title: string
  titleControl?: ReactNode
  onRecordFocusChange?(focused: boolean): void
  /** 이 단계가 무엇을 하는지 한 문장. */
  description?: string
  /** 실행 중일 때만 넘긴다. 비어 있으면 타일 줄을 그리지 않는다. */
  statusTiles?: readonly SourceStatusTile[]
  control: ReactNode
  /** 오른쪽 좁은 카드(예: 계정별 수집 표). */
  aside?: ReactNode
  feedItems: readonly SourceFeedItem[]
  feedTitle: string
  feedDescription?: string
  emptyHint: string
  feedBadge?: ReactNode
  feedFooter?: ReactNode
  feedContent?: ReactNode | ((view: RecordView) => ReactNode)
  notices?: ReactNode
}

/**
 * HUMAN·ZAP·LLM 세 단계가 같은 틀(제목·한 문장 카드 + 선택적 오른쪽 카드 + 작업 피드)로 보이게 하는 공통 레이아웃.
 * 카드 안 모든 줄은 같은 왼쪽 선과 16px 간격을 쓴다.
 */
export function SourcePassLayout({
  label, title, titleControl, onRecordFocusChange, description, statusTiles = [], control, aside,
  feedItems, feedTitle, feedDescription, emptyHint, feedBadge, feedFooter, feedContent, notices,
}: SourcePassLayoutProps) {
  const root = useRef<HTMLElement>(null)
  const view = useRecordView(root, onRecordFocusChange)
  const resizable = typeof feedContent === "function"
  return (
    <section ref={root} onKeyDown={view.onKeyDown} className={view.focused ? "flex h-full min-h-0 flex-col gap-3" : "grid gap-2"} aria-label={`${label} 실행 영역`}>
      {notices}

      <div hidden={view.focused} className={view.focused ? "hidden" : aside ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" : "grid gap-4"}>
        <Card className="gap-0 py-0">
          <CardContent className="grid gap-4 p-5">
            <div className="flex items-start justify-between gap-6"><div><h2 className="text-base font-semibold">{title}</h2>{description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}</div>{titleControl}</div>
            {statusTiles.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={`${label} 실행 상태`} role="group">
              {statusTiles.map((tile) => (
                <div key={tile.label} className="rounded-lg bg-muted px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{tile.label}</p>
                  <p className={tile.mono ? "font-mono text-sm font-medium break-all" : "font-semibold"}>{tile.value}</p>
                </div>
              ))}
            </div>}
            {control}
          </CardContent>
        </Card>
        {aside}
      </div>

      {resizable && !view.focused && <RecordResizeHandle label={feedTitle} height={view.height} onHeightChange={view.setHeight} />}
      {(typeof feedContent === "function" ? feedContent(view) : feedContent) ?? <Card className="flex min-h-[20rem] flex-col overflow-hidden">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">{feedTitle}</CardTitle>
              {feedDescription && <CardDescription>{feedDescription}</CardDescription>}
            </div>
            {feedBadge}
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
          {/* The card had a floor and no ceiling, so overflow-y-auto never fired and the card grew without end,
              pushing the footer off screen. The cap is what makes this list actually scroll. */}
          <div className="max-h-[34rem] flex-1 space-y-3 overflow-y-auto p-4">
            {feedItems.length ? feedItems.map((item) => (
              /* Three real columns: the status used to share a wrapping flex row with the title, so it landed in a
                 different place on every line. */
              <article className="grid grid-cols-[4.5rem_minmax(0,1fr)_6rem] items-start gap-3 border-b border-border/60 pb-3" key={item.id}>
                {/* Fixed width: badges vary from AUTH to WARNING, and a shrink-to-fit column ragged the titles. */}
                <Badge variant="outline" className="h-fit w-full justify-center">{item.badge}</Badge>
                <div className="min-w-0">
                  <p className="font-medium">{item.title}</p>
                  {item.detail && <p className="break-all text-sm text-muted-foreground">{item.detail}</p>}
                </div>
                <span className="text-center font-mono text-xs break-words text-muted-foreground">{item.status}</span>
              </article>
            )) : <p className="py-10 text-center text-sm text-muted-foreground">{emptyHint}</p>}
          </div>
          {feedFooter}
        </CardContent>
      </Card>}
    </section>
  )
}
