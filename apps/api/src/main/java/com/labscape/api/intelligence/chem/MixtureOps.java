package com.labscape.api.intelligence.chem;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** The operations rule families need on a running mixture (implemented by the engine's run). */
interface MixtureOps {
    List<ChemistryEngine.Portion> portions();

    double tempC();

    boolean ignition();

    /** Volume of water-based liquid (mL). */
    double aqMl();

    /** Volume of non-aqueous liquids (mL). */
    double organicMl();

    double get(String key);

    boolean has(String key);

    void add(String key, double mol);

    double take(String key, double mol);

    /** Concentration in the aqueous phase (mol/L); 0 without water. */
    double molar(String key);

    /** Every species key currently holding more than a trace. */
    Set<String> keys();

    void heat(double joules);

    long nextStart();

    void reaction(String id, String name, String type, String latex, String discoveryId, double extent);

    Map<String, Object> cue(String kind, String target, long startMs);

    void gas(String gas, double mol, String target, double k, String bubble, long startMs);

    void product(String formula, double mol, String phase);

    void precipitate(String formula, double mol, String hex, long startMs, long settleMs);

    /** Precipitates formed so far (formula -> mol still present). Mutable. */
    Map<String, Double> precipitates();

    void dissolveSolid(String speciesKey, double startMs, long durationMs);

    /** Leaves a dissolvable species in the dry solid: it is not in solution, and goes back into it when water is added. */
    void park(String key, double mol);

    /** The species sitting in dry crystals (see {@link #park}). */
    Set<String> driedKeys();

    String solidTarget(String speciesKey);

    /** Moles of a solid species put in at the start. */
    double solidInitial(String speciesKey);

    void observe(String text);

    void reason(String text);

    List<String> reasons();

    void pending(String code, String tool, String message);

    void pending(String code, String tool, String message, String ref);

    /** True when a portion of this catalogue id is in the mixture. */
    boolean present(String substanceId);

    /** True when any portion carries this tag. */
    boolean presentTag(String tag);

    boolean hadAcid();

    /** Takes protons from strong acid first, then weak acids. Returns {strong, weak}. */
    double[] consumeAcid(double protons);

    double acidAvailable();

    /** Dyes and indicators have been destroyed (bleached). */
    void bleach();

    Catalogue catalogue();
}
