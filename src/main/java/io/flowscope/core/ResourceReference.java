package io.flowscope.core;

/** 소유권·인가를 단정하지 않고 한 요청에서 추출한 명시적 객체 참조. */
public record ResourceReference(String resource, String evidence) {}
