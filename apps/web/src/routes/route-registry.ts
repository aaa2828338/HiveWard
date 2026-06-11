import { harnessDisplayLabels } from "../lib/harness-labels";

export type RouteSystemId = "hiveward" | "codex" | "claudeCode" | "openclaw" | "hermes" | "google" | "cursor" | "opencode";

export type RouteId =
  | "hivewardHome"
  | "companyDirectory"
  | "company"
  | "chat"
  | "blueprint"
  | "runs"
  | "approvals"
  | "schedule"
  | "openclaw"
  | "models"
  | "agents"
  | "skills"
  | "channels"
  | "claudeCodeConfig"
  | "claudeCodeModels"
  | "codexConfig"
  | "googleConfig"
  | "cursorConfig"
  | "opencodeConfig"
  | "hermesConfig"
  | "hermesModels"
  | "hermesAgents"
  | "hermesSkills"
  | "hermesChannels";

export type RoutePath =
  | "/"
  | "/companies"
  | "/company"
  | "/chat"
  | "/blueprint"
  | "/runs"
  | "/approvals"
  | "/history"
  | "/openclaw"
  | "/openclaw/models"
  | "/openclaw/agents"
  | "/openclaw/skills"
  | "/openclaw/channels"
  | "/claude-code"
  | "/claude-code/models"
  | "/codex"
  | "/google"
  | "/cursor"
  | "/opencode"
  | "/hermes"
  | "/hermes/models"
  | "/hermes/agents"
  | "/hermes/skills"
  | "/hermes/channels";

export type RouteNavMetadata = {
  labelKey: RouteId;
  order: number;
};

export type AppRouteRecord = {
  id: RouteId;
  path: RoutePath;
  systemId: RouteSystemId;
  titleKey: RouteId;
  requiresCompany: boolean;
  nav?: RouteNavMetadata;
};

export type RouteGuardState = "available" | "requiresCompany";

export const routeSystemOrder = [
  "hiveward",
  "codex",
  "claudeCode",
  "openclaw",
  "hermes",
  "google",
  "cursor",
  "opencode"
] as const satisfies readonly RouteSystemId[];

export const routeSystemLabels = {
  hiveward: "Hiveward",
  ...harnessDisplayLabels
} satisfies Record<RouteSystemId, string>;

