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

    public static String equation(List<Term> lhs, List<Term> rhs, String over) {
        String arrow = over == null ? " \\rightarrow " : " \\xrightarrow{\\mathrm{" + formula(over) + "}} ";
        return side(lhs) + arrow + side(rhs);
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
