import { sound } from "@labscape/audio";
import { CelebrationLayer, MotionProvider } from "@labscape/motion";
import { ShellProvider } from "@labscape/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { RouteErrorBoundary } from "./shell/RouteErrorBoundary";
import { patch } from "./lib/api";
import { SessionProvider, useSession } from "./lib/session";
import { SettingsProvider, useSettings } from "./lib/settings";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 20_000 } },
});

/** Wires settings into motion, sound and the shell; syncs settings to the profile when signed in. */
function Providers({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const { me } = useSession();
  return (
    <MotionProvider prefs={{ speed: settings.animationSpeed, reduced: settings.reducedMotion }}>
      <ShellProvider
        adsHidden={me?.plan !== undefined && me.plan !== "free"}
        onToastSound={(k) => sound.play(k === "danger" ? "error" : k === "reward" ? "coin" : k === "success" ? "success" : "notify")}
      >
        {children}
        <CelebrationLayer />
      </ShellProvider>
    </MotionProvider>
  );
}

function SettingsWithSync({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return (
    <SettingsProvider onSync={(s) => me && void patch("/v1/me", { settings: s }).catch(() => {})}>
      {children}
    </SettingsProvider>
  );
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <SettingsWithSync>
            <Providers>
              <RouteErrorBoundary>
                <App />
              </RouteErrorBoundary>
            </Providers>
          </SettingsWithSync>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
