package com.labscape.api.core.reference;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labscape.api.core.library.LibraryCatalogue;
import com.labscape.api.core.library.LibraryCatalogue.Experiment;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Reference content for the periodic table and the equipment encyclopedia (build plan 2.14).
 * Element identity comes from the playground's catalogue (catalogue/elements.json) so both features
 * agree; physical properties come from content/elements/properties.json. Both are cross-linked to
 * the experiments that use them.
 */
@Component
public class ReferenceData {

    public record ExperimentLink(String slug, String title, String subject, boolean playable) {}

    public record Element(
            int z, String symbol, String name, double mass, String category, String state, String colour,
            Double electronegativity, List<Integer> oxidationStates, boolean radioactive, boolean synthetic,
            String fact, int period, Integer group, String block, int row, int col,
            Integer radiusPm, Double ionisationKjMol, Double electronAffinityKjMol, Double meltingK,
            Double boilingK, Double density, Integer discovered, List<ExperimentLink> experiments) {}

    private final List<Element> elements;
    private final Map<String, Element> bySymbol;
    private final List<JsonNode> equipment;
    private final JsonNode equipmentCategories;
    private final List<JsonNode> formulas;

    public ReferenceData(ObjectMapper mapper, LibraryCatalogue catalogue) {
        JsonNode ids = read(mapper, "catalogue/elements.json").get("elements");
        JsonNode props = read(mapper, "content/elements/properties.json").get("rows");
        if (ids.size() != 118 || props.size() != 118) throw new IllegalStateException("Element data must cover all 118 elements");

        List<Element> list = new ArrayList<>(118);
        for (int i = 0; i < 118; i++) {
            int z = i + 1;
            JsonNode r = ids.get(i);
            JsonNode p = props.get(i);
            String symbol = r.get(0).asText();
            String flags = r.get(8).asText("");
            List<Integer> ox = new ArrayList<>();
            r.get(7).forEach(n -> ox.add(n.asInt()));
            int[] pos = position(z);
            List<ExperimentLink> links = catalogue.all().stream()
                    .filter(e -> e.elements().contains(symbol))
                    .map(ReferenceData::link)
                    .toList();
            list.add(new Element(z, symbol, r.get(1).asText(), r.get(2).asDouble(), r.get(3).asText(),
                    state(r.get(4).asText()), r.get(5).asText(), dbl(r.get(6)), List.copyOf(ox),
                    flags.contains("R"), flags.contains("S") || z > 94, r.get(9).asText(),
                    pos[0], pos[1] == 0 ? null : pos[1], block(z, pos[1]), pos[2], pos[3],
                    p.get(0).isNull() ? null : p.get(0).asInt(), dbl(p.get(1)), dbl(p.get(2)), dbl(p.get(3)),
                    dbl(p.get(4)), dbl(p.get(5)), p.get(6).isNull() ? null : p.get(6).asInt(), links));
        }
        this.elements = List.copyOf(list);
        this.bySymbol = elements.stream().collect(Collectors.toUnmodifiableMap(
                e -> e.symbol().toLowerCase(Locale.ROOT), Function.identity()));

        JsonNode eq = read(mapper, "content/equipment/equipment.json");
        this.equipmentCategories = eq.get("categories");
        List<JsonNode> items = new ArrayList<>();
        for (JsonNode n : eq.get("items")) {
            ObjectNode o = n.deepCopy();
            List<String> aliases = new ArrayList<>();
            n.get("aliases").forEach(a -> aliases.add(a.asText().toLowerCase(Locale.ROOT)));
            ArrayNode used = o.putArray("experiments");
            for (Experiment e : catalogue.all()) {
                boolean uses = e.equipment().stream().anyMatch(x -> aliases.contains(x.toLowerCase(Locale.ROOT)));
                if (uses) used.add(mapper.valueToTree(link(e)));
            }
            o.remove("aliases");
            items.add(o);
        }
        this.equipment = List.copyOf(items);

        // Formula library: experiment slugs become links with titles (V = IR opens Ohm's law).
        Map<String, Experiment> bySlug = catalogue.all().stream().collect(Collectors.toMap(Experiment::slug, Function.identity()));
        List<JsonNode> fs = new ArrayList<>();
        for (JsonNode n : read(mapper, "content/formulas/formulas.json").get("formulas")) {
            ObjectNode o = n.deepCopy();
            ArrayNode links = mapper.createArrayNode();
            n.get("experiments").forEach(s -> {
                Experiment e = bySlug.get(s.asText());
                if (e != null) links.add(mapper.valueToTree(link(e)));
            });
            o.set("experiments", links);
            fs.add(o);
        }
        this.formulas = List.copyOf(fs);
    }

    public List<JsonNode> formulas() {
        return formulas;
    }

    public Optional<JsonNode> formula(String id) {
        return formulas.stream().filter(n -> n.get("id").asText().equals(id)).findFirst();
    }

    public List<Element> elements() {
        return elements;
    }

    public Optional<Element> element(String symbolOrNumber) {
        String key = symbolOrNumber.trim().toLowerCase(Locale.ROOT);
        if (key.chars().allMatch(Character::isDigit) && !key.isEmpty()) {
            int z = Integer.parseInt(key);
            return z >= 1 && z <= 118 ? Optional.of(elements.get(z - 1)) : Optional.empty();
        }
        return Optional.ofNullable(bySymbol.get(key));
    }

    public List<JsonNode> equipment() {
        return equipment;
    }

    public JsonNode equipmentCategories() {
        return equipmentCategories;
    }

    public Optional<JsonNode> equipment(String id) {
        return equipment.stream().filter(n -> n.get("id").asText().equals(id)).findFirst();
    }

    /**
     * Period, group (0 for the f-block), and the cell in an 18-column table with the f-block in two
     * rows underneath (rows 9 and 10). Follows the IUPAC layout: group 3 is Sc, Y, Lu, Lr, and the
     * f-block is La-Yb and Ac-No.
     */
    static int[] position(int z) {
        int period = z <= 2 ? 1 : z <= 10 ? 2 : z <= 18 ? 3 : z <= 36 ? 4 : z <= 54 ? 5 : z <= 86 ? 6 : 7;
        int group;
        switch (period) {
            case 1 -> group = z == 1 ? 1 : 18;
            case 2, 3 -> {
                int o = z - (period == 2 ? 2 : 10);
                group = o <= 2 ? o : o + 10;
            }
            case 4, 5 -> group = z - (period == 4 ? 18 : 36);
            default -> {
                int base = period == 6 ? 54 : 86;
                int o = z - base;
                if (o <= 2) group = o;
                else if (o <= 16) group = 0; // f-block
                else group = o - 14;
            }
        }
        if (group == 0) {
            int base = period == 6 ? 56 : 88;
            return new int[] {period, 0, period == 6 ? 9 : 10, 3 + (z - base - 1)};
        }
        return new int[] {period, group, period, group};
    }

    private static String block(int z, int group) {
        if (group == 0) return "f";
        if (z == 2 || group <= 2) return "s";
        if (group <= 12) return "d";
        return "p";
    }

    private static ExperimentLink link(Experiment e) {
        return new ExperimentLink(e.slug(), e.title(), e.subject(), e.playable());
    }

    private static String state(String s) {
        return switch (s) {
            case "g" -> "gas";
            case "l" -> "liquid";
            default -> "solid";
        };
    }

    private static Double dbl(JsonNode n) {
        return n == null || n.isNull() ? null : n.asDouble();
    }

    private static JsonNode read(ObjectMapper mapper, String path) {
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            return mapper.readTree(in);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not load " + path, e);
        }
    }
}
