package com.labscape.api.intelligence.ai;

import java.util.List;
import java.util.function.Consumer;

/**
 * The built-in answerer: composes text straight from the gathered facts, so it cannot invent
 * anything. Used when no external model is configured, and as the fallback when one fails.
 */
public class GroundedTutorModel implements ChatModel {

    private final AiTutor tutor;

    public GroundedTutorModel(AiTutor tutor) {
        this.tutor = tutor;
    }

    @Override
    public String name() {
        return "labscape-grounded-tutor";
    }

    @Override
    public String stream(String question, AiTutor.Facts facts, String contextJson, List<Turn> history, Consumer<String> sink) {
        String text = tutor.compose(facts);
        // stream in word-sized pieces so the client renders it the same way as a model's output
        String[] parts = text.split("(?<=\\s)");
        for (String p : parts) sink.accept(p);
        return text;
    }
}
