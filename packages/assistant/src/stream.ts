/** Client for /v1/ai/chat over SSE (fetch-based, since EventSource cannot POST). */

export type AiSource = { title: string; url: string; type: string };
export type AiAction = { type: "highlight" | "openFormula" | "open"; target: string; label: string };
export type AiMeta = {
  conversationId: string;
  sources: AiSource[];
  actions: AiAction[];
  grounding: { source: string; outcome: string | null; modelled: boolean };
  model: string;
  flagged: boolean;
  category: string | null;
  contextInjected: boolean;
  remaining: number | null;
};

export type ChatBody = { conversationId?: string; message: string; context?: unknown; level?: string; history?: { role: "user" | "assistant"; text: string }[] };

export type StreamHandlers = {
  onMeta: (m: AiMeta) => void;
  onToken: (t: string) => void;
  onRetract: (text: string) => void;
  onDone: (messageId: string) => void;
};

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function streamChat(url: string, body: ChatBody, h: StreamHandlers, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  if (!res.ok || !res.body) {
    const p = (await res.json().catch(() => null)) as { detail?: string; code?: string } | null;
    throw new ChatError(p?.detail ?? "The assistant is unavailable right now.", res.status, p?.code);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!ev || data === undefined) continue;
      const d = JSON.parse(data) as Record<string, unknown>;
      if (ev === "meta") h.onMeta(d as unknown as AiMeta);
      else if (ev === "token") h.onToken(String(d.t ?? ""));
      else if (ev === "retract") h.onRetract(String(d.text ?? ""));
      else if (ev === "done") h.onDone(String(d.messageId ?? ""));
    }
  }
}
