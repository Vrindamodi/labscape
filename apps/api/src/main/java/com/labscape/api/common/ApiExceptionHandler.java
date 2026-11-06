package com.labscape.api.common;

import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * All errors are RFC 9457 problem details (application/problem+json).
 * Parts add handlers for their own exceptions here or in their package, always returning
 * {@link org.springframework.http.ProblemDetail} with a machine-readable "code" property.
 */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {}
