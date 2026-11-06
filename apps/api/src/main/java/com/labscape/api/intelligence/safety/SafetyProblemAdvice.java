package com.labscape.api.intelligence.safety;

import com.labscape.api.intelligence.playground.PlaygroundController;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Maps safety pipeline errors to RFC 9457 problem details with a machine-readable code. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = {SafetyController.class, PlaygroundController.class})
public class SafetyProblemAdvice {

    @ExceptionHandler(SafetyExceptions.EngineDisabled.class)
    ProblemDetail disabled(SafetyExceptions.EngineDisabled e) {
        return problem(HttpStatus.SERVICE_UNAVAILABLE, "Safety engine offline", e.getMessage(), "SAFETY_ENGINE_DISABLED");
    }

    @ExceptionHandler(SafetyExceptions.NotInCatalogue.class)
    ProblemDetail notInCatalogue(SafetyExceptions.NotInCatalogue e) {
        return problem(HttpStatus.UNPROCESSABLE_ENTITY, "Not in catalogue", e.getMessage(), "NOT_IN_CATALOGUE");
    }

    @ExceptionHandler(SafetyExceptions.UnitMismatch.class)
    ProblemDetail unit(SafetyExceptions.UnitMismatch e) {
        return problem(HttpStatus.UNPROCESSABLE_ENTITY, "Wrong unit", e.getMessage(), "UNIT_MISMATCH");
    }

    @ExceptionHandler(SafetyExceptions.UnsupportedSubject.class)
    ProblemDetail subject(SafetyExceptions.UnsupportedSubject e) {
        return problem(HttpStatus.UNPROCESSABLE_ENTITY, "Subject not available", e.getMessage(), "SUBJECT_NOT_AVAILABLE");
    }

    @ExceptionHandler(SafetyExceptions.Cooldown.class)
    ResponseEntity<ProblemDetail> cooldown(SafetyExceptions.Cooldown e) {
        long seconds = Math.max(1, e.remaining().toSeconds());
        ProblemDetail p = problem(HttpStatus.TOO_MANY_REQUESTS, "Safety cooldown",
                "Too many restricted combinations in a short time. Take a short break, then try a supported experiment.",
                "SAFETY_COOLDOWN");
        p.setProperty("retryAfterSeconds", seconds);
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(seconds))
                .body(p);
    }

    private static ProblemDetail problem(HttpStatus status, String title, String detail, String code) {
        ProblemDetail p = ProblemDetail.forStatusAndDetail(status, detail);
        p.setTitle(title);
        p.setProperty("code", code);
        return p;
    }
}