export const routeRegistry: readonly AppRouteRecord[] = [
  {
    id: "hivewardHome",
    path: "/",
    systemId: "hiveward",
    titleKey: "hivewardHome",
    requiresCompany: false
  },
  {
    id: "companyDirectory",
    path: "/companies",
    systemId: "hiveward",
    titleKey: "companyDirectory",
    requiresCompany: false
  },
  {
    id: "company",
    path: "/company",
    systemId: "hiveward",
    titleKey: "company",
    requiresCompany: true,
    nav: { labelKey: "company", order: 0 }
  },
  {
    id: "chat",
    path: "/chat",
    systemId: "hiveward",
    titleKey: "chat",
    requiresCompany: true,
    nav: { labelKey: "chat", order: 1 }
  },
  {
    id: "blueprint",
    path: "/blueprint",
    systemId: "hiveward",
    titleKey: "blueprint",
    requiresCompany: true,
    nav: { labelKey: "blueprint", order: 2 }
  },
  {
    id: "runs",
    path: "/runs",
    systemId: "hiveward",
    titleKey: "runs",
    requiresCompany: true,
    nav: { labelKey: "runs", order: 3 }
  },
  {
    id: "approvals",
    path: "/approvals",
    systemId: "hiveward",
    titleKey: "approvals",
    requiresCompany: true,
    nav: { labelKey: "approvals", order: 4 }
  },
  {
    id: "schedule",
    path: "/history",
    systemId: "hiveward",
    titleKey: "schedule",
    requiresCompany: true,
    nav: { labelKey: "schedule", order: 5 }
  },
  {
    id: "codexConfig",
    path: "/codex",
    systemId: "codex",
    titleKey: "codexConfig",
    requiresCompany: false,
    nav: { labelKey: "codexConfig", order: 0 }
  },
  {
    id: "claudeCodeConfig",
    path: "/claude-code",
    systemId: "claudeCode",
    titleKey: "claudeCodeConfig",
    requiresCompany: false,
    nav: { labelKey: "claudeCodeConfig", order: 0 }
  },
  {
    id: "claudeCodeModels",
    path: "/claude-code/models",
    systemId: "claudeCode",
    titleKey: "claudeCodeModels",
    requiresCompany: false,
    nav: { labelKey: "claudeCodeModels", order: 1 }
  },
  {
    id: "openclaw",
    path: "/openclaw",
    systemId: "openclaw",
    titleKey: "openclaw",
    requiresCompany: false,
    nav: { labelKey: "openclaw", order: 0 }
  },
  {
    id: "models",
    path: "/openclaw/models",
    systemId: "openclaw",
    titleKey: "models",
    requiresCompany: false,
    nav: { labelKey: "models", order: 1 }
  },
  {
    id: "agents",
    path: "/openclaw/agents",
    systemId: "openclaw",
    titleKey: "agents",
    requiresCompany: false,
    nav: { labelKey: "agents", order: 2 }
  },
  {
    id: "skills",
    path: "/openclaw/skills",
    systemId: "openclaw",
    titleKey: "skills",
    requiresCompany: false,
    nav: { labelKey: "skills", order: 3 }
  },
  {
    id: "channels",
    path: "/openclaw/channels",
    systemId: "openclaw",
    titleKey: "channels",
    requiresCompany: false,
    nav: { labelKey: "channels", order: 4 }
  },
  {
    id: "hermesConfig",
    path: "/hermes",
    systemId: "hermes",
    titleKey: "hermesConfig",
    requiresCompany: false,
    nav: { labelKey: "hermesConfig", order: 0 }
  },
  {
    id: "hermesModels",
    path: "/hermes/models",
    systemId: "hermes",
    titleKey: "hermesModels",
    requiresCompany: false,
    nav: { labelKey: "hermesModels", order: 1 }
  },
  {
    id: "hermesAgents",
    path: "/hermes/agents",
    systemId: "hermes",
    titleKey: "hermesAgents",
    requiresCompany: false,
    nav: { labelKey: "hermesAgents", order: 2 }
  },
  {
    id: "hermesSkills",
    path: "/hermes/skills",
    systemId: "hermes",
    titleKey: "hermesSkills",
    requiresCompany: false,
    nav: { labelKey: "hermesSkills", order: 3 }
  },
  {
    id: "hermesChannels",
    path: "/hermes/channels",
    systemId: "hermes",
    titleKey: "hermesChannels",
    requiresCompany: false,
    nav: { labelKey: "hermesChannels", order: 4 }
  },
  {
    id: "googleConfig",
    path: "/google",
    systemId: "google",
    titleKey: "googleConfig",
    requiresCompany: false,
    nav: { labelKey: "googleConfig", order: 0 }
  },
  {
    id: "cursorConfig",
    path: "/cursor",
    systemId: "cursor",
    titleKey: "cursorConfig",
    requiresCompany: false,
    nav: { labelKey: "cursorConfig", order: 0 }
  },
  {
    id: "opencodeConfig",
    path: "/opencode",
    systemId: "opencode",
    titleKey: "opencodeConfig",
    requiresCompany: false,
    nav: { labelKey: "opencodeConfig", order: 0 }
  }
];

export const routePathById = Object.fromEntries(routeRegistry.map((route) => [route.id, route.path])) as Record<RouteId, RoutePath>;

const routeRecordById = Object.fromEntries(routeRegistry.map((route) => [route.id, route])) as Record<RouteId, AppRouteRecord>;

export const routeNavigationGroups = routeSystemOrder.map((systemId) => ({
  systemId,
  routes: routeRegistry
    .filter((route) => route.systemId === systemId && route.nav)
    .sort((left, right) => left.nav!.order - right.nav!.order)
}));

export function getRouteById(routeId: RouteId): AppRouteRecord {
  return routeRecordById[routeId];
}

export function getRoutePath(routeId: RouteId): RoutePath {
  return routePathById[routeId];
}

export function getRouteByPathname(pathname: string): AppRouteRecord | undefined {
  return routeRegistry.find((route) => route.path === pathname);
}

export function getRouteGuardState(route: AppRouteRecord, selectedCompanyId: string | undefined): RouteGuardState {
  if (route.requiresCompany && !selectedCompanyId) return "requiresCompany";
  return "available";
}
