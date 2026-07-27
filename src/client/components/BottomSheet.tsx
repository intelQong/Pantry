import { type ReactNode, useEffect, useCallback, useRef, useState } from "react";

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
        onAnimationEnd={handleAnimEnd}
        className={`w-full max-w-lg max-h-[85dvh] bg-surface-raised rounded-t-xl shadow-xl overflow-hidden flex flex-col ${
          open ? "animate-slide-up" : "animate-slide-down"
        }`}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {title && (
          <div className="px-5 pb-3 pt-1">
            <h2 className="text-lg font-semibold text-text">{title}</h2>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-6 safe-bottom">
          {children}
        </div>
      </div>
    </div>
  );
}
