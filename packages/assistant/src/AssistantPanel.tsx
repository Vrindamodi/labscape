import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import katex from "katex";
import { Check, Copy, ExternalLink, FunctionSquare, Mic, MicOff, Send, Sparkles, Square, ThumbsDown, ThumbsUp, Volume2, VolumeX, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatError, streamChat, type AiAction, type AiMeta, type AiSource, type ChatBody } from "./stream";

type Msg = { id: string; role: "user" | "assistant"; text: string; meta?: AiMeta; messageId?: string; streaming?: boolean; rated?: 1 | -1; error?: boolean };

export type AssistantPanelProps = {
  /** POST endpoint, e.g. "/v1/ai/chat". */
  endpoint: string;
  /** The current LabContext (contract 5), read at send time. */
  getContext: () => unknown;
  onAction: (a: AiAction) => void;
  rate?: (messageId: string, rating: 1 | -1) => Promise<void>;
  onSave?: (text: string) => void;
  level?: string;
  /** Text read out in voice-guided mode when it changes (the current step's instruction). */
  guideText?: string | null;
  suggestions?: string[];
  compact?: boolean;
  placeholder?: string;
  /** Header and empty-state wording (defaults suit the lab bench). */
  title?: string;
  subtitle?: string;
  intro?: string;
  /** Called after each question is sent (its context already captured). */
  onSend?: (question: string) => void;
  /** Offered under an error ("Use a hint instead"), so a learner is never left stuck when the assistant is down. */
  fallback?: { label: string; onClick: () => void };
  /** Shows a close button in the header (for sheets that host the panel). */
  onClose?: () => void;
  closeLabel?: string;
};

const DEFAULT_CHIPS = ["Why did it change colour?", "What should I do next?", "Explain it more simply"];

