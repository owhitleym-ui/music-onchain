"use client";

// Dialog and toast from TJ's design (same markup and classes), as React components.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Accessible modal dialog: closes on Escape or a backdrop click, traps Tab inside,
 * locks page scroll, and returns focus to whatever opened it.
 */
export function Modal(props: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  /** While a transaction is in flight, don't let Escape/backdrop close the dialog. */
  locked?: boolean;
  children: ReactNode;
}) {
  const { title, onClose, footer, wide, locked, children } = props;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked) onClose();
      if (event.key !== "Tab" || !ref.current) return;
      const controls = [...ref.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled])")];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, locked]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !locked && onClose()}>
      <section ref={ref} className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1}>
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" onClick={onClose} disabled={locked} aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </section>
    </div>
  );
}

/** Label/value rows used in every dialog ("Your guess · 1,250,000 views"). */
export function DetailRows({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="detail-list">
      {rows.map(([label, value], i) => (
        <div key={i}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- Toasts ------------------------------------------------------------------------------

type Toast = { id: number; message: string };
const ToastContext = createContext<(message: string) => void>(() => {});

/** `const toast = useToast(); toast("Entry recorded")` - disappears after 4.5s like TJ's. */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { id, message }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span className="toast-icon">
              <Icon name="check" />
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name="music" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
