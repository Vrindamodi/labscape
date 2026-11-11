import { Card, Chip, ErrorState, inputClass, Skeleton, useShell } from "@labscape/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Ban, CircleDot, Clapperboard, IndianRupee, Search, ShieldAlert, Sparkles, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EXPERIMENTS, goldenEvents, runSession } from "@labscape/lab-engine";
import { CardTitle, PageHeader } from "../components/PageHeader";
import { api, ApiError, patch, rupees } from "../lib/api";
import { useSession } from "../lib/session";

type Stats = {
  totals: Record<string, number>;
  signups: { day: string; count: number }[];
  activeUsers: { day: string; count: number }[];
  topDiscoveries: { id: string; count: number }[];
};
type AdminUser = { id: string; email: string | null; username: string; displayName: string; role: string; guest: boolean; disabled: boolean; totalXp: number; createdAt: string; lastSeenAt: string };

const ROLES = ["student", "teacher", "reviewer", "admin", "super_admin"];

export default function Admin() {
  const { me } = useSession();
  const { toast } = useShell();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: () => api<Stats>("/v1/admin/stats") });
  const users = useQuery({ queryKey: ["admin", "users", q], queryFn: () => api<AdminUser[]>(`/v1/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`) });

  const change = async (id: string, body: { role?: string; disabled?: boolean }) => {
    try {
      await patch(`/v1/admin/users/${id}`, body);
      toast({ kind: "success", title: "User updated" });
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      toast({ kind: "danger", title: "Not allowed", body: e instanceof ApiError ? e.message : undefined });
    }
  };

  const t = stats.data?.totals ?? {};
  return (
    <div className="mx-auto max-w-[1240px] space-y-6">
      <PageHeader title="Admin" sub="Platform health, golden runs, users and roles." className="mb-2" />
      {stats.isError ? (
        <ErrorState onRetry={() => void stats.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi icon={<Users className="h-4 w-4" />} label="Users" value={t.users} sub={`${t.guests ?? 0} guests`} loading={stats.isLoading} />
          <Kpi icon={<Activity className="h-4 w-4" />} label="Active (7 d)" value={t.active7d} loading={stats.isLoading} />
          <Kpi icon={<UserPlus className="h-4 w-4" />} label="Sign-ups (7 d)" value={t.signups7d} loading={stats.isLoading} />
          <Kpi icon={<IndianRupee className="h-4 w-4" />} label="Revenue" value={t.revenuePaise} money sub={`${t.activeSubscriptions ?? 0} subscribers`} loading={stats.isLoading} />
          <Kpi icon={<Sparkles className="h-4 w-4" />} label="Discoveries" value={t.playgroundDiscoveries} sub={`${(t.xpAwarded ?? 0).toLocaleString()} XP awarded`} loading={stats.isLoading} />
          <Kpi icon={<ShieldAlert className="h-4 w-4" />} label="Safety blocks" value={t.safetyBlocks} loading={stats.isLoading} />
        </div>
      )}
      {stats.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Bars title="Sign-ups, last 14 days" data={stats.data.signups} color="#2F80FF" />
          <Bars title="Active scientists, last 14 days" data={stats.data.activeUsers} color="#0F766E" />
        </div>
      )}

      <GoldenRuns />

      <Card className="p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Users and roles</CardTitle>
          <div className="relative w-72 max-w-full">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input className={`${inputClass} h-10 pl-10`} placeholder="Search name, username or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
          </div>
        </div>
        {users.isLoading ? (
          <Skeleton className="mt-4 h-40" />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm text-ink">
              <thead className="text-left text-xs text-ink-muted">
                <tr><th className="pb-2 font-medium">User</th><th className="pb-2 font-medium">Role</th><th className="pb-2 font-medium">XP</th><th className="pb-2 font-medium">Last seen</th><th className="pb-2 font-medium" /></tr>
              </thead>
              <tbody>
                {users.data?.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="py-3">
                      <div className="font-medium text-ink-strong">{u.displayName} {u.guest && <Chip className="ml-1">guest</Chip>} {u.disabled && <Chip tone="danger" className="ml-1">disabled</Chip>}</div>
                      <div className="text-xs text-ink-muted">@{u.username}{u.email ? ` · ${u.email}` : ""}</div>
                    </td>
                    <td className="py-3">
                      <select
                        value={u.role}
                        disabled={u.id === me?.id}
                        onChange={(e) => void change(u.id, { role: e.target.value })}
                        className="h-9 rounded-full border border-line bg-surface px-3 text-sm text-ink-strong outline-none transition hover:border-line-strong focus:border-accent/70 disabled:opacity-50"
                        aria-label={`Role for ${u.username}`}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                      </select>
                    </td>
                    <td className="tabular py-3">{u.totalXp.toLocaleString()}</td>
                    <td className="py-3 text-ink-muted">{new Date(u.lastSeenAt).toLocaleDateString()}</td>
                    <td className="py-3 text-right">
                      {u.id !== me?.id && (
                        <button onClick={() => void change(u.id, { disabled: !u.disabled })} className="inline-flex items-center gap-1 rounded-full bg-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-ink-strong hover:text-on-ink">
                          <Ban className="h-3.5 w-3.5" />{u.disabled ? "Enable" : "Disable"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, sub, money, loading }: { icon: React.ReactNode; label: string; value: number | undefined; sub?: string; money?: boolean; loading: boolean }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">{icon}{label}</div>
      {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <div className="tabular mt-1 font-heading text-[26px] font-medium leading-tight tracking-tight text-ink-strong">{money ? rupees(value ?? 0) : (value ?? 0).toLocaleString()}</div>}
      {sub && <div className="mt-0.5 text-[11px] text-ink-muted">{sub}</div>}
    </Card>
  );
}

function Bars({ title, data, color }: { title: string; data: { day: string; count: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <Card className="p-6 sm:p-7">
      <CardTitle className="text-lg">{title}</CardTitle>
      <div className="mt-5 flex h-36 items-end gap-1.5">
        {data.map((d) => (
          <div key={d.day} className="group relative flex-1" title={`${d.day}: ${d.count}`}>
            <div className="w-full rounded-t-md" style={{ height: `${Math.max(3, (d.count / max) * 140)}px`, background: color }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-ink-muted"><span>{data[0]?.day.slice(5)}</span><span>today</span></div>
    </Card>
  );
}

/** Golden runs: each shipped demo replayed in the browser, plus a link to record a new one. */
function GoldenRuns() {
  const rows = useMemo(
    () =>
      Object.values(EXPERIMENTS).map((c) => {
        const r = runSession(c, goldenEvents(c.golden), { tailMs: 1500 });
        return { slug: c.slug, title: c.title, subject: c.subject, stars: r.report.stars, deviations: r.report.deviations.length, events: c.golden.events.length, seconds: c.golden.durationS, review: c.reviewStatus };
      }),
    [],
  );
  return (
    <Card className="p-6 sm:p-7">
      <CardTitle icon={<Clapperboard className="h-4 w-4 text-link" />}>Golden runs</CardTitle>
      <p className="mt-2 text-sm text-ink-muted">The demo for each experiment, replayed through the engine and scored right now. Record a new one by doing the experiment yourself; the recorder appears beside the steps.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm text-ink">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="py-2">Experiment</th>
              <th>Replay score</th>
              <th>Events</th>
              <th>Length</th>
              <th>Review</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-t border-line">
                <td className="py-3 font-medium text-ink-strong">{r.title}</td>
                <td>
                  <span className={r.stars === 3 && r.deviations === 0 ? "text-[#1E8E3E]" : "text-[#B07C00]"}>
                    {"★".repeat(r.stars)}
                    {"☆".repeat(3 - r.stars)}
                  </span>
                  {r.deviations > 0 && <span className="ml-2 text-xs text-[#8A5200]">{r.deviations} deviations</span>}
                </td>
                <td className="text-ink-muted">{r.events}</td>
                <td className="text-ink-muted">{r.seconds} s</td>
                <td>
                  <Chip tone={r.review === "approved" ? "success" : "warning"}>{r.review}</Chip>
                </td>
                <td className="text-right">
                  <Link to={`/lab/${r.subject}/${r.slug}?record=1`} className="inline-flex items-center gap-1.5 rounded-full bg-[#FDE3E0] px-3 py-1.5 text-xs font-medium text-[#B3261E] transition hover:bg-[#C5221F] hover:text-white">
                    <CircleDot className="h-3.5 w-3.5" /> Record
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
