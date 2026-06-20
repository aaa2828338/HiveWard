import type { ReactNode } from "react";
import { ErrorState } from "../shared/ui";

export function AppLayout({
  children,
  error,
  importControl,
  sidebar
}: {
  children: ReactNode;
  error?: string;
  importControl: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <div className="app-shell">
      {sidebar}
      <section className="main-shell">
        {importControl}
        <section className={error ? "app-content-shell has-app-feedback" : "app-content-shell"}>
          {error && <ErrorState className="app-feedback-state" title={error} />}
          {children}
        </section>
      </section>
    </div>
  );
}
