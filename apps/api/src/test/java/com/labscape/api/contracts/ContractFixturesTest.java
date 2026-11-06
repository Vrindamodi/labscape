package com.labscape.api.contracts;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Contract tests: the Java mirror must read every fixture published in packages/contracts.
 * Unknown properties fail the test, so a TS-side contract change breaks the build until the
 * Java mirror is updated in the same PR.
 */
class ContractFixturesTest {

    private static final Path FIXTURES = Path.of("..", "..", "packages", "contracts", "fixtures");

    private final ObjectMapper mapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    @Test
    void labEventsFixtureMatchesJavaMirror() throws IOException {
        List<LabEvent> events = mapper.readValue(
                read("lab-events/titration-accurate-run.json"), new TypeReference<>() {});
        assertThat(events).isNotEmpty();
        for (int i = 0; i < events.size(); i++) {
            assertThat(events.get(i).seq()).as("seq must be monotonic without gaps").isEqualTo(i + 1);
        }
    }

    @Test
    void simulationResultFixtureMatchesJavaMirror() throws IOException {
        SimulationResult result = mapper.readValue(
                read("simulation-results/hcl-naoh-endpoint.json"), SimulationResult.class);
        assertThat(result.outcome()).isEqualTo(SimulationResult.Outcome.REACTION);
        assertThat(result.cues()).allSatisfy(cue -> assertThat(cue.has("kind")).isTrue());
    }

    @Test
    void progressFixtureMatchesJavaMirror() throws IOException {
        JsonNode root = mapper.readTree(read("progress/experiment-completed.json"));
        ProgressEvent event = mapper.treeToValue(root.get("event"), ProgressEvent.class);
        RewardResult reward = mapper.treeToValue(root.get("result"), RewardResult.class);
        assertThat(reward.idempotencyKey()).isEqualTo(event.idempotencyKey());
    }

    private static String read(String relative) throws IOException {
        return Files.readString(FIXTURES.resolve(relative));
    }
}
