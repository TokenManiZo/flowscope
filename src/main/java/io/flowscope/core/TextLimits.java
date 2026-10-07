package io.flowscope.core;

/** 저장·표시하는 텍스트의 길이 상한. */
public final class TextLimits {
    private TextLimits() {}

    /** 필요 이상으로 큰 본문은 잘라 메모리 폭증을 막는다. */
    public static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max) + "…(truncated)";
    }
}
