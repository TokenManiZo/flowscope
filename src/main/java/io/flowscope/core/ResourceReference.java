package io.flowscope.core;

/** Explicit object reference extracted from one request without asserting ownership or authorization. */
public record ResourceReference(String resource, String evidence) {}
