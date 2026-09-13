package io.flowscope.integration;

import io.flowscope.core.ScopePolicy;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Stream;

/**
 * Owns FlowScope's local project directory contract. Each diagnosis gets one directory so future
 * reports and non-secret artifacts can be kept beside the SQLite evidence database.
 */
public final class ProjectWorkspace {
    public static final String DATABASE_NAME = "project.flowscope.db";
    private static final int MAX_LISTED_PROJECTS = 500;
    private static final DateTimeFormatter TIMESTAMP =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);
    private static final Set<String> WINDOWS_RESERVED = Set.of(
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
            "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
            "LPT7", "LPT8", "LPT9");

    public record Allocation(String id, Path directory, Path database,
                             ProjectStore.ProjectContext context) {}

    public record Entry(String id, String name, List<String> scope, String createdAt,
                        long modifiedAtMillis, long sizeBytes, boolean active, boolean readable,
                        boolean managed) {
        public Entry {
            scope = List.copyOf(scope == null ? List.of() : scope);
        }
    }

    public record Status(String directory, Entry active, List<Entry> projects,
                         String saveState, String lastSavedAt, String saveError) {
        public Status(String directory, Entry active, List<Entry> projects) {
            this(directory, active, projects, active == null ? "UNMANAGED" : "SAVED", "", "");
        }

        public Status {
            projects = List.copyOf(projects == null ? List.of() : projects);
            saveState = saveState == null || saveState.isBlank() ? "UNMANAGED" : saveState;
            lastSavedAt = lastSavedAt == null ? "" : lastSavedAt;
            saveError = saveError == null ? "" : saveError;
        }

        public Status withPersistence(String state, String savedAt, String error) {
            return new Status(directory, active, projects, state, savedAt, error);
        }
    }

    private final Path root;
    private final Clock clock;

    public ProjectWorkspace(Path root) {
        this(root, Clock.systemUTC());
    }

    ProjectWorkspace(Path root, Clock clock) {
        if (root == null) throw new IllegalArgumentException("project workspace is required");
        this.root = root.toAbsolutePath().normalize();
        this.clock = clock;
    }

    public static ProjectWorkspace defaultWorkspace() {
        String configured = System.getProperty("flowscope.projects.dir", "").trim();
        Path root = configured.isBlank()
                ? Path.of(System.getProperty("user.home"), ".flowscope", "projects")
                : Path.of(configured);
        return new ProjectWorkspace(root);
    }

    public Path root() {
        return root;
    }

    public Allocation allocate(String requestedName, String rawScope) throws IOException {
        ScopePolicy parsed = ScopePolicy.parse(rawScope);
        if (parsed.isEmpty()) throw new IllegalArgumentException("새 진단에는 exact scope가 한 개 이상 필요합니다.");
        Instant now = clock.instant();
        String displayName = requestedName == null ? "" : requestedName.trim();
        if (displayName.length() > 120) throw new IllegalArgumentException("프로젝트 이름은 120자 이하여야 합니다.");
        String scopeName = defaultName(parsed.entries().getFirst());
        if (displayName.isBlank()) displayName = scopeName;
        String labelSlug = slug(displayName);
        String scopeSlug = slug(scopeName);
        String directorySlug = labelSlug.equals(scopeSlug) ? labelSlug : labelSlug + "--" + scopeSlug;
        String base = directorySlug + "-" + TIMESTAMP.format(now);
        Files.createDirectories(root);
        restrictDirectory(root);
        Path directory = root.resolve(base);
        int suffix = 2;
        while (Files.exists(directory)) directory = root.resolve(base + "-" + suffix++);
        Files.createDirectory(directory);
        restrictDirectory(directory);
        ProjectStore.ProjectContext context = new ProjectStore.ProjectContext(
                displayName, parsed.entries(), now);
        return new Allocation(directory.getFileName().toString(), directory,
                directory.resolve(DATABASE_NAME), context);
    }

    public Path resolveDatabase(String id) {
        if (id == null || id.isBlank()) throw new IllegalArgumentException("프로젝트 ID가 필요합니다.");
        Path relative = Path.of(id);
        if (relative.isAbsolute() || relative.getNameCount() != 1 || id.equals(".") || id.equals("..")) {
            throw new IllegalArgumentException("잘못된 프로젝트 ID입니다.");
        }
        Path directory = root.resolve(relative).normalize();
        if (!directory.getParent().equals(root)) throw new IllegalArgumentException("잘못된 프로젝트 ID입니다.");
        Path database = directory.resolve(DATABASE_NAME);
        if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)
                || !Files.isRegularFile(database, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("프로젝트를 찾을 수 없습니다.");
        }
        return database;
    }

    public Status status(Path activeDatabase, ProjectStore.ProjectContext activeContext,
                         SqliteProjectStore store) {
        Path active = activeDatabase == null ? null : activeDatabase.toAbsolutePath().normalize();
        List<Entry> entries = new ArrayList<>();
        if (Files.isDirectory(root)) {
            try (Stream<Path> children = Files.list(root)) {
                children.filter(path -> Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS))
                        .map(directory -> directory.resolve(DATABASE_NAME))
                        .filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
                        .sorted(Comparator.comparingLong(ProjectWorkspace::modifiedAt).reversed())
                        .limit(MAX_LISTED_PROJECTS)
                        .forEach(database -> entries.add(entry(database, active, store, true)));
            } catch (IOException ignored) {
                // The active entry below remains available even if directory enumeration is denied.
            }
        }
        Entry activeEntry = active == null ? null : entries.stream()
                .filter(entry -> entry.active()).findFirst().orElseGet(() -> entry(
                        active, active, store, activeContext == null
                                ? ProjectStore.ProjectContext.empty() : activeContext, false));
        if (activeEntry != null && entries.stream().noneMatch(Entry::active)) {
            entries.addFirst(activeEntry);
        }
        return new Status(root.toString(), activeEntry, entries);
    }

    public void removeEmptyAllocation(Allocation allocation) {
        if (allocation == null) return;
        try {
            Files.deleteIfExists(allocation.database());
            Files.deleteIfExists(allocation.directory());
        } catch (IOException ignored) {
            // A failed cleanup only leaves an empty private directory; it never touches prior evidence.
        }
    }

    private static Entry entry(Path database, Path active, SqliteProjectStore store, boolean managed) {
        ProjectStore.ProjectContext context;
        boolean readable = true;
        try { context = store.readContext(database); }
        catch (Exception error) {
            context = ProjectStore.ProjectContext.empty();
            readable = false;
        }
        return entry(database, active, store, context, readable, managed);
    }

    private static Entry entry(Path database, Path active, SqliteProjectStore store,
                               ProjectStore.ProjectContext context, boolean managed) {
        return entry(database, active, store, context, true, managed);
    }

    private static Entry entry(Path database, Path active, SqliteProjectStore ignored,
                               ProjectStore.ProjectContext context, boolean readable, boolean managed) {
        Path directory = database.getParent();
        String id = managed && directory != null ? directory.getFileName().toString() : "external-active";
        String name = context.name().isBlank() ? id : context.name();
        long size = 0;
        try { size = Files.size(database); } catch (IOException ignoredSize) { readable = false; }
        boolean selected = active != null && database.toAbsolutePath().normalize().equals(active);
        return new Entry(id, name, context.scope(),
                context.present() ? context.createdAt().toString() : "",
                modifiedAt(database), size, selected, readable, managed);
    }

    private static long modifiedAt(Path path) {
        try { return Files.getLastModifiedTime(path).toMillis(); }
        catch (IOException ignored) { return 0; }
    }

    private static String defaultName(String scope) {
        try {
            URI uri = URI.create(scope);
            String host = uri.getHost();
            if (host != null && !host.isBlank()) {
                int port = uri.getPort();
                return port < 0 ? host : host + "-" + port;
            }
        } catch (RuntimeException ignored) { }
        return "diagnosis";
    }

    static String slug(String value) {
        StringBuilder out = new StringBuilder();
        boolean separator = false;
        for (int offset = 0; offset < value.length() && out.length() < 80; ) {
            int codePoint = value.codePointAt(offset);
            offset += Character.charCount(codePoint);
            if (Character.isLetterOrDigit(codePoint)) {
                if (separator && !out.isEmpty()) out.append('-');
                out.appendCodePoint(Character.toLowerCase(codePoint));
                separator = false;
            } else if (codePoint == '-' || codePoint == '_' || codePoint == '.') {
                if (!out.isEmpty()) separator = true;
            } else if (Character.isWhitespace(codePoint)) {
                if (!out.isEmpty()) separator = true;
            }
        }
        String result = out.toString().replaceAll("[. ]+$", "");
        if (result.isBlank()) result = "diagnosis";
        if (WINDOWS_RESERVED.contains(result.toUpperCase(Locale.ROOT))) result = "project-" + result;
        return result;
    }

    private static void restrictDirectory(Path path) {
        try {
            Files.setPosixFilePermissions(path, Set.of(PosixFilePermission.OWNER_READ,
                    PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_EXECUTE));
        } catch (UnsupportedOperationException | IOException ignored) { }
    }
}
