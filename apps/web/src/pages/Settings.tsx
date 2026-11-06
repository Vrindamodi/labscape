import { sound, type AudioChannel } from "@labscape/audio";
import { celebrate } from "@labscape/motion";
import { Button, Card, Kbd, Segmented, Switch, useShell } from "@labscape/ui";
import { Accessibility, Eye, Keyboard, Shield, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { patch } from "../lib/api";
import { useSession } from "../lib/session";
import { DEFAULT_SETTINGS, useSettings } from "../lib/settings";

export default function Settings() {
  const { settings, update } = useSettings();
  const { me, setMe } = useSession();
  const { toast } = useShell();

  return (
    <div className="mx-auto max-w-[820px] space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-white/55">Make LABscape comfortable for you. Changes save automatically.</p>
      </div>

      <Section icon={<Eye className="h-5 w-5 text-accent-cyan" />} title="Motion and display">
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
            <span className="tabular w-12 text-sm">{settings.animationSpeed}×</span>
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

      <Section icon={<Accessibility className="h-5 w-5 text-[#7ee2a2]" />} title="Accessibility">
        <Row label="Colour-blind palette" hint="Status colours always come with an icon and a label too.">
          <select
            value={settings.palette}
            onChange={(e) => update({ palette: e.target.value as typeof settings.palette })}
            className="h-9 rounded-md border border-white/10 bg-[#0f1628] px-3 text-sm"
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

      <Section icon={<Volume2 className="h-5 w-5 text-[#c4b1ff]" />} title="Sound">
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
        <Section icon={<Shield className="h-5 w-5 text-[#ffd77a]" />} title="Privacy">
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

      <Section icon={<Keyboard className="h-5 w-5 text-white/60" />} title="Keyboard">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          {[
            [["Ctrl", "K"], "Search anything"],
            [["?"], "Show a lab's shortcuts"],
            [["Space"], "Hold to pour (in labs)"],
            [["Esc"], "Close dialogs"],
          ].map(([keys, l]) => (
            <div key={String(l)} className="flex items-center justify-between rounded-md bg-white/[0.03] px-3 py-2">
              <span className="text-white/70">{l as string}</span>
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
    <Card className="p-6">
      <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">{icon}{title}</h2>
      <div className="mt-4 divide-y divide-white/[0.05]">{children}</div>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-white/45">{hint}</div>}
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
        <span className="tabular w-10 text-right text-sm text-white/60">{Math.round(value * 100)}</span>
      </div>
    </Row>
  );
}
