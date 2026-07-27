import { createContext, useContext, useCallback, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextValue {
  toast: (message: string, type?: Toast["type"]) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  return (
    <ToastContext value={{ toast }}>
      {children}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-slide-up px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium whitespace-nowrap ${
              t.type === "error"
                ? "bg-danger text-white"
                : t.type === "info"
                  ? "bg-accent-600 text-white"
                  : "bg-success text-white"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
