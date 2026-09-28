"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function ShareQrModal({
  open,
  url,
  label,
  onClose,
}: {
  open: boolean;
  /** Full share URL encoded in the QR. */
  url: string;
  /** Owner label shown under the heading, e.g. the mobile number. */
  label: string;
  onClose: () => void;
}) {
  const [img, setImg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fresh state on every open: the parent remounts via `key`, so the
  // initial useState values are the reset. Never setState in this body.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    QRCode.toDataURL(url, { width: 512, margin: 2 })
      .then((dataUrl) => {
        if (!cancelled) setImg(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [open, url]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share catalog QR code"
    >
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] sm:max-w-sm sm:rounded-2xl sm:pb-0">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div>
            <h2 className="text-[17px] font-bold text-navy">Catalog QR</h2>
            <p className="text-[13px] font-medium text-navy/50">{label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-navy/60 hover:bg-canvas"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col items-center gap-4 px-6 py-6">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img}
              alt={`QR code for ${label}`}
              className="h-56 w-56 rounded-xl border border-card-border"
            />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-card-border bg-canvas">
              <p className="text-sm font-medium text-navy/50">
                {failed ? "Could not make the QR." : "Making QR…"}
              </p>
            </div>
          )}

          <p className="text-center text-[13px] font-medium text-navy/60">
            Customers scan this to browse the catalog. They can view only —
            no editing.
          </p>

          <div className="flex w-full gap-2.5">
            <a
              href={img ?? undefined}
              download={`tdagent-catalog-${label}.png`}
              aria-disabled={!img}
              onClick={(e) => {
                if (!img) e.preventDefault();
              }}
              className="flex flex-1 touch-manipulation items-center justify-center rounded-lg bg-accent-blue px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-blue-700 aria-disabled:opacity-50"
            >
              Download QR
            </a>
            <button
              type="button"
              onClick={copy}
              className="flex-1 rounded-lg border border-card-border px-4 py-3 text-[15px] font-semibold text-navy transition-colors hover:bg-canvas"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
