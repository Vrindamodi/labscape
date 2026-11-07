package com.labscape.api.intelligence.ai;

import java.util.List;
import java.util.function.Consumer;

/**
 * Provider-agnostic model interface (build plan 4.4). Every implementation receives the same
 * gathered facts and may only phrase them; the guard runs before and after it.
 */
public interface ChatModel {

    record Turn(String role, String text) {}

    String name();

    /** Streams the answer in pieces to `sink`; returns the full text. */
    String stream(String question, AiTutor.Facts facts, String contextJson, List<Turn> history, Consumer<String> sink);
}
