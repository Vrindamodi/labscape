package com.labscape.api.intelligence.chem;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
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
 *
 * <p>{@code catalogue/substances.json} is the root file; its {@code include} list names further
 * shelves (acids and bases, salts, solids, organic, reagents, household...) loaded after it, then
 * the 118 elements. Ids must be unique across every file.
 */
@Component
public class Catalogue {

    private static final String ROOT = "/catalogue/";
    private static final String RESOURCE = ROOT + "substances.json";

    private final String version;
    private final Map<String, Substance> byId;
    private final Set<String> gaps;
    private final Map<String, Substance> solidByFormula;

    public Catalogue(ObjectMapper mapper) {
        File file = read(mapper, RESOURCE);
        Map<String, Substance> map = new LinkedHashMap<>();
        List<Substance> all = new ArrayList<>(file.substances());
        List<List<String>> gapList = new ArrayList<>(file.gaps() == null ? List.of() : file.gaps());
        for (String include : file.include() == null ? List.<String>of() : file.include()) {
            File part = read(mapper, ROOT + include);
            all.addAll(part.substances());
            if (part.gaps() != null) gapList.addAll(part.gaps());
        }
        all.addAll(Elements.load(mapper));
        for (Substance s : all) {
            if (map.put(s.id(), s) != null) {
                throw new IllegalStateException("Duplicate catalogue id: " + s.id());
            }
        }
        Set<String> gapKeys = new HashSet<>();
        for (List<String> pair : gapList) {
            if (pair.size() != 2 || !map.containsKey(pair.get(0)) || !map.containsKey(pair.get(1))) {
                throw new IllegalStateException("Bad gap entry: " + pair);
            }
            gapKeys.add(pairKey(pair.get(0), pair.get(1)));
        }
        // "CaCO3" -> the shelf solid that is exactly that compound; a powder is preferred over chips or ribbon.
        Map<String, Substance> solids = new LinkedHashMap<>();
        for (Substance s : map.values()) {
            if (!s.isSolid() || s.species() == null || s.species().size() != 1 || s.molarMass() == null) continue;
            Map.Entry<String, Double> only = s.species().entrySet().iterator().next();
            if (!only.getKey().endsWith("(s)") || Math.abs(only.getValue() - 1) > 1e-9) continue;
            String formula = only.getKey().substring(0, only.getKey().length() - 3);
            Substance had = solids.get(formula);
            if (had == null || !"powder".equals(had.solidForm()) && "powder".equals(s.solidForm()) && !s.isElement()) solids.put(formula, s);
        }
        this.solidByFormula = Collections.unmodifiableMap(solids);
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

    /** The shelf solid that is exactly this compound ("CaCO3", "MgO", "Cu"), if the shelf has one. */
    public Optional<Substance> solidFor(String formula) {
        return Optional.ofNullable(solidByFormula.get(formula));
    }

    public Collection<Substance> all() {
        return byId.values();
    }

    public String version() {
        return version;
    }

    /** A known real reaction that the engine does not model. The list is empty: every pair is modelled. */
    public boolean isGap(String a, String b) {
        return gaps.contains(pairKey(a, b));
    }

    private static String pairKey(String a, String b) {
        return a.compareTo(b) <= 0 ? a + "|" + b : b + "|" + a;
    }

    private static File read(ObjectMapper mapper, String resource) {
        try (InputStream in = Catalogue.class.getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalStateException("Missing " + resource);
            }
            return mapper.readValue(in, File.class);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
    record File(String version, List<String> include, List<Substance> substances, List<List<String>> gaps) {}
}
