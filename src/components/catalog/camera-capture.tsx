"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraIcon } from "./icons";

type CameraFailure =
  | "insecure"
  | "denied"
  | "none"
  | "unsupported"
  | "unknown";

type Props = {
  open: boolean;
  onClose: () => void;
  onCapture: (source: Blob) => Promise<void> | void;
  busy: boolean;
  error: string | null;
};

const FAILURE_TEXT: Record<CameraFailure, string> = {
  insecure:
    "The camera needs a secure connection. Open the app over https or localhost, or use the buttons below.",
  denied: "Camera permission was blocked. Allow it in your browser settings, or use the buttons below.",
  none: "No camera was found on this device. Use the buttons below.",
  unsupported: "This browser cannot open a camera. Use the buttons below.",
  unknown: "The camera could not be started. Use the buttons below.",
};

export function CameraCapture({ open, onClose, onCapture, busy, error }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  // Only touches the media stream. UI state is reset by remounting via `key`,
  // so this stays safe to call from an effect body.
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }

    let cancelled = false;

    (async () => {
      if (!window.isSecureContext) {
        setFailure("insecure");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setFailure("unsupported");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        setFailure(null);
        // Render the <video> element first; a second effect below attaches
        // the stream once the element exists. (Attaching here never ran:
        // the element only renders when `live` is true.)
        if (!cancelled) setLive(true);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setFailure(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "none"
              : "unknown",
        );
        // Surface the raw error so a failure can be diagnosed, not just categorized.
        setDetail(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop]);

  // Attach the acquired stream to the <video> element once it is rendered,
  // then mark the shutter ready only when frames actually have dimensions.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!open || !live || !video || !stream) return;

    let done = false;
    const markReady = () => {
      if (!done && video.videoWidth > 0) {
        done = true;
        setReady(true);
      }
    };

    video.srcObject = stream;
    video.addEventListener("loadedmetadata", markReady);
    video
      .play()
      .then(markReady)
      .catch(() => {
        // Autoplay with sound blocked etc. — metadata event still fires.
      });

    // Safety net: poll briefly in case events are swallowed.
    const timer = window.setInterval(() => {
      markReady();
      if (done) window.clearInterval(timer);
    }, 300);
    const timeout = window.setTimeout(() => window.clearInterval(timer), 5000);

    return () => {
      video.removeEventListener("loadedmetadata", markReady);
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [open, live]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const grab = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setDetail("Camera is still starting. Wait a moment, then try again.");
      return;
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setDetail("This browser cannot read the camera frame. Try again.");
        return;
      }
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) onCapture(blob);
          else setDetail("Could not read the camera frame. Try again.");
        },
        "image/jpeg",
        0.92,
      );
    } catch {
      setDetail("Could not capture. Try again.");
    }
  };

  const pick = (input: HTMLInputElement | null) => {
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (file) onCapture(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Take a photo"
    >
      <div
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] sm:max-w-md sm:rounded-2xl sm:pb-0"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h2 className="text-[17px] font-bold text-navy">Take a photo</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-navy/60 hover:bg-canvas"
          >
            Cancel
          </button>
        </div>

        {live ? (
          <>
            <div className="relative aspect-[4/3] bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="h-full w-full object-cover"
              />
            </div>

            <div className="flex items-center justify-between gap-3 p-5">
              <span className="text-xs font-semibold text-navy/50">max 200KB</span>

              <button
                type="button"
                onClick={grab}
                disabled={busy || !ready}
                aria-label={ready ? "Capture photo" : "Camera starting…"}
                title={ready ? "Capture photo" : "Camera starting…"}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-blue text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CameraIcon className="h-7 w-7" />
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="rounded-lg border border-accent-blue-soft px-3 py-2 text-sm font-semibold text-accent-blue hover:bg-accent-blue/5"
              >
                Instead
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas">
                <CameraIcon className="h-7 w-7 text-navy/40" />
              </span>
              <p className="text-sm font-medium text-navy/70">
                {failure ? FAILURE_TEXT[failure] : "Starting camera…"}
              </p>
              {detail && (
                <p className="mt-1 break-words text-xs font-medium text-navy/50">
                  {detail}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2.5 px-5 pb-5">
              {/* capture makes a phone open its own Camera app; desktop ignores it. */}
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-lg bg-accent-blue px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <CameraIcon className="h-5 w-5" />
                Open camera
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="rounded-lg border border-card-border px-4 py-3 text-[15px] font-semibold text-navy transition-colors hover:bg-canvas disabled:opacity-50"
              >
                Choose a file
              </button>
              <p className="pt-1 text-center text-xs font-medium text-navy/40">
                Photos are compressed to under 200KB
              </p>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="px-5 pb-5 text-sm font-medium text-brand">
            {error}
          </p>
        )}

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none fixed bottom-0 left-0 h-px w-px opacity-0"
          onChange={(e) => pick(e.target)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none fixed bottom-0 left-0 h-px w-px opacity-0"
          onChange={(e) => pick(e.target)}
        />
      </div>
    </div>
  );
}
