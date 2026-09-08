import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ScannerLane } from "@/lib/api/types"

function text(value: string | undefined, fallback: string): string { return value?.trim() || fallback }

export function RunLaneCard({ lane }: { lane: ScannerLane }) {
  return (
    <Card className="border-l-4 border-l-red-600">
      <CardHeader><CardTitle>{text(lane.account_label, "비로그인")} · {text(lane.status, "NOT_STARTED")}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>{text(lane.stage, "PENDING")}</p>
        <p>전체 {lane.captured_records} · Client {lane.client_captures} · Alert {lane.alert_count}</p>
        {lane.warning && <p className="text-amber-700">주의 · {lane.warning}</p>}
        {lane.error && <p className="text-destructive">오류 · {lane.error}</p>}
      </CardContent>
    </Card>
  )
}
