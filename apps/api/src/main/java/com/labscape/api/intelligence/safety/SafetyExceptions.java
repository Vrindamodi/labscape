package com.labscape.api.intelligence.safety;

import java.time.Duration;

/** Errors raised by the safety pipeline; mapped to RFC 9457 problem details. */
public final class SafetyExceptions {

    private SafetyExceptions() {}

    public static class EngineDisabled extends RuntimeException {
        public EngineDisabled() {
            super("The safety engine is turned off.");
        }
    }

    public static class NotInCatalogue extends RuntimeException {
        public NotInCatalogue(String ref) {
            super("'" + ref + "' is not in the LABscape catalogue.");
        }
    }

    public static class UnitMismatch extends RuntimeException {
        public UnitMismatch(String ref, String expected) {
            super("'" + ref + "' must be measured in " + expected + ".");
        }
    }

    public static class UnsupportedSubject extends RuntimeException {
        public UnsupportedSubject(String subject) {
            super("Sandbox simulation for '" + subject + "' is not available yet.");
        }
    }

    public static class Cooldown extends RuntimeException {
        private final Duration remaining;

        public Cooldown(Duration remaining) {
            super("Safety cooldown active.");
            this.remaining = remaining;
        }

        public Duration remaining() {
            return remaining;
        }
    }
}
