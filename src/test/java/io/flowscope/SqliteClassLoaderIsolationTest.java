package io.flowscope;

import org.junit.jupiter.api.Test;

import java.net.URL;
import java.net.URLClassLoader;
import java.sql.Connection;
import java.sql.Driver;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertNotNull;

final class SqliteClassLoaderIsolationTest {
    @Test
    void sqliteNativeLibraryLoadsInTwoIndependentExtensionClassLoaders() throws Exception {
        URL sqliteJar = Class.forName("org.sqlite.JDBC")
                .getProtectionDomain()
                .getCodeSource()
                .getLocation();

        try (URLClassLoader firstLoader = isolatedLoader(sqliteJar);
             URLClassLoader secondLoader = isolatedLoader(sqliteJar)) {
            Driver firstDriver = driver(firstLoader);
            Driver secondDriver = driver(secondLoader);

            try (Connection first = firstDriver.connect("jdbc:sqlite::memory:", new Properties());
                 Connection second = secondDriver.connect("jdbc:sqlite::memory:", new Properties())) {
                assertNotNull(first);
                assertNotNull(second);
                first.createStatement().execute("SELECT 1");
                second.createStatement().execute("SELECT 1");
            }
        }
    }

    private static URLClassLoader isolatedLoader(URL sqliteJar) {
        return new URLClassLoader(new URL[]{sqliteJar}, ClassLoader.getPlatformClassLoader());
    }

    private static Driver driver(ClassLoader loader) throws Exception {
        Class<?> type = Class.forName("org.sqlite.JDBC", true, loader);
        return (Driver) type.getDeclaredConstructor().newInstance();
    }
}
