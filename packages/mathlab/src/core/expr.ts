/**
 * Expression engine (build plan 3.8): parses school notation ("2x^2 - 3x + 1", "sin(x)/x",
 * "sqrt(1 - x^2)"), compiles to fast closures (no eval, so it also runs in the server's GraalJS),
 * differentiates symbolically, simplifies, and prints LaTeX.
 */

export type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { k: "fn"; name: FnName; a: Node };

export const FUNCTIONS = ["sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sqrt", "abs", "ln", "log", "exp", "floor", "ceil", "sec", "csc", "cot"] as const;
export type FnName = (typeof FUNCTIONS)[number];
const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: 2 * Math.PI };

export class ParseError extends Error {
  constructor(message: string, readonly at: number) {
    super(message);
  }
}

type Tok = { t: "num" | "id" | "op" | "(" | ")" | ","; v: string; at: number };

function tokenize(src: string): Tok[] {
  const s = src.replace(/\*\*/g, "^").replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/²/g, "^2").replace(/³/g, "^3");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j]!)) j++;
      if (s[j] === "e" && /[0-9+-]/.test(s[j + 1] ?? "") && /[0-9]/.test(s[j + 1] === "+" || s[j + 1] === "-" ? s[j + 2] ?? "" : s[j + 1]!)) {
        j += 2;
        while (j < s.length && /[0-9]/.test(s[j]!)) j++;
      }
      const v = s.slice(i, j);
      if ((v.match(/\./g) ?? []).length > 1) throw new ParseError(`"${v}" is not a number`, i);
      out.push({ t: "num", v, at: i });
      i = j;
      continue;
    }
    if (/[a-zA-Zπθ_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9πθ_]/.test(s[j]!)) j++;
      out.push(...splitIdentifier(s.slice(i, j), i));
      i = j;
      continue;
    }
    if ("+-*/^".includes(c)) out.push({ t: "op", v: c, at: i });
    else if (c === "(" || c === "[" || c === "{") out.push({ t: "(", v: "(", at: i });
    else if (c === ")" || c === "]" || c === "}") out.push({ t: ")", v: ")", at: i });
    else if (c === ",") out.push({ t: ",", v: ",", at: i });
    else throw new ParseError(`Unexpected "${c}"`, i);
    i++;
  }
  return out;
}

/** "xsin" -> x, sin ; "2pi" handled by the number path; "xy" -> x * y (single-letter variables). */
function splitIdentifier(word: string, at: number): Tok[] {
  if ((FUNCTIONS as readonly string[]).includes(word) || word in CONSTANTS || word === "theta") return [{ t: "id", v: word, at }];
  const out: Tok[] = [];
  let i = 0;
  while (i < word.length) {
    const fn = [...FUNCTIONS].sort((a, b) => b.length - a.length).find((f) => word.startsWith(f, i));
    if (fn) {
      out.push({ t: "id", v: fn, at: at + i });
      i += fn.length;
      continue;
    }
    if (word.startsWith("pi", i)) {
      out.push({ t: "id", v: "pi", at: at + i });
      i += 2;
      continue;
    }
    // single letter with optional digits/underscore subscript, e.g. a1, x_0
    let j = i + 1;
    if (word[j] === "_") j++;
    while (j < word.length && /[0-9]/.test(word[j]!)) j++;
    out.push({ t: "id", v: word.slice(i, j), at: at + i });
    i = j;
  }
  return out;
}

/** Optimal string alignment distance (adjacent swaps cost 1), for "did you mean" suggestions. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

export type TypoHint = {
  /** The run of letters as typed, e.g. "chh". */
  word: string;
  at: number;
  /** How the parser reads it: ["c", "h", "h"] means c × h × h. */
  parts: string[];
  /** Best guess at what was meant ("c", or a function name like "sqrt"), or null. */
  suggestion: string | null;
  /** The source with the word replaced by the suggestion. */
  fixed: string | null;
  /** The source with the multiplication written out ("c*h*h"), which silences the hint. */
  explicit: string;
};

/**
 * Letters typed together are read as separate variables multiplied ("chh" = c × h × h), which turns
 * a typo into new sliders without a word. This finds such runs so the UI can ask "did you mean c?".
 * Coefficient-times-x ("mx", "kx") is left alone: that is how people write it.
 * `known` lists the letters already in use elsewhere, which makes the better suggestion.
 */
