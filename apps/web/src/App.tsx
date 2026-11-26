import { useShell } from "@labscape/ui";
import { lazy, Suspense, useLayoutEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./lib/session";
import { AppShell } from "./shell/AppShell";
import { RewardOverlay } from "./shell/RewardOverlay";
import { HighlightLayer } from "./components/AssistantDock";
import { LogoMark } from "./shell/brand";

const Welcome = lazy(() => import("./pages/Welcome"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Library = lazy(() => import("./pages/Library"));
const ExperimentDetail = lazy(() => import("./pages/ExperimentDetail"));
const Achievements = lazy(() => import("./pages/Achievements"));
const Progress = lazy(() => import("./pages/Progress"));
const Profile = lazy(() => import("./pages/Profile"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Plans = lazy(() => import("./pages/Plans"));
const Settings = lazy(() => import("./pages/Settings"));
const Admin = lazy(() => import("./pages/Admin"));
const ComingSoon = lazy(() => import("./pages/ComingSoon"));
const ExperimentPlayer = lazy(() => import("./pages/lab/ExperimentPlayer"));
const PeriodicTable = lazy(() => import("./pages/PeriodicTable"));
const EquipmentPage = lazy(() => import("./pages/Equipment"));
const Formulas = lazy(() => import("./pages/Formulas"));
const Assistant = lazy(() => import("./pages/Assistant"));
const Emergency = lazy(() => import("./pages/Emergency"));
const EmergencyRun = lazy(() => import("./pages/Emergency").then((m) => ({ default: m.EmergencyRun })));
const Quizzes = lazy(() => import("./pages/Quizzes"));
const QuizSitting = lazy(() => import("./pages/Quizzes").then((m) => ({ default: m.QuizSitting })));
const Notebook = lazy(() => import("./pages/Notebook"));
const NotebookEntry = lazy(() => import("./pages/Notebook").then((m) => ({ default: m.NotebookEntry })));
const Replay = lazy(() => import("./pages/Replay"));
const Compare = lazy(() => import("./pages/Compare"));
const Playground = lazy(() => import("./pages/Playground"));
const PlaygroundRun = lazy(() => import("./pages/Playground").then((m) => ({ default: m.PlaygroundRun })));
const NotFound = lazy(() => import("./pages/NotFound"));
// Part 4 route, lazy so its assets only load on the playground (performance budget).
const ChemistryPlaygroundRoute = lazy(() => import("./routes/playground/ChemistryPlaygroundRoute"));

/**
 * The app is light, including the welcome, sign-in and onboarding screens. Full-screen labs are
 * dark, so while one is open the whole document is marked as a dark surface (body colour, portals
 * and toasts follow).
 */
function RootSurface() {
  const { fullscreen } = useShell();
  const dark = fullscreen;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (dark) root.dataset.surface = "dark";
    else delete root.dataset.surface;
  }, [dark]);
  return null;
}

export function App() {
  return (
    <>
      <RootSurface />
      <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/welcome" element={<PublicOnly><Welcome /></PublicOnly>} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/signup" element={<Auth mode="signup" />} />
        <Route path="/forgot-password" element={<Auth mode="forgot" />} />
        <Route path="/reset-password" element={<Auth mode="reset" />} />
        <Route element={<AppShell />}>
          <Route index element={<Gate need="session"><Dashboard /></Gate>} />
          <Route path="library" element={<Gate><Library /></Gate>} />
          <Route path="library/:slug" element={<Gate><ExperimentDetail /></Gate>} />
          <Route path="achievements" element={<Gate need="session"><Achievements /></Gate>} />
          <Route path="progress" element={<Gate need="session"><Progress /></Gate>} />
          <Route path="profile" element={<Gate need="session"><Profile /></Gate>} />
          <Route path="leaderboard" element={<Gate need="session"><Leaderboard /></Gate>} />
          <Route path="plans" element={<Plans />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<Gate need="admin"><Admin /></Gate>} />
          <Route path="playground/chemistry" element={<Gate need="session"><ChemistryPlaygroundRoute /></Gate>} />
          <Route path="lab/:subject/:slug" element={<ExperimentPlayer />} />
          <Route path="periodic-table" element={<PeriodicTable />} />
          <Route path="equipment" element={<EquipmentPage />} />
          <Route path="formulas" element={<Formulas />} />
          <Route path="emergency" element={<Emergency />} />
          <Route path="emergency/:slug" element={<Gate need="session"><EmergencyRun /></Gate>} />
          <Route path="assistant" element={<Gate need="session"><Assistant /></Gate>} />
          <Route path="quizzes" element={<Quizzes />} />
          <Route path="quizzes/:quizId" element={<Gate need="session"><QuizSitting /></Gate>} />
          <Route path="notebook" element={<Gate need="session"><Notebook /></Gate>} />
          <Route path="notebook/:attemptId" element={<Gate need="session"><NotebookEntry /></Gate>} />
          <Route path="replay/:attemptId" element={<Gate need="session"><Replay /></Gate>} />
          <Route path="compare" element={<Compare />} />
          <Route path="playground" element={<Gate need="session"><Playground /></Gate>} />
          <Route path="playground/:mode" element={<Gate need="session"><PlaygroundRun /></Gate>} />
          {["community"].map((p) => (
            <Route key={p} path={p} element={<ComingSoon />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      </Suspense>
      <RewardOverlay />
      <HighlightLayer />
    </>
  );
}

/** Routes that need a session send visitors to the welcome screen; unfinished onboarding resumes. */
function Gate({ need, children }: { need?: "session" | "admin"; children: ReactNode }) {
  const { me, loading } = useSession();
  const location = useLocation();
  if (loading) return null;
  if (!me && need) return <Navigate to="/welcome" replace state={{ from: location.pathname }} />;
  if (me && !me.profile.onboarded) return <Navigate to="/onboarding" replace />;
  if (need === "admin" && me?.role !== "admin" && me?.role !== "super_admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return null;
  if (me?.profile.onboarded) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Splash() {
  return (
    <div className="grid h-full min-h-screen place-items-center bg-surface">
      <LogoMark size={56} draw />
    </div>
  );
}
