package com.labscape.api.common;

import org.springframework.http.HttpStatus;

/**
 * Throw from any service to return an RFC 9457 problem with a machine-readable code.
 * Rendered by {@link ApiExceptionHandler}.
 */
public class ApiProblem extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ApiProblem(HttpStatus status, String code, String detail) {
        super(detail);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public static ApiProblem badRequest(String code, String detail) {
        return new ApiProblem(HttpStatus.BAD_REQUEST, code, detail);
    }

    public static ApiProblem notFound(String code, String detail) {
        return new ApiProblem(HttpStatus.NOT_FOUND, code, detail);
    }

    public static ApiProblem conflict(String code, String detail) {
        return new ApiProblem(HttpStatus.CONFLICT, code, detail);
    }

    public static ApiProblem forbidden(String code, String detail) {
        return new ApiProblem(HttpStatus.FORBIDDEN, code, detail);
    }

    public static ApiProblem unauthorized(String code, String detail) {
        return new ApiProblem(HttpStatus.UNAUTHORIZED, code, detail);
    }
}
