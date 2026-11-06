package com.labscape.api.core.dev;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Starts a real Postgres 17 before any bean is created when the "dev" or "test" profile is active,
 * and points the datasource and Flyway at it. Production (Neon) never takes this path.
 *
 * <p>dev: data persists in {@code labscape.dev-db.dir} on a fixed port. test: a wiped temp directory
 * on a free port, shared by every Spring context in the JVM.
 */
public class EmbeddedPostgresBootstrap implements EnvironmentPostProcessor {

    private static EmbeddedPostgres instance;

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment env, SpringApplication app) {
        boolean dev = Arrays.asList(env.getActiveProfiles()).contains("dev");
        boolean test = Arrays.asList(env.getActiveProfiles()).contains("test");
        if (!dev && !test) return;

        EmbeddedPostgres pg = start(dev ? env.getProperty("labscape.dev-db.dir", ".data/pg") : null,
                dev ? env.getProperty("labscape.dev-db.port", Integer.class, 54329) : 0);

        String url = "jdbc:postgresql://localhost:" + pg.getPort() + "/postgres";
        Map<String, Object> props = new HashMap<>();
        props.put("spring.datasource.url", url);
        props.put("spring.datasource.username", "postgres");
        props.put("spring.datasource.password", "");
        props.put("spring.flyway.url", url);
        props.put("spring.flyway.user", "postgres");
        props.put("spring.flyway.password", "");
        env.getPropertySources().addFirst(new MapPropertySource("embeddedPostgres", props));
    }

    private static synchronized EmbeddedPostgres start(String dir, int port) {
        if (instance != null) return instance;
        try {
            EmbeddedPostgres.Builder b = EmbeddedPostgres.builder().setPort(port);
            if (dir != null && !dir.isBlank()) {
                Path p = Path.of(dir).toAbsolutePath();
                Files.createDirectories(p);
                b.setDataDirectory(p).setCleanDataDirectory(false);
            }
            instance = b.start();
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                try {
                    instance.close();
                } catch (IOException ignored) {
                    // shutting down anyway
                }
            }, "embedded-postgres-stop"));
            return instance;
        } catch (IOException e) {
            throw new UncheckedIOException("Could not start embedded Postgres", e);
        }
    }
}
