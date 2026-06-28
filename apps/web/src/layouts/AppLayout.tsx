import type { ReactNode } from "react";
import { X } from "lucide-react";
import { ErrorState } from "../shared/ui";

export function AppLayout({
  children,
  error,
  importControl,
  sidebar,
  onErrorDismiss
}: {
  children: ReactNode;
  error?: string;
  importControl: ReactNode;
  sidebar: ReactNode;
  onErrorDismiss?: () => void;
}) {
  return (
    <div className="app-shell">
      {sidebar}
      <section className="main-shell">
        {importControl}
        <section className={error ? "app-content-shell has-app-feedback" : "app-content-shell"}>
          {error && (
            <div className="app-feedback-state-wrapper">
              <ErrorState className="app-feedback-state" title={error} />
              {onErrorDismiss && (
                <button
                  type="button"
                  className="app-feedback-dismiss"
                  onClick={onErrorDismiss}
                  title="关闭"
                  aria-label="关闭错误提示"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          {children}
        </section>
      </section>
    </div>
  );
}
