package com.labscape.api.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final String webOrigin;

    public WebConfig(@Value("${labscape.web-origin}") String webOrigin) {
        this.webOrigin = webOrigin;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // Provider webhooks are server-to-server and HMAC-signed; never reject them over an Origin header.
        // Registered first: the first matching mapping wins.
        registry.addMapping("/v1/billing/webhook").allowedOriginPatterns("*").allowedMethods("POST").allowCredentials(false);
        registry.addMapping("/v1/**")
                .allowedOrigins(webOrigin)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE")
                .allowCredentials(true);
    }
}
