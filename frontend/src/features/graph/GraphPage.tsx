import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ParameterMapPage } from "@/features/parameter-map/ParameterMapPage"
import { RelationshipGraphView } from "./RelationshipGraphView"

/** PR#11 `#graph`: 점검 우선순위(파라미터 Gap 그래프)가 기본이고 전체 관계 보기(Site→API 그룹→API→Object 계층)는 둘째 탭이다. */
export function GraphPage() {
  return <Tabs defaultValue="priority" className="h-full min-h-0 min-w-0 gap-0 bg-[var(--flowscope-canvas)]">
    <TabsList aria-label="그래프 보기" variant="line" className="mx-4 my-2 shrink-0">
      <TabsTrigger value="priority" className="px-3">점검 우선순위</TabsTrigger>
      <TabsTrigger value="relationships" className="px-3">전체 관계 보기</TabsTrigger>
    </TabsList>
    <TabsContent value="priority" className="min-h-0 min-w-0 flex-1"><ParameterMapPage /></TabsContent>
    <TabsContent value="relationships" className="min-h-0 min-w-0 flex-1"><RelationshipGraphView /></TabsContent>
  </Tabs>
}
