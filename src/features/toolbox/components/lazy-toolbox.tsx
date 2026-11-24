import { lazy, Suspense, useEffect, useState } from "react";

const Toolbox = lazy(() =>
  import("./Toolbox").then((module) => ({ default: module.Toolbox })),
);
const GamesPanel = lazy(() => import("./GamesPanel"));

/**
 * The floating toolbox and its games panel. Both read `window` and
 * localStorage while they render, so they mount after hydration, and their
 * code arrives on demand: the pages keep their first-load budget.
 */
export function LazyToolbox() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <Toolbox />
      <GamesPanel />
    </Suspense>
  );
}
