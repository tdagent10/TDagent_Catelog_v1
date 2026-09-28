"use client";

import { useEffect } from "react";

/**
 * Registers the service worker and makes updates apply promptly:
 * - update checks run on load, every hour, and whenever the app becomes
 *   visible, so a new deploy is discovered even in a long-open tab;
 * - when the new worker takes control the page reloads once into it, so the
 *   user never keeps looking at the old version.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onControllerChange = () => {
      if (sessionStorage.getItem("tdagent-sw-updated")) return;
      sessionStorage.setItem("tdagent-sw-updated", "1");
      window.location.reload();
    };

    let interval: number | undefined;
    let registration: ServiceWorkerRegistration | undefined;

    const checkForUpdate = () => {
      registration?.update().catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        checkForUpdate();
        interval = window.setInterval(checkForUpdate, 60 * 60 * 1000);
        document.addEventListener("visibilitychange", onVisibility);
      })
      .catch(() => {
        // Offline on first visit, private mode, etc. — app works without it.
      });

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      document.removeEventListener("visibilitychange", onVisibility);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  return null;
}