export function typoHints(src: string, known: string[] = []): TypoHint[] {
  const out: TypoHint[] = [];
  const re = /[a-zA-Zθ_][a-zA-Z0-9θ_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const word = m[0];
    const at = m.index;
    if (/[0-9.]/.test(src[at - 1] ?? "") && /^e[0-9]/.test(word)) continue; // 1e5
    const parts = splitIdentifier(word, at).map((t) => t.v);
    const vars = parts.filter((v) => !(FUNCTIONS as readonly string[]).includes(v) && !(v in CONSTANTS) && v !== "theta");
    if (parts.length < 2 || vars.length < 2) continue;
    if (parts.length === 2 && parts.includes("x") && parts[0] !== parts[1]) continue; // mx, xk
    const fn = [...FUNCTIONS].map((f) => ({ f, d: editDistance(word.toLowerCase(), f) })).filter((x) => x.d <= (word.length >= 4 ? 2 : 1)).sort((a, b) => a.d - b.d)[0]?.f;
    const letter = parts.find((v) => known.includes(v)) ?? parts[0]!;
    const suggestion = fn ?? letter;
    const swap = (w: string) => src.slice(0, at) + w + src.slice(at + word.length);
    out.push({ word, at, parts, suggestion, fixed: suggestion ? swap(suggestion) : null, explicit: swap(parts.join("*")) });
  }
  return out;
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  if (!toks.length) throw new ParseError("Type an expression", 0);
  let p = 0;
  const peek = () => toks[p];
  const startsOperand = (t: Tok | undefined) => !!t && (t.t === "num" || t.t === "id" || t.t === "(");

  const expr = (): Node => {
    let a = term();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = toks[p++]!.v as "+" | "-";
      a = { k: "bin", op, a, b: term() };
    }
    return a;
  };
  const term = (): Node => {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        p++;
        a = { k: "bin", op: t.v as "*" | "/", a, b: unary() };
      } else if (startsOperand(t)) {
        // implicit multiplication: 2x, 3(x+1), x sin x
        a = { k: "bin", op: "*", a, b: unary() };
      } else return a;
    }
  };
  const unary = (): Node => {
    const t = peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      p++;
      const a = unary();
      return t.v === "-" ? { k: "neg", a } : a;
    }
    return power();
  };
  const power = (): Node => {
    const base = atom();
    if (peek()?.t === "op" && peek()!.v === "^") {
      p++;
      return { k: "bin", op: "^", a: base, b: unary() }; // right associative, allows x^-1
    }
    return base;
  };
  const atom = (): Node => {
    const t = toks[p++];
    if (!t) throw new ParseError("The expression ends too early", src.length);
    if (t.t === "num") return { k: "num", v: Number(t.v) };
    if (t.t === "(") {
      const e = expr();
      if (toks[p]?.t !== ")") throw new ParseError("Missing closing bracket", toks[p]?.at ?? src.length);
      p++;
      return e;
    }
    if (t.t === "id") {
      if ((FUNCTIONS as readonly string[]).includes(t.v)) {
        // sin x, sin(x), sin^2 x
        let pow: Node | null = null;
        if (peek()?.t === "op" && peek()!.v === "^") {
          p++;
          pow = atom();
        }
        const arg = peek()?.t === "(" ? atom() : power();
        const f: Node = { k: "fn", name: t.v as FnName, a: arg };
        return pow ? { k: "bin", op: "^", a: f, b: pow } : f;
      }
      if (t.v in CONSTANTS) return { k: "num", v: CONSTANTS[t.v]! };
      return { k: "var", name: t.v === "theta" ? "θ" : t.v };
    }
    throw new ParseError(`Unexpected "${t.v}"`, t.at);
  };
  const tree = expr();
  if (p < toks.length) throw new ParseError(`Unexpected "${toks[p]!.v}"`, toks[p]!.at);
  return tree;
}

/* ------------------------------------------------------------------ evaluation */

const FN: Record<FnName, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log,
  log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil,
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
};

export type Scope = Record<string, number>;

