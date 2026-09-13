package io.flowscope.core.discovery;

import java.util.List;

/** 문서 형식별 추출기. 네트워크·scope·후보 저장을 직접 수행하지 않는다. */
public interface RouteDiscoveryAdapter {
    String id();
    boolean supports(RouteDiscoveryDocument document);
    List<DiscoveredRoute> discover(RouteDiscoveryDocument document);
}
