import { createRouter } from "@tanstack/react-router";
import { AppNotFound } from "@/components/not-found";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    defaultNotFoundComponent: AppNotFound,
    scrollRestoration: true,
    defaultViewTransition: true,
    defaultPreload: "intent",
  });
}