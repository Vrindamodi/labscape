package com.labscape.api.intelligence.safety;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.intelligence.chem.Substance;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Reviewed prohibited-pattern rules (pipeline step 3). Server-only: rule ids and descriptions are
 * written to the audit log but never returned to a client.
 */
@Component
public class SafetyRuleBook {

    private static final String RESOURCE = "/safety/rules.json";

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Rule(String id, List<String> allOf, String description) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record File(String version, List<Rule> rules) {}

    private final String version;
    private final List<Rule> rules;

    public SafetyRuleBook(ObjectMapper mapper) {
        try (InputStream in = SafetyRuleBook.class.getResourceAsStream(RESOURCE)) {
            if (in == null) throw new IllegalStateException("Missing " + RESOURCE);
            File f = mapper.readValue(in, File.class);
            this.version = f.version();
            this.rules = List.copyOf(f.rules());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public static SafetyRuleBook load() {
        return new SafetyRuleBook(new ObjectMapper());
    }

    public String version() {
        return version;
    }

    /** First rule whose tags are all present across the mixture. */
    public Optional<Rule> match(Collection<Substance> mixture) {
        return match(mixture, Set.of());
    }

    /**
     * @param also tags the mixture has taken on beyond those of its ingredients: an oxidiser that went in
     *        as a solution and was then boiled dry is a solid oxidiser from then on
     */
    public Optional<Rule> match(Collection<Substance> mixture, Set<String> also) {
        Set<String> tags = new HashSet<>(also);
        for (Substance s : mixture) {
            if (s.tags() != null) tags.addAll(s.tags());
        }
        return rules.stream().filter(r -> tags.containsAll(r.allOf())).findFirst();
    }
}
