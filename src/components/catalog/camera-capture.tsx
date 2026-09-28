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
  /** Photos finished uploading in this session, shown in the counter. */
  shots: number;
  /** Uploads still in flight, so Done can wait for them to land. */
  uploading: number;
};

const FAILURE_TEXT: Record<CameraFailure, string> = {
  insecure:
    "The camera needs a secure connection. Open the app over https or localhost, or use the buttons below.",
  denied:
    "Camera permission was blocked. Allow it in your browser settings, or use the buttons below.",
  none: "No camera was found on this device. Use the buttons below.",
  unsupported: "This browser cannot open a camera. Use the buttons below.",
  unknown: "The camera could not be started. Use the buttons below.",
};

/**
 * Mechanical shutter sound.
 *
 * A browser cannot fire the phone's real hardware shutter — that sound is
 * owned by the camera app and is not exposed to the web. So it is synthesised:
 * a short filtered noise burst, played twice ~70ms apart, which is the
 * mirror-up / mirror-down double-click of a mechanical focal-plane shutter.
 *
 * The AudioContext is created lazily and resumed on the first user gesture,
 * because iOS Safari starts contexts suspended and only allows resume from
 * inside a trusted event handler.
 */
function playShutter(ctx: AudioContext | null) {
  if (!ctx) return;

  const now = ctx.currentTime;

  for (const offset of [0, 0.07]) {
    const t = now + offset;

    // The "clack" body: a burst of noise through a bandpass, fast decay.
    const frames = Math.floor(ctx.sampleRate * 0.045);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Linear fade to zero gives the burst its percussive tail.
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400;
    band.Q.value = 0.9;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

    source.connect(band).connect(gain).connect(ctx.destination);
    source.start(t);
    source.stop(t + 0.05);
  }
}

