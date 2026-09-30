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
  /** 표 형태 피드의 오른쪽 시각 열(HH:MM:SS). */
  time?: string
  /** 계정 열을 회색으로(비로그인·미등록 로그인). */
  mutedDetail?: boolean
}

export interface SourcePassLayoutProps {
  /** 소스 이름(HUMAN·ZAP·LLM). aria-label 접두어로만 쓴다. */
  label: string
  title: string
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
  feedContent?: ReactNode
  notices?: ReactNode
}

/**
 * HUMAN·ZAP·LLM 세 단계가 같은 틀(제목·한 문장 카드 + 선택적 오른쪽 카드 + 작업 피드)로 보이게 하는 공통 레이아웃.
 * 카드 안 모든 줄은 같은 왼쪽 선과 16px 간격을 쓴다.
 */
export function SourcePassLayout({
  label, title, description, statusTiles = [], control, aside,
  feedItems, feedTitle, feedDescription, emptyHint, feedBadge, feedFooter, feedContent, notices,
}: SourcePassLayoutProps) {
  return (
    <section className="grid gap-4" aria-label={`${label} 실행 영역`}>
      {notices}

      <div className={aside ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" : "grid gap-4"}>
        <Card className="gap-0 py-0">
          <CardContent className="grid gap-4 p-5">
            <div><h2 className="text-base font-semibold">{title}</h2>{description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}</div>
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