type Recognition = { start: () => void; stop: () => void; abort: () => void; lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

function speechRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

/** Plain text for speech: no markdown or LaTeX. */
const speakable = (t: string) => t.replace(/\$\$?([^$]+)\$\$?/g, "").replace(/\*\*/g, "").replace(/^- /gm, "");

/**
 * <AssistantPanel> (build plan 4.4): streamed, grounded answers about whatever is on the bench,
 * with KaTeX, sources, "Show me", rating, copy, push-to-talk and read-aloud.
 */
export function AssistantPanel({
  endpoint,
  getContext,
  onAction,
  rate,
  onSave,
  level,
  guideText,
  suggestions = DEFAULT_CHIPS,
  compact,
  placeholder = "Ask about this experiment…",
  title = "Science assistant",
  subtitle = "Answers from LABscape's lessons and engine",
  intro = "I can see what's on your bench. Ask why something happened, what to do next, or about any element, formula or piece of equipment.",
  onSend,
  fallback,
  onClose,
  closeLabel = "Close",
}: AssistantPanelProps) {
  const reduced = useReducedMotion();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [guided, setGuided] = useState(false);
  const conversation = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const rec = useRef<Recognition | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const voiceAvailable = useMemo(() => typeof window !== "undefined" && !!speechRecognition(), []);
  const ttsAvailable = typeof window !== "undefined" && "speechSynthesis" in window;
  const orb: "idle" | "listening" | "thinking" | "speaking" = listening ? "listening" : busy ? "thinking" : "idle";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [msgs, reduced]);

  // Voice-guided mode: read each new step aloud.
  useEffect(() => {
    if (!guided || !guideText || !ttsAvailable) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(speakable(guideText)));
  }, [guided, guideText, ttsAvailable]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const history = msgs.filter((m) => !m.error).slice(-8).map((m) => ({ role: m.role, text: m.text }));
    const uid = `u${Date.now()}`;
    const aid = `a${Date.now()}`;
    setMsgs((m) => [...m, { id: uid, role: "user", text: q }, { id: aid, role: "assistant", text: "", streaming: true }]);
    setBusy(true);
    abort.current = new AbortController();
    const patch = (f: (m: Msg) => Msg) => setMsgs((list) => list.map((m) => (m.id === aid ? f(m) : m)));
    let full = "";
    try {
      const body: ChatBody = { message: q, context: getContext() ?? undefined, history, ...(conversation.current ? { conversationId: conversation.current } : {}), ...(level ? { level } : {}) };
      onSend?.(q);
      await streamChat(
        endpoint,
        body,
        {
          onMeta: (meta) => {
            conversation.current = meta.conversationId;
            patch((m) => ({ ...m, meta }));
          },
          onToken: (t) => {
            full += t;
            patch((m) => ({ ...m, text: m.text + t }));
          },
          onRetract: (t) => {
            full = t;
            patch((m) => ({ ...m, text: t }));
          },
          onDone: (messageId) => patch((m) => ({ ...m, messageId, streaming: false })),
        },
        abort.current.signal,
      );
      patch((m) => (m.streaming ? (m.text ? { ...m, streaming: false } : { ...m, text: "No answer came back. Try again.", streaming: false, error: true }) : m));
      if (speak && ttsAvailable && full) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(speakable(full)));
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") patch((m) => ({ ...m, streaming: false }));
      else patch((m) => ({ ...m, text: e instanceof ChatError ? e.message : "Something went wrong. Try again.", streaming: false, error: true }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const ptt = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = speechRecognition();
    if (!r) return;
    rec.current = r;
    r.lang = navigator.language || "en-IN";
    r.interimResults = true;
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results).map((x) => x[0]!.transcript).join(" ");
      setInput(heard);
    };
    r.onend = () => {
      setListening(false);
      if (heard.trim()) void send(heard);
    };
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  };

  return (
    <div className={`flex min-h-0 flex-col ${compact ? "h-full" : "h-full"}`}>
      <div className="flex items-center gap-2.5 pb-3">
        <Orb state={orb} reduced={!!reduced} />
        <div className="min-w-0 flex-1">
          <div className="font-heading text-sm font-semibold text-ink-strong dark:text-white">{title}</div>
          <div className="truncate text-[11px] text-ink-muted dark:text-white/50">{subtitle}</div>
        </div>
        {ttsAvailable && (
          <button onClick={() => setSpeak((s) => !s)} aria-pressed={speak} className={`grid h-8 w-8 place-items-center rounded-full dark:rounded-md ${speak ? "text-[#6D28D9] dark:text-[#c4b1ff]" : "text-ink-muted dark:text-white/40"} hover:bg-line dark:hover:bg-white/[0.06]`} aria-label={speak ? "Stop reading answers aloud" : "Read answers aloud"} title="Read answers aloud">
            {speak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-line hover:text-ink-strong dark:rounded-md dark:text-white/60 dark:hover:bg-white/[0.08] dark:hover:text-white" aria-label={closeLabel}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {msgs.length === 0 && (
          <div className="rounded-[20px] bg-[#EFE9FF] p-4 text-[15px] text-ink dark:rounded-xl dark:bg-[linear-gradient(160deg,rgba(139,92,246,.16),rgba(232,121,249,.05))] dark:text-white/70 dark:ring-1 dark:ring-inset dark:ring-ai-violet/25">
            {intro}
          </div>
        )}
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-8 rounded-[20px] rounded-br-md bg-[#E3ECFF] px-4 py-2.5 text-[15px] text-ink-strong dark:rounded-xl dark:rounded-br-sm dark:bg-accent/25 dark:px-3 dark:py-2 dark:text-white">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`mr-2 rounded-[20px] rounded-bl-md px-4 py-3 text-[15px] dark:rounded-xl dark:rounded-bl-sm dark:px-3 dark:py-2.5 dark:ring-1 dark:ring-inset ${m.error ? "bg-[#FDE3E0] text-[#7A1D16] dark:bg-red-500/10 dark:text-red-100 dark:ring-red-400/30" : m.meta?.flagged ? "bg-[#FEF3C7] text-[#5C3B00] dark:bg-amber-400/10 dark:text-amber-50 dark:ring-amber-300/30" : "bg-surface text-ink dark:bg-white/[0.045] dark:text-white/90 dark:ring-white/10"}`}>
              {m.text ? <Rich text={m.text} streaming={!!m.streaming} /> : <Thinking reduced={!!reduced} />}
              {m.error && fallback && (
                <button onClick={fallback.onClick} className="mt-2 inline-flex items-center gap-1 rounded-full bg-tint-yellow px-3 py-1 text-xs font-semibold text-[#3d2a00] hover:brightness-95 dark:bg-amber-300/15 dark:px-2.5 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-300/40 dark:hover:bg-amber-300/25">
                  {fallback.label}
                </button>
              )}
              {!m.streaming && m.meta && <Extras m={m} onAction={onAction} onSave={onSave} onRate={rate ? async (r) => {
                if (!m.messageId) return;
                await rate(m.messageId, r).catch(() => {});
                setMsgs((list) => list.map((x) => (x.id === m.id ? { ...x, rated: r } : x)));
              } : undefined} />}
            </div>
          ),
        )}
      </div>

      <div className="pt-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => void send(s)} disabled={busy} className="rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-inset ring-line hover:bg-line disabled:opacity-40 dark:bg-white/[0.05] dark:px-2.5 dark:py-1 dark:text-[11px] dark:text-white/75 dark:ring-white/10 dark:hover:bg-white/[0.09]">
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-end gap-1.5"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder={listening ? "Listening…" : placeholder}
            aria-label="Ask the assistant"
            className="max-h-28 min-h-[44px] flex-1 resize-none rounded-[22px] bg-surface px-4 py-2.5 text-[15px] text-ink-strong ring-1 ring-inset ring-line placeholder:text-ink-muted focus:outline-none focus:ring-ink-strong/50 dark:min-h-[40px] dark:rounded-lg dark:bg-black/30 dark:px-3 dark:text-white dark:ring-white/15 dark:placeholder:text-white/30 dark:focus:ring-ai-violet"
          />
          {voiceAvailable && (
            <button type="button" onClick={ptt} aria-pressed={listening} className={`grid h-11 w-11 place-items-center rounded-full ring-1 ring-inset dark:h-10 dark:w-10 dark:rounded-lg ${listening ? "bg-red-500/80 text-white ring-red-400" : "text-ink-muted ring-line hover:bg-line dark:text-white/70 dark:ring-white/15 dark:hover:bg-white/[0.06]"}`} aria-label={listening ? "Stop listening" : "Ask by voice"}>
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()} className="grid h-11 w-11 place-items-center rounded-full bg-line text-ink-strong dark:h-10 dark:w-10 dark:rounded-lg dark:bg-white/10 dark:text-white" aria-label="Stop">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="grid h-11 w-11 place-items-center rounded-full bg-ink-strong text-on-ink disabled:opacity-40 dark:h-10 dark:w-10 dark:rounded-lg dark:bg-ai-violet dark:text-white" aria-label="Send">
              <Send className="h-4 w-4" />
            </button>
          )}
        </form>
        {ttsAvailable && guideText !== undefined && (
          <label className="mt-2 flex items-center gap-2 text-[11px] text-ink-muted dark:text-white/55">
            <input type="checkbox" checked={guided} onChange={(e) => setGuided(e.target.checked)} className="accent-[#8b5cf6]" /> Voice-guided: read each step aloud
          </label>
        )}
      </div>
    </div>
  );
}

