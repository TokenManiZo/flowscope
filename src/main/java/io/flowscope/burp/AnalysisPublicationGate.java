package io.flowscope.burp;

/** 오래된 입력 상태에서 계산한 분석 결과가 최신 snapshot을 덮지 못하게 한다. */
final class AnalysisPublicationGate {
    private long epoch;

    synchronized long invalidate() {
        return ++epoch;
    }

    synchronized long current() {
        return epoch;
    }

    synchronized boolean publishIfCurrent(long expectedEpoch, Runnable publisher) {
        if (epoch != expectedEpoch) return false;
        publisher.run();
        return true;
    }
}
