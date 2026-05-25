export function joinWorkspacePath(root: string, leaf: string): string {
  const separator = detectWorkspacePathSeparator(root);
  const base = trimTrailingPathSeparators(root.trim(), separator);
  const child = leaf.trim().replace(/^[\\/]+/, "");

  if (!base) return child;
  if (!child) return base;
  return base.endsWith(separator) ? `${base}${child}` : `${base}${separator}${child}`;
}

export function formatWorkspacePathPlaceholder(defaultWorkspace: string): string {
  return joinWorkspacePath(defaultWorkspace, "<agent-id>");
}

function detectWorkspacePathSeparator(root: string): "\\" | "/" {
  const trimmed = root.trim();
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return "\\";
  if (trimmed.includes("\\")) return "\\";
  return "/";
}

function trimTrailingPathSeparators(root: string, separator: "\\" | "/"): string {
  if (separator === "/" && /^\/+$/.test(root)) return "/";
  return root.replace(/[\\/]+$/, "");
}
