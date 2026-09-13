package io.flowscope.core.graph;

import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.ToolKind;
import io.flowscope.core.RunPhase;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Verdict;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 플로우 그래프 모델 (기능명세서 F-07/F-08, 설계서 §4.6).
 * 배치: 요청자(identity) -> 객체(resource) -> 엔드포인트(operation). 소유자 노드는 없다(D-006).
 * 엣지는 관측한 소스 집합을 들고 있어 오버레이(겹쳐보기) 스타일에 쓰인다(F-08).
 */
public final class FlowGraph {

    public enum NodeType { IDENTITY, RESOURCE, OPERATION }
    public enum EdgeType { ACCESS, CALLS, FLOW }

    public static final class Node {
        public final String id;
        public final String label;
        public final NodeType type;
        public Verdict verdict = Verdict.UNTESTED;
        Node(String id, String label, NodeType type) {
            this.id = id; this.label = label; this.type = type;
        }
    }

    public static final class Edge {
        public final String id;
        public final String from;
        public final String to;
        public final EdgeType type;
        /** 이 엣지를 만든 신원. 겹침 판정은 같은 신원 안에서만 의미가 있다. */
        public final String idn;
        public final Set<Source> sources = EnumSet.noneOf(Source.class);
        public final Set<SourceDetail> sourceDetails = new java.util.LinkedHashSet<>();
        public final Set<Orchestrator> orchestrators = EnumSet.noneOf(Orchestrator.class);
        public final Set<ToolKind> tools = EnumSet.noneOf(ToolKind.class);
        public final Set<RunPhase> phases = EnumSet.noneOf(RunPhase.class);
        public final Set<String> runIds = new java.util.LinkedHashSet<>();
        public final Set<String> evidenceIds = new java.util.LinkedHashSet<>();
        /** 동일 관계를 합치고 누적한 관측 횟수 (F-07). */
        public int count;
        Edge(String id, String from, String to, EdgeType type, String idn) {
            this.id = id; this.from = from; this.to = to; this.type = type; this.idn = idn;
        }
    }

    private final Map<String, Node> nodes = new LinkedHashMap<>();
    private final Map<String, Edge> edges = new LinkedHashMap<>();

    public Node addNode(String id, String label, NodeType type) {
        return nodes.computeIfAbsent(id, k -> new Node(id, label, type));
    }

    /**
     * (from,to,type,idn) 로 dedup 하고 소스와 관측 횟수를 누적한다 (F-07).
     * idn 을 키에 포함하는 이유: 서로 다른 신원의 접근을 하나로 합치면
     * 사람(user-a)과 스캐너(user-c)의 서로 다른 접근이 '겹침'으로 잘못 표시된다.
     * 명세의 CoverageCell 키가 identity|operation|resource 이므로 그 단위를 지킨다.
     */
    public Edge addEdge(String from, String to, EdgeType type, Source source, String idn) {
        String id = type + ":" + idn + ":" + from + "->" + to;
        Edge e = edges.computeIfAbsent(id, k -> new Edge(id, from, to, type, idn));
        e.sources.add(source);
        e.count++;
        return e;
    }

    public Edge addEdge(String from, String to, EdgeType type, RequestRecord record) {
        Edge edge = addEdge(from, to, type, record.source, record.idn);
        edge.sourceDetails.add(record.sourceDetail);
        edge.orchestrators.add(record.orchestrator);
        edge.tools.add(record.tool);
        edge.phases.add(record.phase);
        if (record.runId != null) edge.runIds.add(record.runId);
        if (record.evidenceId != null) edge.evidenceIds.add(record.evidenceId);
        return edge;
    }

    public void markVerdict(String nodeId, Verdict verdict) {
        Node node = nodes.get(nodeId);
        if (node != null && priority(verdict) > priority(node.verdict)) node.verdict = verdict;
    }

    private static int priority(Verdict verdict) {
        return switch (verdict) {
            case SUSPICIOUS -> 5;
            case UNDECIDED -> 4;
            case DENY -> 3;
            case ALLOW -> 2;
            case UNTESTED -> 1;
        };
    }

    public List<Node> nodes() { return new ArrayList<>(nodes.values()); }
    public List<Edge> edges() { return new ArrayList<>(edges.values()); }
    public Node node(String id) { return nodes.get(id); }
    public int nodeCount() { return nodes.size(); }
    public int edgeCount() { return edges.size(); }

    public long nodeCount(NodeType t) {
        return nodes.values().stream().filter(n -> n.type == t).count();
    }
}
