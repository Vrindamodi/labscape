import { Avatar, Button, Card, Chip, cx, Field, inputClass, NamedIcon, Skeleton, useShell } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { Crown, Pencil, Save } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, patch } from "../lib/api";
import { useSession } from "../lib/session";
import type { Me, Summary } from "../lib/types";
import { StreakFlame } from "../shell/brand";

const EMOJI = ["", "🧪", "⚗️", "🔬", "🧬", "🚀", "⚡", "🌋", "🪐", "🧲", "💡", "🦉"];
const HUES = [210, 190, 265, 300, 340, 20, 45, 140];

export default function Profile() {
  const { me, setMe } = useSession();
  const { toast } = useShell();
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/v1/rewards/summary") });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me?.displayName ?? "");
  const [avatar, setAvatar] = useState(me?.profile.avatar ?? {});
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const save = async () => {
    setBusy(true);
    try {
      setMe(await patch<Me>("/v1/me", { displayName: name, avatar }));
      setEditing(false);
      toast({ kind: "success", title: "Profile saved" });
    } catch (e) {
      toast({ kind: "danger", title: "Couldn't save", body: e instanceof ApiError ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const badges = summary.data?.badges.filter((b) => b.unlocked) ?? [];
  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <Card className="overflow-hidden p-0">
        <div className="h-28 bg-[radial-gradient(600px_200px_at_20%_0%,rgba(47,128,255,.5),transparent_60%),radial-gradient(500px_200px_at_100%_100%,rgba(139,92,246,.4),transparent_60%),#121a30]" />
        <div className="-mt-12 flex flex-wrap items-end gap-5 px-6 pb-6">
          <Avatar name={editing ? name || me.displayName : me.displayName} spec={editing ? avatar : me.profile.avatar} size={104} ring={me.plan !== "free" ? "#ffc23d" : "#2f80ff"} />
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-heading text-3xl font-bold">{me.displayName}</h1>
              {me.plan !== "free" && <Chip tone="gold"><Crown className="h-3 w-3" />Premium</Chip>}
              {me.guest && <Chip tone="warning">Guest</Chip>}
            </div>
            <div className="text-sm text-white/50">@{me.username} · Level {me.level.index + 1} {me.level.name}</div>
          </div>
          {!editing && <Button variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit profile</Button>}
        </div>
        {editing && (
          <div className="space-y-5 border-t border-white/[0.06] p-6">
            <Field label="Display name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </Field>
            <div>
              <div className="mb-2 text-sm font-medium text-white/80">Avatar colour</div>
              <div className="flex flex-wrap gap-2">
                {HUES.map((h) => (
                  <button key={h} aria-label={`Hue ${h}`} onClick={() => setAvatar({ ...avatar, hue: h })} className={cx("h-9 w-9 rounded-full transition", avatar.hue === h && "ring-2 ring-white ring-offset-2 ring-offset-[#121829]")} style={{ background: `conic-gradient(from 200deg, hsl(${h} 90% 60%), hsl(${(h + 60) % 360} 90% 55%), hsl(${(h + 140) % 360} 85% 55%), hsl(${h} 90% 60%))` }} />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-white/80">Emblem</div>
              <div className="flex flex-wrap gap-2">
                {EMOJI.map((e) => (
                  <button key={e || "initials"} onClick={() => setAvatar({ ...avatar, emoji: e || undefined })} className={cx("grid h-10 w-10 place-items-center rounded-lg bg-white/[0.05] text-lg transition hover:bg-white/10", (avatar.emoji ?? "") === e && "bg-accent/30 ring-1 ring-accent")}>
                    {e || <span className="text-xs font-bold">AB</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button loading={busy} icon={<Save className="h-4 w-4" />} onClick={() => void save()}>Save</Button>
              <Button variant="ghost" onClick={() => { setEditing(false); setName(me.displayName); setAvatar(me.profile.avatar); }}>Cancel</Button>
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total XP" value={me.totalXp.toLocaleString()} />
        <Stat label="Experiments" value={String(summary.data?.counts.experiments ?? "–")} />
        <Stat label="Badges" value={String(badges.length)} />
        <Card className="flex items-center gap-3 p-5">
          <StreakFlame days={me.streaks.find((s) => s.kind === "login")?.days ?? 0} size={30} />
          <div>
            <div className="font-heading text-2xl font-bold">{me.streaks.find((s) => s.kind === "login")?.days ?? 0}</div>
            <div className="text-xs text-white/45">day streak</div>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Badges</h2>
          <Link to="/achievements" className="text-sm text-white/50 hover:text-white">All achievements →</Link>
        </div>
        {summary.isLoading ? (
          <Skeleton className="mt-4 h-20" />
        ) : badges.length ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {badges.map((b) => (
              <span key={b.id} title={b.name} className="grid h-14 w-14 place-items-center rounded-2xl text-[#1b1305]" style={{ background: "radial-gradient(circle at 35% 25%, #ffe07a, #e0a020)", boxShadow: "0 0 20px -6px #ffc23d" }}>
                <NamedIcon name={b.icon} className="h-6 w-6" />
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-white/50">No badges yet — finish onboarding or make a Playground discovery.</p>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="font-heading text-lg font-semibold">Account</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-white/45">Email</dt><dd>{me.email ?? "— (guest)"}</dd></div>
          <div><dt className="text-white/45">Plan</dt><dd className="capitalize">{me.plan.replace("_", " ")} · <Link to="/plans" className="text-accent-cyan hover:underline">Manage</Link></dd></div>
          <div><dt className="text-white/45">Learning level</dt><dd className="capitalize">{me.profile.learningLevel?.replace("_", " ")}</dd></div>
          <div><dt className="text-white/45">Interests</dt><dd className="capitalize">{me.profile.interests.join(", ")}</dd></div>
        </dl>
        {me.guest && <Link to="/signup"><Button className="mt-5" variant="premium">Create an account to keep this</Button></Link>}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs text-white/45">{label}</div>
      <div className="mt-1 font-heading text-2xl font-bold">{value}</div>
    </Card>
  );
}
