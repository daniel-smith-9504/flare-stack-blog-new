import { createFileRoute, Outlet } from "@tanstack/react-router";

/** The shelves's book layout: the detail page or the reader below it. */
export const Route = createFileRoute("/_public/novels/$id")({
  component: Outlet,
});