/** Compiles to a closure tree; ~as fast as hand-written JS for plotting thousands of points. */
export function compile(n: Node): (scope: Scope) => number {
  switch (n.k) {
    case "num": {
      const v = n.v;
      return () => v;
    }
    case "var": {
      const name = n.name;
      return (s) => s[name] ?? NaN;
    }
    case "neg": {
      const a = compile(n.a);
      return (s) => -a(s);
    }
    case "fn": {
      const f = FN[n.name];
      const a = compile(n.a);
      return (s) => f(a(s));
    }
    case "bin": {
      const a = compile(n.a);
      const b = compile(n.b);
      switch (n.op) {
        case "+": return (s) => a(s) + b(s);
        case "-": return (s) => a(s) - b(s);
        case "*": return (s) => a(s) * b(s);
        case "/": return (s) => a(s) / b(s);
        case "^": {
          // Real odd roots of negatives: (-8)^(1/3) = -2.
          if (n.b.k === "bin" && n.b.op === "/" && n.b.a.k === "num" && n.b.b.k === "num" && n.b.b.v % 2 === 1) {
            const num = n.b.a.v;
            const den = n.b.b.v;
            return (s) => {
              const x = a(s);
              return x < 0 ? Math.pow(-Math.pow(-x, 1 / den), num) : Math.pow(x, num / den);
            };
          }
          return (s) => Math.pow(a(s), b(s));
        }
      }
    }
  }
}

/** Parse + compile a single-variable function; throws ParseError with a position. */
export function fn1(src: string, v = "x"): (x: number) => number {
  const f = compile(parse(src));
  return (x) => f({ [v]: x });
}

export function variables(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === "var") out.add(n.name);
  else if (n.k === "neg" || n.k === "fn") variables(n.a, out);
  else if (n.k === "bin") {
    variables(n.a, out);
    variables(n.b, out);
  }
  return out;
}

/* ------------------------------------------------------------------ symbolic derivative */

const num = (v: number): Node => ({ k: "num", v });
const bin = (op: "+" | "-" | "*" | "/" | "^", a: Node, b: Node): Node => ({ k: "bin", op, a, b });
const fnn = (name: FnName, a: Node): Node => ({ k: "fn", name, a });

function depends(n: Node, v: string): boolean {
  return variables(n).has(v);
}

export function derivative(n: Node, v = "x"): Node {
  return simplify(d(n, v));
}

function d(n: Node, v: string): Node {
  switch (n.k) {
    case "num":
      return num(0);
    case "var":
      return num(n.name === v ? 1 : 0);
    case "neg":
      return { k: "neg", a: d(n.a, v) };
    case "bin": {
      const { a, b } = n;
      switch (n.op) {
        case "+":
          return bin("+", d(a, v), d(b, v));
        case "-":
          return bin("-", d(a, v), d(b, v));
        case "*":
          return bin("+", bin("*", d(a, v), b), bin("*", a, d(b, v)));
        case "/":
          return bin("/", bin("-", bin("*", d(a, v), b), bin("*", a, d(b, v))), bin("^", b, num(2)));
        case "^":
          if (!depends(b, v)) return bin("*", bin("*", b, bin("^", a, bin("-", b, num(1)))), d(a, v));
          if (!depends(a, v)) return bin("*", bin("*", n, fnn("ln", a)), d(b, v));
          // general: (a^b)' = a^b (b' ln a + b a'/a)
          return bin("*", n, bin("+", bin("*", d(b, v), fnn("ln", a)), bin("/", bin("*", b, d(a, v)), a)));
      }
      break;
    }
    case "fn": {
      const u = n.a;
      const du = d(u, v);
      const chain = (inner: Node) => bin("*", inner, du);
      switch (n.name) {
        case "sin": return chain(fnn("cos", u));
        case "cos": return chain({ k: "neg", a: fnn("sin", u) });
        case "tan": return chain(bin("^", fnn("sec", u), num(2)));
        case "sec": return chain(bin("*", fnn("sec", u), fnn("tan", u)));
        case "csc": return chain({ k: "neg", a: bin("*", fnn("csc", u), fnn("cot", u)) });
        case "cot": return chain({ k: "neg", a: bin("^", fnn("csc", u), num(2)) });
        case "asin": return chain(bin("/", num(1), fnn("sqrt", bin("-", num(1), bin("^", u, num(2))))));
        case "acos": return chain({ k: "neg", a: bin("/", num(1), fnn("sqrt", bin("-", num(1), bin("^", u, num(2))))) });
        case "atan": return chain(bin("/", num(1), bin("+", num(1), bin("^", u, num(2)))));
        case "sinh": return chain(fnn("cosh", u));
        case "cosh": return chain(fnn("sinh", u));
        case "tanh": return chain(bin("-", num(1), bin("^", fnn("tanh", u), num(2))));
        case "sqrt": return chain(bin("/", num(1), bin("*", num(2), fnn("sqrt", u))));
        case "abs": return chain(bin("/", u, fnn("abs", u)));
        case "ln": return chain(bin("/", num(1), u));
        case "log": return chain(bin("/", num(1), bin("*", u, num(Math.LN10))));
        case "exp": return chain(fnn("exp", u));
        case "floor":
        case "ceil": return num(0);
      }
    }
  }
  return num(0);
}

