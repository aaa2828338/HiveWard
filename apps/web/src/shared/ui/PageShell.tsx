import {
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes
} from "react";
import { X } from "lucide-react";

type PageShellProps = {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLElement>;

type CanvasPageShellProps = PageShellProps;

type PageHeaderProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  className?: string;
  titleClassName?: string;
};

type PageBodyProps = {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLElement>;

export type StatusBadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

type StatusBadgeProps = {
  label: ReactNode;
  tone: StatusBadgeTone;
  className?: string;
};

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

type ErrorStateProps = EmptyStateProps;

type LoadingStateProps = Omit<EmptyStateProps, "action">;

type UiButtonVariant = "default" | "primary" | "danger" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: UiButtonVariant;
  icon?: ReactNode;
  busy?: boolean;
};

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  icon: ReactNode;
  label: string;
  tooltip?: string;
  variant?: UiButtonVariant;
};

type ActionClusterProps = HTMLAttributes<HTMLDivElement> & {
  align?: "start" | "end" | "between";
  wrap?: boolean;
};

type SectionHeaderProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
};

type SurfaceProps = HTMLAttributes<HTMLDivElement>;

type FormFieldProps = HTMLAttributes<HTMLLabelElement> & {
  label: ReactNode;
  description?: ReactNode;
  compact?: boolean;
};

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;
type SelectControlProps = SelectHTMLAttributes<HTMLSelectElement>;

type DialogProps = {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  closeLabel: string;
  className?: string;
  onClose: () => void;
};

type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  busy?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

type TooltipProps = {
  children: ReactNode;
  label: ReactNode;
  className?: string;
};

type TabOption<TValue extends string> = {
  value: TValue;
  label: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
};

type TabsProps<TValue extends string> = {
  label: string;
  value: TValue;
  options: ReadonlyArray<TabOption<TValue>>;
  className?: string;
  onChange: (value: TValue) => void;
};

type ListboxOption<TValue extends string> = {
  value: TValue;
  label: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
};

type ListboxProps<TValue extends string> = {
  label: string;
  value?: TValue;
  options: ReadonlyArray<ListboxOption<TValue>>;
  className?: string;
  onChange: (value: TValue) => void;
};

type SelectMenuProps<TValue extends string> = {
  label: string;
  value: TValue;
  options: ReadonlyArray<ListboxOption<TValue>>;
  className?: string;
  onChange: (value: TValue) => void;
};

export function PageShell({ children, className, ...props }: PageShellProps) {
  return <section className={cx("page-shell", className)} {...props}>{children}</section>;
}

export function CanvasPageShell({ children, className, ...props }: CanvasPageShellProps) {
  return <section className={cx("canvas-page-shell", className)} {...props}>{children}</section>;
}

