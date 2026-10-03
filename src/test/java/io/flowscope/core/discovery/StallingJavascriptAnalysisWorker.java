package io.flowscope.core.discovery;

import java.util.concurrent.CountDownLatch;

/** Test process that never acknowledges a parser request. */
public final class StallingJavascriptAnalysisWorker {
    public static void main(String[] args) throws InterruptedException {
        new CountDownLatch(1).await();
    }
}
