package com.labscape.api.common;

import java.net.URI;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * All errors are RFC 9457 problem details (application/problem+json) with a machine-readable
 * "code" property. Parts throw {@link ApiProblem} or add handlers for their own exceptions.
 */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler(ApiProblem.class)
    ResponseEntity<ProblemDetail> apiProblem(ApiProblem e) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(e.status(), e.getMessage());
        pd.setType(URI.create("https://labscape.app/problems/" + e.code().toLowerCase().replace('_', '-')));
        pd.setProperty("code", e.code());
        return ResponseEntity.status(e.status()).body(pd);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, "Some fields need another look.");
        pd.setProperty("code", "VALIDATION");
        pd.setProperty("fields", ex.getBindingResult().getFieldErrors().stream()
                .map(f -> java.util.Map.of("field", f.getField(), "message", String.valueOf(f.getDefaultMessage())))
                .toList());
        return ResponseEntity.status(status).body(pd);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(
            Exception ex, @Nullable Object body, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        if (body instanceof ProblemDetail pd && pd.getProperties() == null) {
            pd.setProperty("code", "HTTP_" + status.value());
        }
        return super.handleExceptionInternal(ex, body, headers, status, request);
    }
}
