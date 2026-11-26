import { sound, type AudioChannel } from "@labscape/audio";
import { celebrate } from "@labscape/motion";
import { Button, Card, Kbd, Segmented, Switch, useShell } from "@labscape/ui";
import { Accessibility, Eye, Keyboard, Shield, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { patch } from "../lib/api";
import { useSession } from "../lib/session";
import { DEFAULT_SETTINGS, useSettings } from "../lib/settings";
import { CardTitle, PageHeader } from "../components/PageHeader";

export default function Settings() {
  const { settings, update } = useSettings();
  const { me, setMe } = useSession();
  const { toast } = useShell();

  return (
    <div className="mx-auto max-w-[820px] space-y-6">
      <PageHeader title="Settings" sub="Make LABscape comfortable for you. Changes save automatically." className="mb-2" />

      <Section icon={<Eye className="h-4 w-4 text-link" />} title="Motion and display">
        <Row label="Animation speed" hint="Scales interface animations. Lab simulation speed is set inside each lab.">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.25}
              value={settings.animationSpeed}
              onChange={(e) => update({ animationSpeed: Number(e.target.value) })}
              className="w-40 accent-[#2f80ff]"
              aria-label="Animation speed"
            />
            <span className="tabular w-12 text-sm text-ink-strong">{settings.animationSpeed}×</span>
          </div>
        </Row>
        <Row label="Reduced motion" hint="System follows your device setting.">
          <Segmented label="Reduced motion" size="sm" value={settings.reducedMotion} onChange={(v) => update({ reducedMotion: v })} options={[{ value: "system", label: "System" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} />
        </Row>
        <Row label="Text size">
          <Segmented label="Text size" size="sm" value={settings.textSize} onChange={(v) => update({ textSize: v })} options={[{ value: "normal", label: "A" }, { value: "large", label: "A+" }, { value: "xlarge", label: "A++" }]} />
        </Row>
        <Row label="Preview a celebration">
          <Button size="sm" variant="secondary" onClick={() => { sound.play("success"); celebrate({ preset: "confetti" }); }}>Play</Button>
        </Row>
      </Section>

      <Section icon={<Accessibility className="h-4 w-4 text-[#1E8E3E]" />} title="Accessibility">
        <Row label="Colour-blind palette" hint="Status colours always come with an icon and a label too.">
          <select
            value={settings.palette}
            onChange={(e) => update({ palette: e.target.value as typeof settings.palette })}
            className="h-10 rounded-full border border-line bg-surface px-4 text-sm text-ink-strong outline-none transition hover:border-line-strong focus:border-accent/70"
            aria-label="Colour-blind palette"
          >
            <option value="none">Default</option>
            <option value="deuteranopia">Deuteranopia</option>
            <option value="protanopia">Protanopia</option>
            <option value="tritanopia">Tritanopia</option>
          </select>
        </Row>
        <Row label="Captions" hint="Show text for every sound and spoken line.">
          <Switch label="Captions" checked={settings.captions} onChange={(v) => update({ captions: v })} />
        </Row>
        <Row label="Haptics" hint="Vibration on phones: tick on snap, tap on placement.">
          <Switch label="Haptics" checked={settings.haptics} onChange={(v) => { update({ haptics: v }); if (v) sound.haptic("tap"); }} />
        </Row>
      </Section>

      <Section icon={<Volume2 className="h-4 w-4 text-[#6D28D9]" />} title="Sound">
        <Row label="Mute everything">
          <Switch label="Mute" checked={settings.muted} onChange={(v) => update({ muted: v })} />
        </Row>
        <Slider label="Master" value={settings.master} onChange={(v) => update({ master: v })} />
        {(
          [
            ["ui", "Interface"],
            ["lab", "Lab sounds"],
            ["ambient", "Ambience"],
            ["alert", "Alerts"],
            ["voice", "Voice"],
          ] as [AudioChannel, string][]
        ).map(([ch, l]) => (
          <Slider key={ch} label={l} value={settings.volumes[ch]} onChange={(v) => update({ volumes: { ...settings.volumes, [ch]: v } })} onRelease={() => ch === "ui" && sound.play("click")} />
        ))}
        <Row label="AI voice" hint="Read assistant answers aloud (arrives with the AI assistant).">
          <Switch label="AI voice" checked={settings.aiVoice} onChange={(v) => update({ aiVoice: v })} />
        </Row>
      </Section>

      {me && (
        <Section icon={<Shield className="h-4 w-4 text-[#9A6B00]" />} title="Privacy">
          <Row label="Hide me from leaderboards" hint={me.minor ? "Under-18 accounts already appear by username only." : undefined}>
            <Switch
              label="Hide me from leaderboards"
              checked={me.profile.leaderboardOptOut}
              onChange={async (v) => {
                const next = await patch<typeof me>("/v1/me", { leaderboardOptOut: v });
                setMe(next);
                toast({ kind: "success", title: v ? "You're hidden from leaderboards" : "You're back on the leaderboards" });
              }}
            />
          </Row>
        </Section>
      )}

      <Section icon={<Keyboard className="h-4 w-4 text-ink-muted" />} title="Keyboard">
        <div className="grid gap-2 py-3 text-sm sm:grid-cols-2">
          {[
            [["Ctrl", "K"], "Search anything"],
            [["?"], "Show a lab's shortcuts"],
            [["Space"], "Hold to pour (in labs)"],
            [["Esc"], "Close dialogs"],
          ].map(([keys, l]) => (
            <div key={String(l)} className="flex items-center justify-between rounded-[16px] bg-surface px-4 py-2.5">
              <span className="text-ink">{l as string}</span>
              <span className="flex gap-1">{(keys as string[]).map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => { update(DEFAULT_SETTINGS); toast({ kind: "info", title: "Settings reset" }); }}>Reset to defaults</Button>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="p-6 sm:p-7">
      <CardTitle icon={icon}>{title}</CardTitle>
      <div className="mt-3 divide-y divide-line">{children}</div>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div>
        <div className="text-sm font-medium text-ink-strong">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Slider({ label, value, onChange, onRelease }: { label: string; value: number; onChange: (v: number) => void; onRelease?: () => void }) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-3">
        <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onRelease} className="w-40 accent-[#8b5cf6]" aria-label={`${label} volume`} />
        <span className="tabular w-10 text-right text-sm text-ink-muted">{Math.round(value * 100)}</span>
      </div>
    </Row>
  );
}