/** Small icon buttons under an answer. */
const HOVER = "hover:bg-line hover:text-ink-strong dark:hover:bg-white/[0.06] dark:hover:text-white";

function Extras({ m, onAction, onSave, onRate }: { m: Msg; onAction: (a: AiAction) => void; onSave: ((t: string) => void) | undefined; onRate: ((r: 1 | -1) => Promise<void>) | undefined }) {
  const [copied, setCopied] = useState(false);
  const meta = m.meta!;
  return (
    <div className="mt-2 space-y-2">
      {meta.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.actions.map((a) => (
            <button key={`${a.type}-${a.target}`} onClick={() => onAction(a)} className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[11px] font-semibold text-link ring-1 ring-inset ring-line hover:bg-[#E3ECFF] dark:bg-accent-cyan/10 dark:text-accent-cyan dark:ring-accent-cyan/30 dark:hover:bg-accent-cyan/20">
              {a.type === "highlight" ? <Sparkles className="h-3 w-3" /> : a.type === "openFormula" ? <FunctionSquare className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
              {a.label}
            </button>
          ))}
        </div>
      )}
      {meta.sources.length > 0 && <Sources sources={meta.sources} />}
      <div className="flex items-center gap-1 text-ink-muted dark:text-white/40">
        <button onClick={() => void navigator.clipboard.writeText(m.text).then(() => setCopied(true))} className={`grid h-7 w-7 place-items-center rounded-full ${HOVER}`} aria-label="Copy answer">
          {copied ? <Check className="h-3.5 w-3.5 text-[#1E8E3E] dark:text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        {onSave && (
          <button onClick={() => onSave(m.text)} className={`rounded-full px-2 py-1 text-[11px] ${HOVER}`}>
            Save to notebook
          </button>
        )}
        {onRate && (
          <>
            <button onClick={() => void onRate(1)} aria-pressed={m.rated === 1} className={`grid h-7 w-7 place-items-center rounded-full hover:bg-line dark:hover:bg-white/[0.06] ${m.rated === 1 ? "text-[#1E8E3E] dark:text-emerald-300" : "hover:text-ink-strong dark:hover:text-white"}`} aria-label="Helpful">
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => void onRate(-1)} aria-pressed={m.rated === -1} className={`grid h-7 w-7 place-items-center rounded-full hover:bg-line dark:hover:bg-white/[0.06] ${m.rated === -1 ? "text-[#B3261E] dark:text-red-300" : "hover:text-ink-strong dark:hover:text-white"}`} aria-label="Not helpful">
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {meta.grounding.source === "engine" && <span className="ml-auto text-[10px] text-ink-muted dark:text-white/35">from the chemistry engine</span>}
      </div>
    </div>
  );
}

