package io.flowscope.core;

/** Selected collection session attribution; does not assert that server-side login succeeded. */
public enum AuthState {
    ANONYMOUS,
    ACCOUNT_BOUND
}
