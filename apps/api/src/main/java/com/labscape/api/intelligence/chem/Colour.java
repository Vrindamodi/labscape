package com.labscape.api.intelligence.chem;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Perceptual colour (Oklab) helpers. Every colour the engine sends is Oklab (contract 3). */
public record Colour(double L, double a, double b, double alpha) {

    public static final Colour CLEAR = hex("#d8f1ff", 0.06);

    public static Colour hex(String hex, double alpha) {
        String h = hex.startsWith("#") ? hex.substring(1) : hex;
        double r = lin(Integer.parseInt(h.substring(0, 2), 16) / 255.0);
        double g = lin(Integer.parseInt(h.substring(2, 4), 16) / 255.0);
        double bl = lin(Integer.parseInt(h.substring(4, 6), 16) / 255.0);
        double l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
        double m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
        double s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
        return new Colour(
                0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
                alpha);
    }

    private static double lin(double c) {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    public Colour withAlpha(double newAlpha) {
        return new Colour(L, a, b, newAlpha);
    }

    public static Colour lerp(Colour x, Colour y, double t) {
        double u = Math.max(0, Math.min(1, t));
        return new Colour(
                x.L + (y.L - x.L) * u, x.a + (y.a - x.a) * u, x.b + (y.b - x.b) * u, x.alpha + (y.alpha - x.alpha) * u);
    }

    /** Weighted blend in Oklab. Weights must be non-negative; returns CLEAR when all are zero. */
    public static Colour blend(List<Colour> colours, List<Double> weights) {
        double total = 0, l = 0, a = 0, b = 0, al = 0;
        for (int i = 0; i < colours.size(); i++) {
            double w = weights.get(i);
            if (w <= 0) {
                continue;
            }
            Colour c = colours.get(i);
            total += w;
            l += c.L * w;
            a += c.a * w;
            b += c.b * w;
            al += c.alpha * w;
        }
        return total <= 0 ? CLEAR : new Colour(l / total, a / total, b / total, al / total);
    }

    public double distance(Colour o) {
        return Math.sqrt(Math.pow(L - o.L, 2) + Math.pow(a - o.a, 2) + Math.pow(b - o.b, 2))
                + Math.abs(alpha - o.alpha) * 0.5;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("L", round(L));
        m.put("a", round(a));
        m.put("b", round(b));
        m.put("alpha", round(alpha));
        return m;
    }

    private static double round(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