const isNum = (n: Node): n is { k: "num"; v: number } => n.k === "num";
/** A number node with exactly this value (not a type guard: false does not mean "not a number"). */
const isVal = (n: Node, v: number): boolean => n.k === "num" && n.v === v;
const same = (a: Node, b: Node): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Algebraic tidy-up: constant folding, identities (x*1, x+0, x^1), merging like constants. */
export function simplify(n: Node): Node {
  if (n.k === "num" || n.k === "var") return n;
  if (n.k === "neg") {
    const a = simplify(n.a);
    if (isNum(a)) return num(-a.v);
    if (a.k === "neg") return a.a;
    return { k: "neg", a };
  }
  if (n.k === "fn") {
    const a = simplify(n.a);
    if (isNum(a) && !["floor", "ceil"].includes(n.name)) {
      const r = FN[n.name](a.v);
      if (Number.isInteger(r)) return num(r);
    }
    return { k: "fn", name: n.name, a };
  }
  const a = simplify(n.a);
  const b = simplify(n.b);
  if (isNum(a) && isNum(b)) {
    const r = compile(bin(n.op, a, b))({});
    if (Number.isFinite(r) && Math.abs(r - Math.round(r * 1e9) / 1e9) < 1e-12) return num(Math.round(r * 1e9) / 1e9);
  }
  switch (n.op) {
    case "+":
      if (isVal(a, 0)) return b;
      if (isVal(b, 0)) return a;
      if (b.k === "neg") return simplify(bin("-", a, b.a));
      if (same(a, b)) return simplify(bin("*", num(2), a));
      break;
    case "-":
      if (isVal(b, 0)) return a;
      if (isVal(a, 0)) return simplify({ k: "neg", a: b });
      if (same(a, b)) return num(0);
      if (isNum(b) && b.v < 0) return simplify(bin("+", a, num(-b.v)));
      break;
    case "*":
      if (isVal(a, 0) || isVal(b, 0)) return num(0);
      if (isVal(a, 1)) return b;
      if (isVal(b, 1)) return a;
      if (isVal(a, -1)) return simplify({ k: "neg", a: b });
      if (isNum(b)) return simplify(bin("*", b, a)); // constants first
      if (isNum(a) && b.k === "bin" && b.op === "*" && isNum(b.a)) return simplify(bin("*", num(a.v * b.a.v), b.b));
      if (a.k === "neg") return simplify({ k: "neg", a: bin("*", a.a, b) });
      if (b.k === "neg") return simplify({ k: "neg", a: bin("*", a, b.a) });
      if (same(a, b)) return simplify(bin("^", a, num(2)));
      if (b.k === "bin" && b.op === "^" && same(a, b.a) && isNum(b.b)) return simplify(bin("^", a, num(b.b.v + 1)));
      break;
    case "/":
      if (isVal(a, 0)) return num(0);
      if (isVal(b, 1)) return a;
      if (same(a, b)) return num(1);
      break;
    case "^":
      if (isVal(b, 0)) return num(1);
      if (isVal(b, 1)) return a;
      if (isVal(a, 1)) return num(1);
      if (a.k === "bin" && a.op === "^" && isNum(a.b) && isNum(b)) return simplify(bin("^", a.a, num(a.b.v * b.v)));
      break;
  }
  return bin(n.op, a, b);
}

/* ------------------------------------------------------------------ printing */

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };

function fmtNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const r = Number(v.toPrecision(6));
  return String(r);
}

