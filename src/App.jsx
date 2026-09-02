import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { lazy, Suspense, useLayoutEffect } from "react";
import SettingsContextProvider from "./context/SettingsContext";
import AuthContextProvider from "./context/AuthContext";
import RequireAuth from "./components/RequireAuth";

// Each page is split out so that opening the landing page does not download the
// editor (and vice versa).
const Editor = lazy(() => import("./pages/Editor"));
const BugReport = lazy(() => import("./pages/BugReport"));
const Templates = lazy(() => import("./pages/Templates"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const Login = lazy(() => import("./pages/Login"));
const NotFound = lazy(() => import("./pages/NotFound"));

const protectedRoute = (element) => <RequireAuth>{element}</RequireAuth>;

export default function App() {
  return (
    <BrowserRouter>
      <AuthContextProvider>
        <SettingsContextProvider>
          <RestoreScroll />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Login mode="register" />} />
              <Route path="/editor" element={protectedRoute(<Editor />)} />
              <Route
                path="/editor/diagrams/:id"
                element={protectedRoute(<Editor />)}
              />
              <Route
                path="/diagrams/:id"
                element={protectedRoute(<Editor />)}
              />
              <Route
                path="/editor/templates/:id"
                element={protectedRoute(<Editor />)}
              />
              <Route path="/bug-report" element={<BugReport />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </SettingsContextProvider>
      </AuthContextProvider>
    </BrowserRouter>
  );
}

function RouteFallback() {
  return <div className="h-screen w-screen" />;
}

function RestoreScroll() {
  const location = useLocation();
  useLayoutEffect(() => {
    window.scroll(0, 0);
  }, [location.pathname]);
  return null;
}
