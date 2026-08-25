package io.flowscope.core;

/** 사용자가 명시하는 권한 레벨. 자동으로 Admin 등을 추정하지 않는다. */
public enum AccessRole {
    ANONYMOUS(0, "Anonymous"),
    USER(1, "User"),
    LV1(2, "LV1"),
    LV2(3, "LV2"),
    ADMIN(4, "Admin"),
    UNKNOWN(-1, "Unknown");

    private final int rank;
    private final String label;

    AccessRole(int rank, String label) {
        this.rank = rank;
        this.label = label;
    }

    public int rank() { return rank; }
    public String label() { return label; }

    public boolean isBelow(AccessRole required) {
        return this != UNKNOWN && required != null && required != UNKNOWN && rank < required.rank;
    }
}