/** Plain text, e.g. "2*x + 3". */
export function toText(n: Node, parent = 0): string {
  switch (n.k) {
    case "num": return n.v < 0 && parent > 0 ? `(${fmtNum(n.v)})` : fmtNum(n.v);
    case "var": return n.name;
    case "neg": {
      const s = `-${toText(n.a, 2)}`;
      return parent > 1 ? `(${s})` : s;
    }
    case "fn": return `${n.name}(${toText(n.a)})`;
    case "bin": {
      const p = PREC[n.op]!;
      let s: string;
      if (n.op === "*" && isNum(n.a) && (n.b.k === "var" || n.b.k === "fn" || (n.b.k === "bin" && n.b.op === "^"))) s = `${toText(n.a, p)}${toText(n.b, p)}`;
      else s = n.op === "^" ? `${toText(n.a, 4)}^${toText(n.b, 4)}` : `${toText(n.a, p)} ${n.op} ${toText(n.b, p + (n.op === "-" || n.op === "/" ? 1 : 0))}`;
      return p < parent ? `(${s})` : s;
    }
  }
}

export function toLatex(n: Node, parent = 0): string {
  switch (n.k) {
    case "num": return n.v < 0 && parent > 0 ? `\\left(${fmtNum(n.v)}\\right)` : Math.abs(n.v - Math.PI) < 1e-12 ? "\\pi" : fmtNum(n.v);
    case "var": return n.name === "θ" ? "\\theta" : n.name.replace(/_?(\d+)$/, "_{$1}");
    case "neg": {
      const s = `-${toLatex(n.a, 2)}`;
      return parent > 1 ? `\\left(${s}\\right)` : s;
    }
    case "fn":
      if (n.name === "sqrt") return `\\sqrt{${toLatex(n.a)}}`;
      if (n.name === "abs") return `\\left|${toLatex(n.a)}\\right|`;
      return `\\${["sinh", "cosh", "tanh", "asin", "acos", "atan"].includes(n.name) ? (n.name.startsWith("a") ? `arc${n.name.slice(1)}` : n.name) : n.name}\\left(${toLatex(n.a)}\\right)`.replace("\\arcsin", "\\arcsin").replace("\\floor", "\\operatorname{floor}").replace("\\ceil", "\\operatorname{ceil}");
    case "bin": {
      const p = PREC[n.op]!;
      let s: string;
      if (n.op === "/") s = `\\frac{${toLatex(n.a)}}{${toLatex(n.b)}}`;
      else if (n.op === "^") s = `${toLatex(n.a, 4)}^{${toLatex(n.b)}}`;
      else if (n.op === "*") s = isNum(n.a) && n.b.k !== "num" ? `${toLatex(n.a, p)}${toLatex(n.b, p)}` : `${toLatex(n.a, p)} \\cdot ${toLatex(n.b, p)}`;
      else s = `${toLatex(n.a, p)} ${n.op} ${toLatex(n.b, p + (n.op === "-" ? 1 : 0))}`;
      return p < parent && n.op !== "/" ? `\\left(${s}\\right)` : s;
    }
  }
}

/* ------------------------------------------------------------------ solving */

/** Solves expr(var) = 0 near a guess (Newton with a bracketing fallback). */
export function solveFor(src: string, variable: string, known: Scope, guess = 1): number | null {
  const f = compile(parse(src));
  const g = (x: number) => f({ ...known, [variable]: x });
  let x = guess;
  for (let i = 0; i < 60; i++) {
    const y = g(x);
    if (!Number.isFinite(y)) break;
    if (Math.abs(y) < 1e-12) return x;
    const h = Math.max(1e-7, Math.abs(x) * 1e-7);
    const dy = (g(x + h) - g(x - h)) / (2 * h);
    if (!Number.isFinite(dy) || dy === 0) break;
    const nx = x - y / dy;
    if (Math.abs(nx - x) < 1e-12 * Math.max(1, Math.abs(x))) return nx;
    x = nx;
  }
  // bracket search over a log grid of both signs
  const pts = [0, ...Array.from({ length: 60 }, (_, i) => Math.pow(10, -6 + i * 0.25)).flatMap((p) => [p, -p])].sort((a, b) => a - b);
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]!;
    let b = pts[i]!;
    let fa = g(a);
    const fb = g(b);
    if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) continue;
    for (let k = 0; k < 200; k++) {
      const m = (a + b) / 2;
      const fm = g(m);
      if (fa * fm <= 0) b = m;
      else {
        a = m;
        fa = fm;
      }
    }
    const root = (a + b) / 2;
    // A sign change across a pole (1/sin x at 0) is not a root: the value there blows up.
    if (Math.abs(g(root)) <= 1e-6 * Math.max(1, Math.abs(fb))) return root;
  }
  return null;
}
