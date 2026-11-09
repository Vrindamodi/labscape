package com.labscape.api.intelligence.chem;

import java.util.ArrayList;
import java.util.List;

/** Builds KaTeX-ready chemical equations. */
public final class Latex {

    private Latex() {}

    /** One side of an equation: coefficient, formula (plain, e.g. "H2SO4"), optional charge, state. */
    public record Term(int coef, String formula, String charge, String state) {
        public static Term of(int coef, String formula, String state) {
            return new Term(coef, formula, null, state);
        }

        public static Term ion(int coef, String formula, String charge) {
            return new Term(coef, formula, charge, "aq");
        }
    }

    /** "H2SO4" -> "H_{2}SO_{4}", "CuSO4·5H2O" -> "CuSO_{4}\cdot 5H_{2}O". */
    public static String formula(String plain) {
        StringBuilder out = new StringBuilder();
        boolean afterDot = false;
        int i = 0;
        while (i < plain.length()) {
            char c = plain.charAt(i);
            if (c == '·') {
                out.append("\\cdot ");
                afterDot = true;
                i++;
                continue;
            }
            if (Character.isDigit(c)) {
                int j = i;
                while (j < plain.length() && Character.isDigit(plain.charAt(j))) {
                    j++;
                }
                String digits = plain.substring(i, j);
                char prev = i > 0 ? plain.charAt(i - 1) : ' ';
                boolean subscript = !afterDot && (Character.isLetter(prev) || prev == ')' || prev == ']');
                out.append(subscript ? "_{" + digits + "}" : digits);
                afterDot = false;
                i = j;
                continue;
            }
            afterDot = false;
            if (c == '[' || c == ']') {
                out.append(c);
            } else {
                out.append(c);
            }
            i++;
        }
        return out.toString();
    }

    public static String term(Term t) {
        StringBuilder sb = new StringBuilder();
        if (t.coef() > 1) {
            sb.append(t.coef()).append("\\,");
        }
        sb.append("\\mathrm{").append(formula(t.formula()));
        if (t.charge() != null) {
            sb.append("^{").append(t.charge()).append('}');
        }
        sb.append('}');
        if (t.state() != null) {
            sb.append("_{\\mathrm{(").append(t.state()).append(")}}");
        }
        return sb.toString();
    }

    /** Structured form of an equation (used to animate atoms rearranging). */
    public record Eq(List<Term> lhs, List<Term> rhs, String over) {}

    private static final ThreadLocal<java.util.Map<String, Eq>> RECENT =
            ThreadLocal.withInitial(java.util.HashMap::new);

    /** Clears the per-run registry of equations built on this thread. */
    public static void resetRecent() {
        RECENT.get().clear();
    }

    /** The structured equation behind a LaTeX string built on this thread, if any. */
    public static Eq structured(String latex) {
        return RECENT.get().get(latex);
    }

    public static String equation(List<Term> lhs, List<Term> rhs, String over) {
        String arrow = over == null ? " \\rightarrow " : " \\xrightarrow{\\mathrm{" + formula(over) + "}} ";
        String latex = side(lhs) + arrow + side(rhs);
        RECENT.get().put(latex, new Eq(lhs, rhs, over));
        return latex;
    }

    /**
     * Parses a compact equation such as {@code "2 Fe^3+ + 2 I^- -> 2 Fe^2+ + I2(aq)"}. Terms are separated
     * by " + "; a leading integer is the coefficient; "^" starts an ionic charge (ions default to aq);
     * a trailing (s), (l), (g) or (aq) is the state.
     */
    public static String eq(String spec) {
        return eq(spec, null);
    }

    public static String eq(String spec, String over) {
        String[] sides = spec.split("->");
        if (sides.length != 2) throw new IllegalArgumentException("Bad equation: " + spec);
        return equation(parseSide(sides[0]), parseSide(sides[1]), over);
    }

    private static List<Term> parseSide(String side) {
        List<Term> out = new ArrayList<>();
        for (String raw : side.trim().split(" \\+ ")) {
            String t = raw.trim();
            int coef = 1;
            int sp = t.indexOf(' ');
            if (sp > 0 && t.substring(0, sp).chars().allMatch(Character::isDigit)) {
                coef = Integer.parseInt(t.substring(0, sp));
                t = t.substring(sp + 1).trim();
            }
            String state = null;
            for (String s : new String[] {"(aq)", "(s)", "(l)", "(g)"}) {
                if (t.endsWith(s)) {
                    state = s.substring(1, s.length() - 1);
                    t = t.substring(0, t.length() - s.length());
                    break;
                }
            }
            int caret = t.indexOf('^');
            if (caret >= 0) {
                out.add(new Term(coef, t.substring(0, caret), t.substring(caret + 1), state == null ? "aq" : state));
            } else {
                out.add(new Term(coef, t, null, state));
            }
        }
        return out;
    }

    private static String side(List<Term> terms) {
        List<String> parts = new ArrayList<>();
        for (Term t : terms) {
            parts.add(term(t));
        }
        return String.join(" + ", parts);
    }

    /** Ionic compound formula from cation/anion symbols and charges, e.g. (Ca,2,Cl,1) -> CaCl2. */
    public static Salt salt(String cation, int cationCharge, boolean cationPoly, String anion, int anionCharge, boolean anionPoly) {
        int g = gcd(cationCharge, anionCharge);
        int x = anionCharge / g;
        int y = cationCharge / g;
        String c = x > 1 ? (cationPoly ? "(" + cation + ")" + x : cation + x) : cation;
        String a = y > 1 ? (anionPoly ? "(" + anion + ")" + y : anion + y) : anion;
        return new Salt(c + a, x, y);
    }

    public record Salt(String formula, int cations, int anions) {}

    public static int gcd(int a, int b) {
        return b == 0 ? Math.abs(a) : gcd(b, a % b);
    }

    public static int lcm(int a, int b) {
        return Math.abs(a * b) / gcd(a, b);
    }

    /** Splits a species key like "Cu^2+", "Ag+", "SO4^2-", "[Cu(NH3)4]^2+" into formula and charge. */
    public static Term ionTerm(int coef, String key) {
        int caret = key.indexOf('^');
        if (caret >= 0) {
            return Term.ion(coef, key.substring(0, caret), key.substring(caret + 1));
        }
        char last = key.charAt(key.length() - 1);
        if (last == '+' || last == '-') {
            return Term.ion(coef, key.substring(0, key.length() - 1), String.valueOf(last));
        }
        return Term.of(coef, key, "aq");
    }
}
