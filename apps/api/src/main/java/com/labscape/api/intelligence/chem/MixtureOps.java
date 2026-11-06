package com.labscape.api.intelligence.chem;

import java.util.List;
import java.util.Map;

/** The operations element rules need on a running mixture (implemented by the engine's run). */
interface MixtureOps {
    List<ChemistryEngine.Portion> portions();

    double tempC();

    boolean ignition();

    double aqMl();

    double get(String key);

    boolean has(String key);

    void add(String key, double mol);

    double take(String key, double mol);

    void heat(double joules);

    long nextStart();

    void reaction(String id, String name, String type, String latex, String discoveryId, double extent);

    Map<String, Object> cue(String kind, String target, long startMs);

    void gas(String gas, double mol, String target, double k, String bubble, long startMs);

    void product(String formula, double mol, String phase);

    void precipitate(String formula, double mol, String hex, long startMs, long settleMs);

    void dissolveSolid(String speciesKey, double startMs, long durationMs);

    String solidTarget(String speciesKey);

    void observe(String text);

    void reason(String text);

    void pending(String code, String tool, String message);
}
