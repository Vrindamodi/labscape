package com.labscape.api.intelligence.chem;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * The curated substance allowlist. There is no free-text chemical entry anywhere in LABscape:
 * every request references an id from here.
 */
@Component
public class Catalogue {

    private static final String RESOURCE = "/catalogue/substances.json";

    private final String version;
    private final Map<String, Substance> byId;
    private final Set<String> gaps;

    public Catalogue(ObjectMapper mapper) {
        File file = read(mapper);
        Map<String, Substance> map = new LinkedHashMap<>();
        for (Substance s : file.substances()) {
            if (map.put(s.id(), s) != null) {
                throw new IllegalStateException("Duplicate catalogue id: " + s.id());
            }
        }
        Set<String> gapKeys = new HashSet<>();
        for (List<String> pair : file.gaps()) {
            if (pair.size() != 2 || !map.containsKey(pair.get(0)) || !map.containsKey(pair.get(1))) {
                throw new IllegalStateException("Bad gap entry: " + pair);
            }
            gapKeys.add(pairKey(pair.get(0), pair.get(1)));
        }
        this.version = file.version();
        this.byId = Collections.unmodifiableMap(map);
        this.gaps = Collections.unmodifiableSet(gapKeys);
    }

    public static Catalogue load() {
        return new Catalogue(new ObjectMapper());
    }

    public Optional<Substance> find(String id) {
        return Optional.ofNullable(byId.get(id));
    }

    public Collection<Substance> all() {
        return byId.values();
    }

    public String version() {
        return version;
    }

    /** A known real reaction that the engine does not model: answered as unsupported. */
    public boolean isGap(String a, String b) {
        return gaps.contains(pairKey(a, b));
    }

    private static String pairKey(String a, String b) {
        return a.compareTo(b) <= 0 ? a + "|" + b : b + "|" + a;
    }

    private static File read(ObjectMapper mapper) {
        try (InputStream in = Catalogue.class.getResourceAsStream(RESOURCE)) {
            if (in == null) {
                throw new IllegalStateException("Missing " + RESOURCE);
            }
            return mapper.readValue(in, File.class);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
    record File(String version, List<Substance> substances, List<List<String>> gaps) {}
}