export function CameraCapture({
  open,
  onClose,
  onCapture,
  busy,
  error,
  shots,
  uploading,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  /** Drives the white flash overlay for one beat after each shutter press. */
  const [flash, setFlash] = useState(false);

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
          video: {
            facingMode: { ideal: "environment" },
            // Ask for a 1080p-class frame: this is full-screen now, and the
            // grab crops to the visible region, so resolution drives print
            // quality of the catalog photo.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
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

  // Full-screen viewfinder: the page behind must not scroll or rubber-band
  // while the shutter is up, so the body is pinned for the duration.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  /**
   * Crops the grab to exactly the region the user framed.
   *
   * The preview is `object-cover`, so the visible rectangle is a centre-crop
   * of the sensor frame. Drawing the raw frame instead would save a photo
   * containing scenery the user never saw and cut off what they aimed at.
   */
  const grab = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setDetail("Camera is still starting. Wait a moment, then try again.");
      return;
    }

    // Shutter feel: sound and flash land on the same tick as the read.
    const audio = audioRef.current;
    if (audio) {
      void audio.resume().then(() => playShutter(audio)).catch(() => {});
    }
    setFlash(true);

    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const box = video.getBoundingClientRect();

      // object-cover scale: the larger of the two fit ratios.
      const scale = Math.max(box.width / vw, box.height / vh) || 1;
      const sourceWidth = box.width / scale;
      const sourceHeight = box.height / scale;
      const sourceX = (vw - sourceWidth) / 2;
      const sourceY = (vh - sourceHeight) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sourceWidth);
      canvas.height = Math.round(sourceHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setDetail("This browser cannot read the camera frame. Try again.");
        return;
      }
      ctx.drawImage(
        video,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
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

  // Any first touch unlocks audio for iOS, so the shutter is audible even on
  // the first photo rather than only from the second one onwards.
  const unlockAudio = () => {
    if (!audioRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      audioRef.current = new Ctor();
    }
    void audioRef.current.resume().catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Take a photo"
      onPointerDown={unlockAudio}
    >
      {live ? (
        <div className="relative h-[100dvh] w-full overflow-hidden">
          {/* Viewfinder: the whole screen, not a letterboxed card. */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
          />

          {/* Capture flash, mirroring a real shutter's white frame. */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-300 ${
              flash ? "opacity-90 duration-75" : "opacity-0"
            }`}
            onTransitionEnd={() => setFlash(false)}
          />

          {/* Top bar floats over the viewfinder. */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/55 to-transparent px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-8">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close camera"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-2xl leading-none font-light text-white backdrop-blur-sm active:scale-95"
            >
              ×
            </button>

            {/* Live count of this session, so the user knows what is banked. */}
            <span className="flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-sm">
              {shots > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] leading-none font-bold text-black">
                  {shots}
                </span>
              )}
              {shots === 0 ? "No photos yet" : uploading > 0 ? "Saving…" : "saved"}
            </span>
          </div>

          {/* Done: ends the session and returns to the catalog grid. Held
              disabled while an upload is in flight so a photo can never be
              dropped by closing on top of it. */}
          <div className="absolute inset-x-0 bottom-[max(6.5rem,calc(env(safe-area-inset-bottom)+5.5rem))] flex justify-center">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading > 0}
              className="rounded-full bg-white px-7 py-3 text-[15px] font-bold text-black shadow-lg transition-opacity active:opacity-70 disabled:opacity-50"
            >
              {uploading > 0
                ? "Saving…"
                : shots > 0
                  ? `Done (${shots})`
                  : "Done"}
            </button>
          </div>

          {/* Shutter cluster, modelled on a native camera app. */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-5 bg-gradient-to-t from-black/60 to-transparent px-7 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-12">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Choose from photos"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border-2 border-white/85 backdrop-blur-sm active:scale-95"
            >
              <CameraIcon className="h-5 w-5 text-white" />
            </button>

            <button
              type="button"
              onClick={grab}
              disabled={busy || !ready}
              aria-label={
                ready ? "Capture photo" : "Camera starting…"
              }
              className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full border-4 border-white/90 bg-white/20 backdrop-blur-sm transition-transform active:scale-90 disabled:opacity-50"
            >
              <span
                className={`block rounded-full bg-white transition-transform ${
                  ready ? "h-[58px] w-[58px]" : "h-[46px] w-[46px] opacity-60"
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              aria-label="Open device camera"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm active:scale-95"
            >
              <CameraIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Status and error sit above the Done button so they never
              overlap the controls while shooting a burst. */}
          {!ready && (
            <p className="absolute inset-x-0 bottom-[max(10.5rem,calc(env(safe-area-inset-bottom)+9.5rem))] text-center text-sm font-semibold text-white/85">
              Starting camera…
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="absolute inset-x-4 bottom-[max(10.5rem,calc(env(safe-area-inset-bottom)+9.5rem))] rounded-xl bg-brand/90 px-4 py-3 text-center text-sm font-medium text-white"
            >
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-black px-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
            <CameraIcon className="h-7 w-7 text-white/70" />
          </span>
          <p className="text-sm font-medium text-white/80">
            {failure ? FAILURE_TEXT[failure] : "Starting camera…"}
          </p>
          {detail && (
            <p className="max-w-xs text-xs font-medium break-words text-white/50">
              {detail}
            </p>
          )}

          <div className="mt-3 flex w-full max-w-xs flex-col gap-2.5">
            {/* capture makes a phone open its own Camera app; desktop ignores it. */}
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-[15px] font-semibold text-black transition-opacity active:opacity-70 disabled:opacity-50"
            >
              <CameraIcon className="h-5 w-5" />
              Open camera
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="rounded-lg border border-white/30 px-4 py-3 text-[15px] font-semibold text-white active:bg-white/10 disabled:opacity-50"
            >
              Choose a file
            </button>
            <p className="pt-1 text-center text-xs font-medium text-white/40">
              Photos are compressed to under 200KB
            </p>
          </div>
        </div>
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
  );
}
