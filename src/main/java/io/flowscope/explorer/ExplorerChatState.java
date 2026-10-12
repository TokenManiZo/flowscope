package io.flowscope.explorer;

import java.util.List;
import java.time.Instant;

/** Visible chat history and the local Codex thread handle; never stores gateway or login credentials. */
public record ExplorerChatState(String threadId, String target, List<Message> messages,
                                String model, String effort, boolean rawCodex, int rawProtocolVersion) {
    public record Message(String role, String text, String runId, String at) {
        public Message {
            if (!"user".equals(role) && !"assistant".equals(role)) {
                throw new IllegalArgumentException("invalid chat message role");
            }
            if (text == null || runId == null || at == null) {
                throw new IllegalArgumentException("incomplete chat message");
            }
            Instant.parse(at);
        }
    }

    public ExplorerChatState {
        threadId = threadId == null ? "" : threadId;
        target = target == null ? "" : target;
        messages = List.copyOf(messages == null ? List.of() : messages);
        model = model == null ? "" : model;
        effort = effort == null ? "" : effort;
        if (rawProtocolVersion < 0) throw new IllegalArgumentException("invalid raw protocol version");
    }

    public ExplorerChatState(String threadId, String target, List<Message> messages) {
        this(threadId, target, messages, "", "", false, 0);
    }

    public ExplorerChatState(String threadId, String target, List<Message> messages, String model, String effort) {
        this(threadId, target, messages, model, effort, false, 0);
    }

    public ExplorerChatState(String threadId, String target, List<Message> messages,
                             String model, String effort, boolean rawCodex) {
        this(threadId, target, messages, model, effort, rawCodex, 0);
    }

    public static ExplorerChatState empty() { return new ExplorerChatState("", "", List.of(), "", "", false, 0); }
}
