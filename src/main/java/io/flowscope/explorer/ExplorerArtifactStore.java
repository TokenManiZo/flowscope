package io.flowscope.explorer;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Run-scoped masked response artifacts. Files never become project or snapshot state. */
final class ExplorerArtifactStore implements AutoCloseable {
    record Provenance(String evidenceId, String url, String contentType) {}
    record Metadata(String id, String evidenceId, String url, String contentType, String sha256,
                    long bytes, boolean complete, Instant createdAt, List<Provenance> provenance) {}
    record Match(String artifactId, long charOffset, String snippet) {}
    record Read(String artifactId, long charOffset, String text, boolean endOfArtifact) {}

    private static final int SEARCH_BUFFER_CHARS = 64 * 1024;
    private static final int SEARCH_CONTEXT_CHARS = 160;
    private static final int MAX_QUERY_CHARS = 1_024;
    private static final int MAX_READ_CHARS = 64 * 1024;
    private static final int MAX_RESULTS = 200;
    private static final long DEFAULT_TOTAL_BYTES = 512L * 1024 * 1024;

    private final Path directory;
    private final long maxTotalBytes;
    private final Map<String, Entry> entries = new LinkedHashMap<>();
    private final Map<String, String> idsByDigest = new LinkedHashMap<>();
    private long totalBytes;

    ExplorerArtifactStore(String runId) throws IOException {
        this(runId, Long.getLong("flowscope.explorer.artifactBytes", DEFAULT_TOTAL_BYTES));
    }

    ExplorerArtifactStore(String runId, long maxTotalBytes) throws IOException {
        if (maxTotalBytes < 1) throw new IllegalArgumentException("artifact byte budget must be positive");
        String safeRun = runId == null ? "run" : runId.replaceAll("[^A-Za-z0-9._-]", "_");
        directory = Files.createTempDirectory("flowscope-explorer-" + safeRun + "-");
        setOwnerOnly(directory, true);
        this.maxTotalBytes = maxTotalBytes;
    }

    synchronized Metadata store(String evidenceId, String url, String contentType,
                                String maskedText, boolean complete) throws IOException {
        byte[] bytes = (maskedText == null ? "" : maskedText).getBytes(StandardCharsets.UTF_8);
        String digest = sha256(bytes);
        String existingId = idsByDigest.get(digest);
        if (existingId != null) {
            Entry existing = entries.get(existingId);
            existing.addProvenance(evidenceId, url, contentType);
            return existing.metadata(evidenceId);
        }
        if (bytes.length > maxTotalBytes - totalBytes) {
            throw new CapacityExceededException(maxTotalBytes, totalBytes, bytes.length);
        }
        String id = UUID.randomUUID().toString();
        Path path = directory.resolve(id + ".txt");
        Files.write(path, bytes);
        setOwnerOnly(path, false);
        Entry entry = new Entry(id, path, evidenceId, url, contentType, digest, bytes.length,
                complete, Instant.now());
        entries.put(id, entry);
        idsByDigest.put(digest, id);
        totalBytes += bytes.length;
        return entry.metadata(evidenceId);
    }

    synchronized List<Metadata> list() {
        return entries.values().stream().map(value -> value.metadata(value.primaryEvidenceId())).toList();
    }

    synchronized Metadata metadata(String id) {
        Entry entry = required(id);
        return entry.metadata(entry.primaryEvidenceId());
    }

    synchronized Read read(String id, long charOffset, int maxChars) throws IOException {
        if (charOffset < 0) throw new IllegalArgumentException("char_offset must not be negative");
        int bounded = Math.max(1, Math.min(maxChars, MAX_READ_CHARS));
        Entry entry = required(id);
        try (Reader reader = Files.newBufferedReader(entry.path, StandardCharsets.UTF_8)) {
            long skipped = skipFully(reader, charOffset);
            if (skipped < charOffset) return new Read(id, skipped, "", true);
            char[] buffer = new char[bounded];
            int read = readUpTo(reader, buffer);
            boolean end = reader.read() < 0;
            return new Read(id, charOffset, new String(buffer, 0, read), end);
        }
    }

    synchronized List<Match> search(String requestedId, String query, boolean caseSensitive,
                                    int requestedResults) throws IOException {
        if (query == null || query.isEmpty() || query.length() > MAX_QUERY_CHARS
                || query.chars().anyMatch(value -> value == '\r' || value == '\n')) {
            throw new IllegalArgumentException("query must be 1~" + MAX_QUERY_CHARS + " characters on one line");
        }
        int maxResults = Math.max(1, Math.min(requestedResults, MAX_RESULTS));
        List<Entry> selected = requestedId == null || requestedId.isBlank()
                ? List.copyOf(entries.values()) : List.of(required(requestedId));
        List<Match> matches = new ArrayList<>();
        for (Entry entry : selected) {
            search(entry, query, caseSensitive, maxResults, matches);
            if (matches.size() >= maxResults) break;
        }
        return List.copyOf(matches);
    }

    synchronized String readAll(String id, long maxBytes) throws IOException {
        Entry entry = required(id);
        if (entry.bytes > maxBytes) throw new CapacityExceededException(maxBytes, 0, entry.bytes);
        return Files.readString(entry.path, StandardCharsets.UTF_8);
    }