function Sources({ sources }: { sources: AiSource[] }) {
  return (
    <div className="text-[11px] text-ink-muted dark:text-white/45">
      Sources:{" "}
      {sources.map((s, i) => (
        <Fragment key={s.url + i}>
          {i > 0 && " · "}
          <a href={s.url} className="underline decoration-ink/20 hover:text-ink-strong dark:decoration-white/20 dark:hover:text-white">
            {s.title}
          </a>
        </Fragment>
      ))}
    </div>
  );
}

function Thinking({ reduced }: { reduced: boolean }) {
  return (
    <span className="inline-flex gap-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-ink/40 dark:bg-white/50" animate={reduced ? {} : { opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />
      ))}
    </span>
  );
}

/** The orb: breathes at idle, rings while listening, swirls while thinking. */
function Orb({ state, reduced }: { state: "idle" | "listening" | "thinking" | "speaking"; reduced: boolean }) {
  return (
    <span className="relative grid h-9 w-9 place-items-center" aria-hidden>
      <motion.span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#f0abfc,#8b5cf6_55%,#4c1d95)]" animate={reduced ? {} : state === "thinking" ? { rotate: 360 } : { scale: [1, 1.06, 1] }} transition={state === "thinking" ? { repeat: Infinity, duration: 1.2, ease: "linear" } : { repeat: Infinity, duration: 4 }} />
      <AnimatePresence>
        {state === "listening" && !reduced && <motion.span className="absolute inset-[-6px] rounded-full ring-2 ring-[#f0abfc]" initial={{ opacity: 0.8, scale: 0.8 }} animate={{ opacity: 0, scale: 1.4 }} exit={{ opacity: 0 }} transition={{ repeat: Infinity, duration: 0.8 }} />}
      </AnimatePresence>
    </span>
  );
}

/* ------------------------------------------------------------------ markdown-lite + KaTeX */

function tex(src: string, display: boolean) {
  return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false });
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("$")) out.push(<span key={k++} dangerouslySetInnerHTML={{ __html: tex(tok.slice(1, -1), false) }} />);
    else if (tok.startsWith("`")) out.push(<code key={k++} className="rounded bg-ink/10 px-1 font-mono text-[0.9em] dark:bg-white/10">{tok.slice(1, -1)}</code>);
    else out.push(<strong key={k++} className="font-semibold text-ink-strong dark:text-white">{tok.slice(2, -2)}</strong>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/**
 * Paragraphs, "- " and "1." lists (also straight after a line of text), "# " headings shown as bold
 * lines, **bold**, `code`, $inline$ and $$display$$ maths (display maths shows once complete).
 */
export function Rich({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = text.split(/\n\n+/);
  const out: ReactNode[] = [];
  blocks.forEach((b, i) => {
    const display = /^\$\$([\s\S]*)\$\$$/.exec(b.trim());
    if (display) {
      out.push(<div key={i} className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: tex(display[1]!, true) }} />);
      return;
    }
    if (b.trim().startsWith("$$") && streaming) {
      out.push(<div key={i} className="text-ink-muted dark:text-white/40">…</div>);
      return;
    }
    // runs of list lines become lists; everything between them stays a paragraph
    let para: string[] = [];
    let items: string[] = [];
    let ordered = false;
    let n = 0;
    const flush = () => {
      if (para.length) out.push(<p key={`${i}p${n++}`}>{inline(para.join(" "))}</p>);
      if (items.length) {
        const List = ordered ? "ol" : "ul";
        out.push(
          <List key={`${i}l${n++}`} className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
            {items.map((l, j) => (
              <li key={j}>{inline(l)}</li>
            ))}
          </List>,
        );
      }
      para = [];
      items = [];
    };
    for (const line of b.split(/\n/)) {
      if (!line.trim()) continue;
      const bullet = BULLET.test(line);
      const numbered = !bullet && NUMBERED.test(line);
      if (bullet || numbered) {
        if (para.length || (items.length && ordered !== numbered)) flush();
        ordered = numbered;
        items.push(line.replace(bullet ? BULLET : NUMBERED, ""));
      } else {
        if (items.length) flush();
        const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
        if (heading) {
          flush();
          out.push(
            <p key={`${i}h${n++}`} className="font-semibold text-ink-strong dark:text-white">
              {inline(heading[1]!.replace(/\*\*/g, ""))}
            </p>,
          );
        } else para.push(line.trim());
      }
    }
    flush();
  });
  return <div className="space-y-2 leading-relaxed">{out}</div>;
}
