import type { ReactNode } from "react";

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

type PageHeaderProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  titleClassName?: string;
};

type PageBodyProps = {
  children: ReactNode;
  className?: string;
};

type StatusBadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

type StatusBadgeProps = {
  label: ReactNode;
  tone: StatusBadgeTone;
  className?: string;
};

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

type ErrorStateProps = EmptyStateProps;

export function PageShell({ children, className }: PageShellProps) {
  return <section className={cx("page-shell", className)}>{children}</section>;
}

export function PageHeader({ title, description, actions, children, className, titleClassName }: PageHeaderProps) {
  if (children) {
    return <header className={cx("page-header", className)}>{children}</header>;
  }

  return (
    <header className={cx("page-header", className)}>
      <div className={cx("page-header-copy", titleClassName)}>
        {title && <h2>{title}</h2>}
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function PageBody({ children, className }: PageBodyProps) {
  return <main className={cx("page-body", className)}>{children}</main>;
}

export function StatusBadge({ label, tone, className }: StatusBadgeProps) {
  const badgeClassName = cx("ui-status-badge", `ui-status-badge-${tone}`, className);
  return <span className={badgeClassName}>{label}</span>;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx("ui-empty-state", className)}>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, description, action, className }: ErrorStateProps) {
  return (
    <div className={cx("ui-error-state", className)} role="alert">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
