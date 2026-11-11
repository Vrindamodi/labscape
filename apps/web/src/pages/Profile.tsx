import { Avatar, AVATAR_EMBLEMS, Blob, Button, Card, Chip, cx, Field, inputClass, NamedIcon, Skeleton, useShell } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Crown, Pencil, Save } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CardTitle } from "../components/PageHeader";
import { api, ApiError, patch } from "../lib/api";
import { useSession } from "../lib/session";
import type { Me, Summary } from "../lib/types";
import { StreakFlame } from "../shell/brand";

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
        {/* A flat colour band with blobs, in place of the old glow banner. */}
        <div className="relative h-32 overflow-hidden bg-tint-blue">
          <Blob shape="cloud" color="#48F08B" size={260} className="absolute -right-10 -top-24" />
          <Blob shape="hex" color="#FFBDF9" size={150} rotate={14} className="absolute right-[34%] -bottom-20" />
        </div>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 px-6 pb-6 sm:px-8">
          {/* Only the avatar overlaps the band; the name stays on white. */}
          <span className="relative -mt-12 rounded-full ring-[6px] ring-card">
            <Avatar name={editing ? name || me.displayName : me.displayName} spec={editing ? avatar : me.profile.avatar} size={104} ring={me.plan !== "free" ? "#ffc23d" : undefined} />
          </span>
          {/* A floor on the width makes the name wrap under the avatar on phones instead of shrinking. */}
          <div className="min-w-[200px] flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-heading text-[34px] font-normal tracking-[-0.02em] text-ink-strong">{me.displayName}</h1>
              {me.plan !== "free" && <Chip tone="gold"><Crown className="h-3 w-3" />Premium</Chip>}
              {me.guest && <Chip tone="warning">Guest</Chip>}
            </div>
            <div className="text-sm text-ink-muted">@{me.username} · Level {me.level.index + 1} {me.level.name}</div>
          </div>
          {!editing && <Button variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit profile</Button>}
        </div>
        {editing && (
          <div className="space-y-6 border-t border-line p-6 sm:px-8">
            <Field label="Display name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </Field>
            <div>
              <div className="mb-2 text-sm font-medium text-ink">Avatar colour</div>
              <div className="flex flex-wrap gap-2">
                {HUES.map((h) => (
                  <button key={h} aria-label={`Hue ${h}`} onClick={() => setAvatar({ ...avatar, hue: h })} className={cx("h-9 w-9 rounded-full transition", avatar.hue === h && "ring-2 ring-ink-strong ring-offset-2 ring-offset-card")} style={{ background: `conic-gradient(from 200deg, hsl(${h} 90% 60%), hsl(${(h + 60) % 360} 90% 55%), hsl(${(h + 140) % 360} 85% 55%), hsl(${h} 90% 60%))` }} />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-ink">Emblem</div>
              <div className="flex flex-wrap gap-2">
                {[{ key: "", label: "Initials", Icon: null }, ...AVATAR_EMBLEMS].map(({ key, label, Icon }) => (
                  <button
                    key={key || "initials"}
                    onClick={() => setAvatar({ ...avatar, emoji: key || undefined })}
                    aria-label={label}
                    aria-pressed={(avatar.emoji ?? "") === key}
                    title={label}
                    className={cx("grid h-11 w-11 place-items-center rounded-full transition", (avatar.emoji ?? "") === key ? "bg-ink-strong text-on-ink" : "bg-surface text-ink hover:bg-line")}
                  >
                    {Icon ? <Icon className="h-5 w-5" aria-hidden /> : <span className="text-xs font-bold">AB</span>}
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total XP" value={me.totalXp.toLocaleString()} />
        <Stat label="Experiments" value={String(summary.data?.counts.experiments ?? "–")} />
        <Stat label="Badges" value={String(badges.length)} />
        <Card className="flex items-center gap-3 p-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface"><StreakFlame days={me.streaks.find((s) => s.kind === "login")?.days ?? 0} size={26} /></span>
          <div>
            <div className="font-heading text-[28px] font-medium leading-none tracking-tight text-ink-strong">{me.streaks.find((s) => s.kind === "login")?.days ?? 0}</div>
            <div className="mt-1 text-xs text-ink-muted">day streak</div>
          </div>
        </Card>
      </div>

      <Card className="p-6 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Badges</CardTitle>
          <Link to="/achievements" className="flex items-center gap-1.5 rounded-full bg-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink-strong hover:text-on-ink">
            All achievements <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {summary.isLoading ? (
          <Skeleton className="mt-4 h-20" />
        ) : badges.length ? (
          <div className="mt-5 flex flex-wrap gap-3">
            {badges.map((b) => (
              <span key={b.id} title={b.name} className="grid h-14 w-14 place-items-center rounded-full bg-tint-yellow text-[#3d2a00]">
                <NamedIcon name={b.icon} className="h-6 w-6" />
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">No badges yet — finish onboarding or make a Playground discovery.</p>
        )}
      </Card>

      <Card className="p-6 sm:p-7">
        <CardTitle>Account</CardTitle>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-muted">Email</dt><dd className="mt-0.5 text-ink-strong">{me.email ?? "— (guest)"}</dd></div>
          <div><dt className="text-ink-muted">Plan</dt><dd className="mt-0.5 capitalize text-ink-strong">{me.plan.replace("_", " ")} · <Link to="/plans" className="text-link hover:underline">Manage</Link></dd></div>
          <div><dt className="text-ink-muted">Learning level</dt><dd className="mt-0.5 capitalize text-ink-strong">{me.profile.learningLevel?.replace("_", " ")}</dd></div>
          <div><dt className="text-ink-muted">Interests</dt><dd className="mt-0.5 capitalize text-ink-strong">{me.profile.interests.join(", ")}</dd></div>
        </dl>
        {me.guest && <Link to="/signup"><Button className="mt-6">Create an account to keep this</Button></Link>}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1 font-heading text-[28px] font-medium leading-tight tracking-tight text-ink-strong">{value}</div>
    </Card>
  );
}