    private static void search(Entry entry, String query, boolean caseSensitive, int maxResults,
                               List<Match> matches) throws IOException {
        int overlap = Math.max(query.length() - 1, SEARCH_CONTEXT_CHARS);
        char[] buffer = new char[SEARCH_BUFFER_CHARS];
        String carry = "";
        long consumed = 0;
        try (BufferedReader reader = Files.newBufferedReader(entry.path, StandardCharsets.UTF_8)) {
            for (int count; (count = reader.read(buffer)) >= 0;) {
                if (count == 0) continue;
                String chunk = carry + new String(buffer, 0, count);
                long chunkBase = consumed - carry.length();
                long newDataStart = consumed;
                int from = 0;
                while (matches.size() < maxResults) {
                    int found = indexOf(chunk, query, from, caseSensitive);
                    if (found < 0) break;
                    long absolute = chunkBase + found;
                    if (absolute + query.length() > newDataStart || consumed == 0) {
                        int before = Math.max(0, found - SEARCH_CONTEXT_CHARS);
                        int after = Math.min(chunk.length(), found + query.length() + SEARCH_CONTEXT_CHARS);
                        matches.add(new Match(entry.id, absolute,
                                chunk.substring(before, after).replace('\r', ' ').replace('\n', ' ')));
                    }
                    from = found + Math.max(1, query.length());
                }
                consumed += count;
                carry = chunk.substring(Math.max(0, chunk.length() - overlap));
                if (matches.size() >= maxResults) return;
            }
        }
    }

    private static int indexOf(String text, String query, int from, boolean caseSensitive) {
        if (caseSensitive) return text.indexOf(query, from);
        int last = text.length() - query.length();
        for (int index = Math.max(0, from); index <= last; index++) {
            if (text.regionMatches(true, index, query, 0, query.length())) return index;
        }
        return -1;
    }

    private synchronized Entry required(String id) {
        Entry entry = entries.get(id == null ? "" : id.trim());
        if (entry == null) throw new IllegalArgumentException("artifact not found in the active run");
        return entry;
    }

    private static long skipFully(Reader reader, long count) throws IOException {
        long skipped = 0;
        while (skipped < count) {
            long value = reader.skip(count - skipped);
            if (value > 0) skipped += value;
            else if (reader.read() < 0) break;
            else skipped++;
        }
        return skipped;
    }

    private static int readUpTo(Reader reader, char[] buffer) throws IOException {
        int total = 0;
        while (total < buffer.length) {
            int value = reader.read(buffer, total, buffer.length - total);
            if (value < 0) break;
            if (value > 0) total += value;
        }
        return total;
    }

    private static void setOwnerOnly(Path path, boolean directory) {
        try {
            Set<PosixFilePermission> permissions = directory
                    ? EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE,
                    PosixFilePermission.OWNER_EXECUTE)
                    : EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);
            Files.setPosixFilePermissions(path, permissions);
        } catch (UnsupportedOperationException | IOException ignored) {
            // Windows ACL inheritance is used when POSIX permissions are unavailable.
        }
    }

    private static String sha256(byte[] value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static String nullToEmpty(String value) { return value == null ? "" : value; }

    @Override public synchronized void close() {
        for (Entry entry : entries.values()) {
            try { Files.deleteIfExists(entry.path); } catch (IOException ignored) {}
        }
        entries.clear();
        idsByDigest.clear();
        totalBytes = 0;
        try { Files.deleteIfExists(directory); } catch (IOException ignored) {}
    }

    static final class CapacityExceededException extends IOException {
        CapacityExceededException(long limit, long current, long requested) {
            super("artifact budget exceeded: limit=" + limit + ", current=" + current + ", requested=" + requested);
        }
    }

    private static final class Entry {
        private final String id;
        private final Path path;
        private final Map<String, Provenance> provenance = new LinkedHashMap<>();
        private final String sha256;
        private final long bytes;
        private final boolean complete;
        private final Instant createdAt;

        private Entry(String id, Path path, String evidenceId, String url, String contentType,
                      String sha256, long bytes, boolean complete, Instant createdAt) {
            this.id = id;
            this.path = path;
            addProvenance(evidenceId, url, contentType);
            this.sha256 = sha256;
            this.bytes = bytes;
            this.complete = complete;
            this.createdAt = createdAt;
        }

        private void addProvenance(String evidenceId, String url, String contentType) {
            Provenance item = new Provenance(nullToEmpty(evidenceId), nullToEmpty(url),
                    nullToEmpty(contentType));
            provenance.putIfAbsent(item.evidenceId() + "\u0000" + item.url() + "\u0000" + item.contentType(), item);
        }

        private Provenance primaryProvenance() { return provenance.values().iterator().next(); }
        private String primaryEvidenceId() { return primaryProvenance().evidenceId(); }

        private Metadata metadata(String preferredEvidenceId) {
            String evidenceId = preferredEvidenceId == null || preferredEvidenceId.isBlank()
                    ? primaryEvidenceId() : preferredEvidenceId;
            Provenance preferred = provenance.values().stream()
                    .filter(item -> item.evidenceId().equals(evidenceId)).findFirst().orElse(primaryProvenance());
            return new Metadata(id, evidenceId, preferred.url(), preferred.contentType(), sha256, bytes,
                    complete, createdAt, List.copyOf(provenance.values()));
        }
    }
}
