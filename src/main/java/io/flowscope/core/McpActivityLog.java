package io.flowscope.core;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * LLM(Codex)이 MCP 도구를 호출할 때마다 남기는 활동 로그. LLM 판정 화면의 "작업 피드"가 이걸 읽어 보여 준다.
 * 메모리 전용 링 버퍼이며 실행 시작 때 비운다. 비밀값은 담지 않는다(요약 문자열만).
 */
public final class McpActivityLog {
    public record Entry(long seq, long timestamp, String type, String summary, boolean risk) {}

    private static final int MAX = 500;
    private final Deque<Entry> entries = new ArrayDeque<>();
    private long nextSeq = 1;

    /** 새 실행을 시작하며 피드를 비운다. */
    public synchronized void reset() {
        entries.clear();
    }

    /** type: read·resend·finding·info. risk=true면 LLM이 취약점으로 추천한 항목(위험 필터 대상). */
    public synchronized long record(String type, String summary, boolean risk) {
        long seq = nextSeq++;
        entries.addLast(new Entry(seq, System.currentTimeMillis(),
                type == null ? "info" : type, summary == null ? "" : summary, risk));
        while (entries.size() > MAX) entries.removeFirst();
        return seq;
    }

    /** afterSeq 이후의 항목만 돌려준다(증분 폴링용). afterSeq<=0이면 전체. */
    public synchronized List<Entry> entriesAfter(long afterSeq) {
        List<Entry> result = new ArrayList<>();
        for (Entry entry : entries) if (entry.seq() > afterSeq) result.add(entry);
        return result;
    }
}
