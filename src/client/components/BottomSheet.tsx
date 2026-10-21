import { type ReactNode, useEffect, useCallback, useId, useRef, useState } from "react";

/** How far the sheet must be pulled down before letting go dismisses it. */
const DISMISS_DISTANCE = 100;

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  const titleId = useId();

  // The handle promises the sheet can be pulled down, as every iOS sheet can.
  // Only the handle and title start a drag, so scrolling the body never does.
  const onDragStart = useCallback((e: React.PointerEvent) => {
    dragStart.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (dragStart.current !== null) setDragY(Math.max(0, e.clientY - dragStart.current));
  }, []);
  const onDragEnd = useCallback(() => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (dragY > DISMISS_DISTANCE) onClose();
    setDragY(0);
  }, [dragY, onClose]);

  useEffect(() => {
    if (open) {
      setVisible(true);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleAnimEnd = useCallback(() => {
    if (!open) setVisible(false);
  }, [open]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!visible && !open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className={`fixed inset-0 z-50 flex items-end justify-center ${
        open ? "animate-fade-in" : "animate-fade-out"
      }`}
      style={{ backgroundColor: "oklch(0 0 0 / 0.4)" }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        onAnimationEnd={handleAnimEnd}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragStart.current === null ? "transform 0.25s var(--ease-smooth)" : "none",
        }}
        className={`w-full max-w-lg max-h-[85dvh] bg-surface-raised rounded-t-xl shadow-xl overflow-hidden flex flex-col ${
          open ? "animate-slide-up" : "animate-slide-down"
        }`}
      >
        <div
          className="touch-none cursor-grab"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-border" />
          </div>

          {title && (
            <div className="px-5 pb-3 pt-1">
              <h2 id={titleId} className="font-display text-lg font-semibold text-text">{title}</h2>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6 safe-bottom">
          {children}
        </div>
      </div>
    </div>
  );
}