export function PageHeader({ title, description, actions, leading, className, titleClassName }: PageHeaderProps) {
  return (
    <header className={cx("page-header", className)}>
      <div className="page-header-main">
        {leading && <span className="page-header-leading" aria-hidden="true">{leading}</span>}
        <div className={cx("page-header-copy", titleClassName)}>
          {title && <h2>{title}</h2>}
          {description && <p>{description}</p>}
        </div>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function PageBody({ children, className, ...props }: PageBodyProps) {
  return <main className={cx("page-body", className)} {...props}>{children}</main>;
}

export function PageActions({ align = "end", wrap = true, className, children, ...props }: ActionClusterProps) {
  return (
    <div className={cx("ui-action-cluster", `ui-action-cluster-${align}`, wrap && "ui-action-cluster-wrap", className)} {...props}>
      {children}
    </div>
  );
}

export function Button({ variant = "default", icon, busy = false, className, children, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cx("ui-button", `ui-button-${variant}`, busy && "is-busy", className)} {...props}>
      {icon && <span className="ui-button-icon" aria-hidden="true">{icon}</span>}
      {children && <span className="ui-button-label">{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, tooltip, variant = "ghost", className, type = "button", ...props }: IconButtonProps) {
  if (!label.trim()) {
    throw new Error("IconButton requires a non-empty accessible label.");
  }
  return (
    <button
      type={type}
      className={cx("ui-icon-button", `ui-icon-button-${variant}`, className)}
      aria-label={label}
      title={tooltip ?? label}
      {...props}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

export function Card({ className, children, ...props }: SurfaceProps) {
  return <section className={cx("ui-card", className)} {...props}>{children}</section>;
}

export function CardHeader({ title, description, eyebrow, actions, titleId, className, children, ...props }: SectionHeaderProps) {
  return (
    <div className={cx("ui-card-header", className)} {...props}>
      <div className="ui-section-copy">
        {eyebrow && <span className="ui-section-eyebrow">{eyebrow}</span>}
        <h3 id={titleId}>{title}</h3>
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className="ui-section-actions">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children, ...props }: SurfaceProps) {
  return <div className={cx("ui-card-body", className)} {...props}>{children}</div>;
}

export function Panel({ className, children, ...props }: SurfaceProps) {
  return <section className={cx("ui-panel", className)} {...props}>{children}</section>;
}

export function PanelHeader({ title, description, eyebrow, actions, titleId, className, children, ...props }: SectionHeaderProps) {
  return (
    <div className={cx("ui-panel-header", className)} {...props}>
      <div className="ui-section-copy">
        {eyebrow && <span className="ui-section-eyebrow">{eyebrow}</span>}
        <h3 id={titleId}>{title}</h3>
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className="ui-section-actions">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, children, ...props }: SurfaceProps) {
  return <div className={cx("ui-panel-body", className)} {...props}>{children}</div>;
}

export function Toolbar({ align = "end", wrap = true, className, children, ...props }: ActionClusterProps) {
  return (
    <div className={cx("ui-toolbar", `ui-toolbar-${align}`, wrap && "ui-toolbar-wrap", className)} {...props}>
      {children}
    </div>
  );
}

export function FilterBar({ align = "end", wrap = true, className, children, ...props }: ActionClusterProps) {
  return (
    <div className={cx("ui-filter-bar", `ui-filter-bar-${align}`, wrap && "ui-filter-bar-wrap", className)} {...props}>
      {children}
    </div>
  );
}

export function FormField({ label, description, compact = false, className, children, ...props }: FormFieldProps) {
  return (
    <label className={cx("ui-form-field", compact && "ui-form-field-compact", className)} {...props}>
      <span className="ui-form-field-label">{label}</span>
      {children}
      {description && <small className="ui-form-field-description">{description}</small>}
    </label>
  );
}

export function TextInput({ className, ...props }: TextInputProps) {
  return <input className={cx("ui-control", className)} {...props} />;
}

export function SelectControl({ className, children, ...props }: SelectControlProps) {
  return <select className={cx("ui-control", className)} {...props}>{children}</select>;
}

export function StatusBadge({ label, tone, className }: StatusBadgeProps) {
  const badgeClassName = cx("ui-status-badge", `ui-status-badge-${tone}`, className);
  return <span className={badgeClassName}>{label}</span>;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cx("ui-empty-state", className)}>
      {icon && <span className="ui-state-icon" aria-hidden="true">{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, description, action, icon, className }: ErrorStateProps) {
  return (
    <div className={cx("ui-error-state", className)} role="alert">
      {icon && <span className="ui-state-icon" aria-hidden="true">{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function LoadingState({ title, description, icon, className }: LoadingStateProps) {
  return (
    <div className={cx("ui-loading-state", className)} role="status" aria-live="polite">
      {icon && <span className="ui-state-icon" aria-hidden="true">{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function StateBoundary({
  state,
  loading,
  empty,
  error,
  children
}: {
  state: "loading" | "empty" | "error" | "success";
  loading: LoadingStateProps;
  empty: EmptyStateProps;
  error: ErrorStateProps;
  children: ReactNode;
}) {
  if (state === "loading") return <LoadingState {...loading} />;
  if (state === "empty") return <EmptyState {...empty} />;
  if (state === "error") return <ErrorState {...error} />;
  return <>{children}</>;
}

export function Dialog({ open, title, description, children, actions, closeLabel, className, onClose }: DialogProps) {
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="ui-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={cx("ui-dialog", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <PanelHeader
          title={title}
          titleId={titleId}
          description={description}
          actions={<IconButton icon={<X size={16} />} label={closeLabel} onClick={onClose} />}
        />
        {children && <PanelBody>{children}</PanelBody>}
        {actions && <div className="ui-dialog-actions">{actions}</div>}
      </section>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy = false,
  destructive = false,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description={body}
      closeLabel={String(cancelLabel)}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
        </>
      }
    />
  );
}

export function Tooltip({ children, label, className }: TooltipProps) {
  const tooltipId = useId();
  return (
    <span className={cx("ui-tooltip", className)} aria-describedby={tooltipId}>
      {children}
      <span id={tooltipId} className="ui-tooltip-bubble" role="tooltip">{label}</span>
    </span>
  );
}

export function Tabs<TValue extends string>({ label, value, options, className, onChange }: TabsProps<TValue>) {
  return (
    <div className={cx("ui-tabs", className)} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          disabled={option.disabled}
          className={cx("ui-tab", option.value === value && "selected")}
          onClick={() => onChange(option.value)}
        >
          <span>{option.label}</span>
          {option.badge && <small>{option.badge}</small>}
        </button>
      ))}
    </div>
  );
}

export function Listbox<TValue extends string>({ label, value, options, className, onChange }: ListboxProps<TValue>) {
  return (
    <div className={cx("ui-listbox", className)} role="listbox" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          disabled={option.disabled}
          className={cx("ui-listbox-option", option.value === value && "selected")}
          onClick={() => onChange(option.value)}
        >
          <span className="ui-listbox-option-main">
            <strong>{option.label}</strong>
            {option.description && <span>{option.description}</span>}
          </span>
          {option.meta && <span className="ui-listbox-option-meta">{option.meta}</span>}
        </button>
      ))}
    </div>
  );
}

export function SelectMenu<TValue extends string>({ label, value, options, className, onChange }: SelectMenuProps<TValue>) {
  return (
    <FormField label={label} className={className}>
      <SelectControl value={value} onChange={(event) => onChange(event.currentTarget.value as TValue)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </SelectControl>
    </FormField>
  );
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
