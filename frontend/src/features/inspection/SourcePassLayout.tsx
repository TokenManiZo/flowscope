import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export interface SourceStatusTile {
  label: string
  value: string
  mono?: boolean
}

export interface SourceFeedItem {
  id: string
  badge: string
  title: string
  status: string
  detail?: string
}

export interface SourcePassLayoutProps {
  /** 소스 이름(HUMAN·ZAP·LLM). aria-label 접두어로만 쓴다. */
  label: string
  title: string
  statusTiles: readonly SourceStatusTile[]
  control: ReactNode
  controlTitle?: string
  feedItems: readonly SourceFeedItem[]
  feedTitle: string
  feedDescription?: string
  emptyHint: string
  feedBadge?: ReactNode
  feedFooter?: ReactNode
  feedContent?: ReactNode
  notices?: ReactNode
}

/** HUMAN·ZAP·LLM 세 소스가 같은 형식(상태 타일 + 실행 컨트롤 + 작업 피드)으로 보이도록 하는 공통 레이아웃. */
export function SourcePassLayout({
  label, title, statusTiles, control, controlTitle = "실행 설정",
  feedItems, feedTitle, feedDescription, emptyHint, feedBadge, feedFooter, feedContent, notices,
}: SourcePassLayoutProps) {
  return (
    <section className="grid gap-3" aria-label={`${label} 실행 영역`}>
      <h2 className="text-xl font-semibold">{title}</h2>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={`${label} 실행 상태`} role="group">
        {statusTiles.map((tile) => (
          <Card key={tile.label}>
            <CardHeader className="pb-2">
              <CardDescription>{tile.label}</CardDescription>
              <CardTitle className={tile.mono ? "font-mono text-base break-all" : "text-base"}>{tile.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {notices}

      <Card className="border-border/70 bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">{controlTitle}</CardTitle></CardHeader>
        <CardContent>{control}</CardContent>
      </Card>

      {feedContent ?? <Card className="flex min-h-[20rem] flex-col overflow-hidden">
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
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {feedItems.length ? feedItems.map((item) => (
              <article className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-border/60 pb-3" key={item.id}>
                <Badge variant="outline" className="h-fit">{item.badge}</Badge>
                <div className="min-w-0">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-medium">{item.title}</p>
                    <span className="font-mono text-xs text-muted-foreground">{item.status}</span>
                  </div>
                  {item.detail && <p className="break-all text-sm text-muted-foreground">{item.detail}</p>}
                </div>
              </article>
            )) : <p className="py-10 text-center text-sm text-muted-foreground">{emptyHint}</p>}
          </div>
          {feedFooter}
        </CardContent>
      </Card>}
    </section>
  )
}
