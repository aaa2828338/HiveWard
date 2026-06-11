import type { ReactNode } from "react";

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
    <main className="app-shell">
      {sidebar}
      <section className="main-shell">
        {importControl}
        <section className="page-shell">
          {error && <div className="error-banner">{error}</div>}
          {children}
        </section>
      </section>
    </main>
  );
}
