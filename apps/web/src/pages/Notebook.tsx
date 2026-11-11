import { Rich } from "@labscape/assistant";
import { useMotion } from "@labscape/motion";
import { Button, Chip, ErrorState, Skeleton, SUBJECTS, useShell, type SubjectKey } from "@labscape/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ArrowLeft, BookMarked, Clock, Crown, FileDown, History, NotebookPen, Save, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { api, ApiError } from "../lib/api";

type Summary = { attemptId: string; slug: string; subject: SubjectKey; title: string; date: string | null; score: number | null; stars: number | null; hasNotes: boolean };
type Clip = { id: string; text: string; source: string | null; createdAt: string };
type Entry = {
  attemptId: string;
  slug: string;
  subject: SubjectKey;
  title: string;
  objectives: string[];
  date: string;
  equipment: string[];
  materials: string[];
  actions: { t: number; time: string; type: string; text: string }[];
  readings: { t: number; instrument: string; key: string; value: number; unit: string }[];
  whatHappened: string | null;
  why: string | null;
  equationLatex: string | null;
  score: number | null;
  stars: number | null;
  report: { byDimension?: Record<string, number | null>; deviations?: { code: string; message: string; severity: string }[] } | null;
  quiz: { scorePct: number; passed: boolean; title: string } | null;
  notes: string;
  conclusion: string | null;
  suggestedConclusion: string | null;
  status: string;
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** /notebook: every finished experiment, newest first, plus saved assistant answers (build plan 4.6). */
export default function Notebook() {
  const q = useQuery({ queryKey: ["notebook"], queryFn: () => api<{ entries: Summary[]; clips: Clip[] }>("/v1/notebook") });
  if (q.isError) return <ErrorState title="Couldn't open your notebook" onRetry={() => void q.refetch()} />;
  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <PageHeader
        eyebrow="Resources"
        title="Lab notebook"
        sub="Every experiment you finish writes itself up here: what you did and when, your readings, what happened and why. Add your own notes and conclusion."
        className="mb-2"
      />
      {q.isLoading && <Skeleton className="h-64 rounded-card" />}
      {q.data && q.data.entries.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-card bg-card p-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-surface text-ink-muted"><NotebookPen className="h-6 w-6" /></span>
          <p className="text-ink-muted">Finish an experiment and its write-up appears here.</p>
        </div>
      )}
      {(q.data?.entries.length ?? 0) > 0 && (
        <ul className="space-y-1 rounded-card bg-card p-2">
          {q.data!.entries.map((e) => (
            <li key={e.attemptId}>
              <Link to={`/notebook/${e.attemptId}`} className="flex items-center gap-4 rounded-[18px] px-4 py-3 transition hover:bg-surface">
                <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: SUBJECTS[e.subject]?.tint ?? "#5E9BFF" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-strong">{e.title}</span>
                  <span className="text-xs text-ink-muted">{fmtDate(e.date)}</span>
                </span>
                {e.hasNotes && <Chip>notes</Chip>}
                {e.stars !== null && (
                  <span className="flex gap-0.5 text-[#E0A020]">
                    {[1, 2, 3].map((s) => (
                      <Star key={s} className={`h-4 w-4 ${s <= (e.stars ?? 0) ? "fill-current" : "opacity-25"}`} />
                    ))}
                  </span>
                )}
                <span className="w-12 text-right font-mono text-sm text-ink">{e.score ?? "–"}%</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(q.data?.clips.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
            <BookMarked className="h-4 w-4" /> Saved answers
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {q.data!.clips.map((c) => (
              /* Rich renders bold text white and code on a white tint (made for the dark chat); re-ink both here. */
              <div key={c.id} className="rounded-card bg-card p-5 text-sm text-ink [&_code]:bg-ink/10 [&_strong]:text-ink-strong">
                <Rich text={c.text} />
                <p className="mt-2 text-[11px] text-ink-muted">{fmtDate(c.createdAt)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** /notebook/:attemptId: one write-up, editable, printable. */
export function NotebookEntry() {
  const { attemptId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useShell();
  const { reduced } = useMotion();
  const q = useQuery({ queryKey: ["notebook", attemptId], queryFn: () => api<Entry>(`/v1/notebook/${attemptId}`) });
  const [notes, setNotes] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setNotes(q.data.notes);
    setConclusion(q.data.conclusion ?? "");
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api<Entry>(`/v1/notebook/${attemptId}`, { method: "PUT", json: { notes, conclusion: conclusion || null } }),
    onSuccess: (e) => {
      qc.setQueryData(["notebook", attemptId], e);
      void qc.invalidateQueries({ queryKey: ["notebook"], exact: true });
      toast({ kind: "success", title: "Notebook saved" });
    },
  });
  const exportPdf = async () => {
    try {
      await api(`/v1/reports/${attemptId}`);
      window.print();
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) toast({ kind: "info", title: "PDF export is a Premium feature", body: "You can still print this page from your browser." });
      else toast({ kind: "danger", title: "Couldn't export" });
    }
  };
  const groupedReadings = useMemo(() => {
    const m = new Map<string, Entry["readings"]>();
    (q.data?.readings ?? []).forEach((r) => m.set(r.instrument, [...(m.get(r.instrument) ?? []), r]));
    return [...m.entries()];
  }, [q.data]);

  if (q.isLoading) return <Skeleton className="mx-auto h-[70vh] max-w-3xl rounded-panel" />;
  if (q.isError || !q.data) return <ErrorState title="Couldn't open this page" onRetry={() => void q.refetch()} />;
  const e = q.data;
  const dirty = notes !== e.notes || (conclusion || null) !== e.conclusion;
  const section = (i: number) => ({ initial: reduced ? false : ({ opacity: 0, y: 8 } as const), animate: { opacity: 1, y: 0 }, transition: { delay: reduced ? 0 : i * 0.12, duration: 0.35 } });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <button onClick={() => navigate("/notebook")} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-line hover:text-ink-strong">
          <ArrowLeft className="h-4 w-4" /> Notebook
        </button>
        <span className="flex-1" />
        <Link to={`/replay/${e.attemptId}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-line px-4 text-sm font-medium text-ink transition hover:bg-line-strong">
          <History className="h-4 w-4" /> Replay
        </Link>
        <Button size="sm" variant="secondary" icon={<FileDown className="h-4 w-4" />} onClick={() => void exportPdf()}>
          Export PDF <Crown className="h-3.5 w-3.5 text-[#B07C00]" />
        </Button>
      </div>

      {/* The write-up stays a paper page (white here), so it prints the same as it reads. */}
      <article className="ls-notebook rounded-panel bg-card p-6 text-[#1f2430] sm:p-10 print:rounded-none print:p-0 print:shadow-none [&_.nb-h]:mb-2 [&_.nb-h]:text-xs [&_.nb-h]:font-semibold [&_.nb-h]:uppercase [&_.nb-h]:tracking-[0.14em] [&_.nb-h]:text-[#8a7f66] [&_code]:bg-ink/10 [&_strong]:text-[#1f2430]">
        <motion.header {...section(0)} className="border-b-2 border-[#d9d2bf] pb-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a7f66]">{SUBJECTS[e.subject]?.label ?? e.subject} · {fmtDate(e.date)}</p>
          <h1 className="mt-2 font-heading text-[34px] font-normal leading-tight tracking-[-0.02em]">{e.title}</h1>
          {e.score !== null && (
            <p className="mt-1 text-sm text-[#5b6170]">
              Score {e.score}% · {"★".repeat(e.stars ?? 0)}
              {"☆".repeat(3 - (e.stars ?? 0))}
              {e.quiz && ` · Quiz ${e.quiz.scorePct}%`}
            </p>
          )}
        </motion.header>

        <motion.section {...section(1)} className="mt-5">
          <h2 className="nb-h">Objective</h2>
          <ul className="list-disc pl-5 text-sm">{e.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <p>
              <b>Equipment:</b> {e.equipment.join(", ")}
            </p>
            {e.materials.length > 0 && (
              <p>
                <b>Materials:</b> {e.materials.join(", ")}
              </p>
            )}
          </div>
        </motion.section>

        <motion.section {...section(2)} className="mt-5">
          <h2 className="nb-h">Method (what I did)</h2>
          <ol className="max-h-80 space-y-0.5 overflow-y-auto font-mono text-[12.5px] print:max-h-none print:overflow-visible">
            {e.actions.map((a, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex shrink-0 items-center gap-1 text-[#8a7f66]">
                  <Clock className="h-3 w-3 print:hidden" />
                  {a.time}
                </span>
                <span>{a.text}</span>
              </li>
            ))}
          </ol>
        </motion.section>

        {groupedReadings.length > 0 && (
          <motion.section {...section(3)} className="mt-5">
            <h2 className="nb-h">Readings</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {groupedReadings.map(([inst, rows]) => (
                <table key={inst} className="w-full border-collapse text-sm">
                  <caption className="mb-1 text-left text-xs font-bold uppercase tracking-wide text-[#8a7f66]">{inst}</caption>
                  <thead>
                    <tr className="border-b border-[#d9d2bf] text-left text-xs text-[#5b6170]">
                      <th className="py-1">time</th>
                      <th>quantity</th>
                      <th className="text-right">value</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[12.5px]">
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-[#ece6d6]">
                        <td className="py-0.5">{Math.floor(r.t / 60000).toString().padStart(2, "0")}:{Math.floor((r.t / 1000) % 60).toString().padStart(2, "0")}</td>
                        <td>{r.key}</td>
                        <td className="text-right">
                          {r.value} {r.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          </motion.section>
        )}

        <motion.section {...section(4)} className="mt-5">
          <h2 className="nb-h">Observations and explanation</h2>
          {e.whatHappened && <p className="text-sm">{e.whatHappened}</p>}
          {e.why && <p className="mt-2 text-sm">{e.why}</p>}
          {e.equationLatex && <div className="mt-3 overflow-x-auto rounded-[16px] bg-[#f8f5ec] p-3 text-lg" dangerouslySetInnerHTML={{ __html: katex.renderToString(e.equationLatex, { displayMode: true, throwOnError: false }) }} />}
          {(e.report?.deviations?.length ?? 0) > 0 && (
            <div className="mt-3 text-sm">
              <b>Technique notes:</b>
              <ul className="list-disc pl-5">{e.report!.deviations!.map((d, i) => <li key={i}>{d.message}</li>)}</ul>
            </div>
          )}
        </motion.section>

        <motion.section {...section(5)} className="mt-5">
          <h2 className="nb-h">My notes</h2>
          <div className="print:hidden">
            <div className="mb-1 flex gap-2 text-xs">
              <button onClick={() => setPreview(false)} className={preview ? "text-[#8a7f66]" : "font-bold"}>
                Write
              </button>
              <button onClick={() => setPreview(true)} className={preview ? "font-bold" : "text-[#8a7f66]"}>
                Preview
              </button>
            </div>
            {preview ? (
              <div className="min-h-[96px] rounded-[16px] bg-[#f8f5ec] p-3 text-sm [&_strong]:text-[#1f2430]">{notes ? <Rich text={notes} /> : <span className="text-[#8a7f66]">Nothing yet.</span>}</div>
            ) : (
              <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={5} placeholder="What surprised you? What would you change? (**bold**, - lists and $maths$ work)" className="w-full rounded-[16px] bg-[#fbfaf6] p-3 text-sm text-[#1f2430] ring-1 ring-inset ring-[#d9d2bf] focus:outline-none focus:ring-[#2f80ff]" aria-label="My notes" />
            )}
          </div>
          <div className="hidden text-sm print:block">
            <Rich text={notes || "—"} />
          </div>
        </motion.section>

        <motion.section {...section(6)} className="mt-5">
          <h2 className="nb-h">Conclusion</h2>
          <textarea value={conclusion} onChange={(ev) => setConclusion(ev.target.value)} rows={3} placeholder={e.suggestedConclusion ?? "What did you find out?"} className="w-full rounded-[16px] bg-[#fbfaf6] p-3 text-sm text-[#1f2430] ring-1 ring-inset ring-[#d9d2bf] focus:outline-none focus:ring-[#2f80ff] print:hidden" aria-label="Conclusion" />
          <p className="hidden text-sm print:block">{conclusion || e.suggestedConclusion}</p>
          {!conclusion && e.suggestedConclusion && (
            <button onClick={() => setConclusion(e.suggestedConclusion!)} className="mt-1 text-xs text-[#2f80ff] print:hidden">
              Start from a suggestion
            </button>
          )}
        </motion.section>
      </article>

      <div className="sticky bottom-4 mt-4 flex justify-end print:hidden">
        <Button icon={<Save className="h-4 w-4" />} onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          Save notebook
        </Button>
      </div>
    </div>
  );
}
