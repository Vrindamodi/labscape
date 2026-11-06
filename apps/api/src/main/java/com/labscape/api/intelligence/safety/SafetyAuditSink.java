package com.labscape.api.intelligence.safety;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Writes every safety decision to {@code safety_audit} (pipeline step 5). Without a database
 * (the {@code nodb} demo profile) it logs instead, so the pipeline never depends on storage.
 */
@Component
public class SafetyAuditSink {

    private static final Logger log = LoggerFactory.getLogger(SafetyAuditSink.class);

    public record Entry(
            String sessionKey,
            String attemptId,
            String requestId,
            String outcome,
            String reasonCode,
            String ruleId,
            List<String> inputs,
            boolean flagged) {}

    private final ObjectProvider<JdbcTemplate> jdbc;
    private final ObjectMapper mapper;

    public SafetyAuditSink(ObjectProvider<JdbcTemplate> jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public void record(Entry e) {
        JdbcTemplate db = jdbc.getIfAvailable();
        if (db == null) {
            log.info("safety_audit outcome={} reason={} rule={} flagged={} session={} inputs={}",
                    e.outcome(), e.reasonCode(), e.ruleId(), e.flagged(), e.sessionKey(), e.inputs());
            return;
        }
        try {
            db.update("""
                    INSERT INTO safety_audit (session_key, attempt_id, request_id, outcome, reason_code, rule_id, inputs, flagged)
                    VALUES (?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)
                    """,
                    e.sessionKey(), e.attemptId(), e.requestId(), e.outcome(), e.reasonCode(), e.ruleId(),
                    mapper.writeValueAsString(e.inputs()), e.flagged());
        } catch (JsonProcessingException | RuntimeException ex) {
            // Audit failure must never turn into a reaction being shown; log loudly and continue.
            log.error("safety_audit write failed for request {}", e.requestId(), ex);
        }
    }
}
