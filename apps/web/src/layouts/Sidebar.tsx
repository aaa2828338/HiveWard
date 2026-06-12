import type { RefObject } from "react";
import {
  Bot,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  Inbox,
  Languages,
  LayoutTemplate,
  ListChecks,
  MessageSquareText,
  Monitor,
  Moon,
  Puzzle,
  Radio,
  Settings,
  Sun
} from "lucide-react";
import { NavLink, useLocation } from "react-router";
import { HarnessLabel } from "../components/HarnessLabel";
import { harnessDisplayParts, isHarnessId } from "../lib/harness-labels";
import {
  getRoutePath,
  routeNavigationGroups,
  routeSystemLabels,
  type RouteId,
  type RouteSystemId
} from "../routes/route-registry";

const sidebarIcons: Partial<Record<RouteId, typeof Building2>> = {
  company: Building2,
  chat: MessageSquareText,
  blueprint: LayoutTemplate,
  runs: ListChecks,
  approvals: Inbox,
  monitor: Monitor,
  models: Database,
  agents: Bot,
  openclaw: Settings,
  skills: Puzzle,
  channels: Radio,
  claudeCodeConfig: Settings,
  claudeCodeModels: Database,
  codexConfig: Settings,
  googleConfig: Settings,
  cursorConfig: Settings,
  opencodeConfig: Settings,
  hermesConfig: Settings,
  hermesModels: Database,
  hermesAgents: Bot,
  hermesSkills: Puzzle,
  hermesChannels: Radio
};

export type SidebarProps = {
  activityMeta: Partial<Record<RouteId, number>>;
  companySwitcherLabel: string;
  dashboardDirty: boolean;
  dirtyWorkspaceLabel: string;
  expandedSystems: Record<RouteSystemId, boolean>;
  hivewardUpdateBadge: string;
  hivewardUpdateAvailable: boolean;
  hivewardVersionLabel: string;
  hivewardVersionTitle: string;
  language: "en" | "zh-CN";
  languageSwitchTitle: string;
  navigationLabels: Record<string, string | undefined>;
  selectedCompanyLogoLabel?: string;
  selectedCompanyLogoUrl?: string;
  selectedCompanyName?: string;
  systemMenuOpen: boolean;
  systemMenuRef: RefObject<HTMLDivElement | null>;
  systemUi: {
    language: string;
    settings: string;
    theme: string;
    title: string;
  };
  theme: "light" | "dark";
  themeToggleLabel: string;
  themeToggleTitle: string;
  onCheckHivewardUpdate: () => void;
  onCloseSystemMenu: () => void;
  onToggleLanguage: () => void;
  onToggleSystemGroup: (systemId: RouteSystemId) => void;
  onToggleSystemMenu: () => void;
  onToggleTheme: () => void;
};

export function Sidebar({
  activityMeta,
  companySwitcherLabel,
  dashboardDirty,
  dirtyWorkspaceLabel,
  expandedSystems,
  hivewardUpdateBadge,
  hivewardUpdateAvailable,
  hivewardVersionLabel,
  hivewardVersionTitle,
  language,
  languageSwitchTitle,
  navigationLabels,
  selectedCompanyLogoLabel,
  selectedCompanyLogoUrl,
  selectedCompanyName,
  systemMenuOpen,
  systemMenuRef,
  systemUi,
  theme,
  themeToggleLabel,
  themeToggleTitle,
  onCheckHivewardUpdate,
  onCloseSystemMenu,
  onToggleLanguage,
  onToggleSystemGroup,
  onToggleSystemMenu,
  onToggleTheme
}: SidebarProps) {
  const companyLabel = selectedCompanyName ?? companySwitcherLabel;
  const location = useLocation();

  return (
    <aside className="sidebar-shell">
      <div className="sidebar-brand">
        <div className="brand-mark">
          <img src="/brand/hiveward-hive.png" alt="" />
        </div>
        <div>
          <img
            className="brand-wordmark"
            src={theme === "dark" ? "/brand/hiveward-wordmark-on-dark.png" : "/brand/hiveward-wordmark.png"}
            alt="Hiveward"
          />
        </div>
      </div>
      <nav className="sidebar-nav">
        {routeNavigationGroups.map((group) => {
          const groupActive = group.routes.some((route) => route.path === location.pathname);
          const expanded = expandedSystems[group.systemId] || groupActive;
          const groupActivityCount = group.routes.reduce((count, route) => count + (activityMeta[route.id] ?? 0), 0);
          const groupHasHiddenActivity = !expanded && groupActivityCount > 0;
          const systemChildrenId = `sidebar-system-${group.systemId}`;
          const SystemChevron = expanded ? ChevronDown : ChevronRight;
          return (
            <section key={group.systemId} className={`nav-system-group ${groupActive ? "active" : ""}`}>
              <button
                type="button"
                className={`nav-system-toggle ${groupActive ? "active" : ""} ${groupHasHiddenActivity ? "has-activity" : ""}`}
                aria-expanded={expanded}
                aria-controls={group.routes.length > 0 ? systemChildrenId : undefined}
                onClick={() => onToggleSystemGroup(group.systemId)}
              >
                <span className="nav-system-main">
                  <SystemChevron size={14} />
                  <AppSystemLabel systemId={group.systemId} />
                </span>
                {groupHasHiddenActivity && <span className="nav-count nav-system-count">{groupActivityCount}</span>}
              </button>
              {expanded && group.routes.length > 0 && (
                <div id={systemChildrenId} className="nav-system-children">
                  {group.routes.map((route) => {
                    const Icon = sidebarIcons[route.id] ?? Settings;
                    const activityCount = activityMeta[route.id] ?? 0;
                    const hasActivity = activityCount > 0;
                    return (
                      <NavLink
                        key={route.id}
                        to={route.path}
                        end
                        className={({ isActive }) =>
                          `nav-item ${isActive ? "active" : ""} ${hasActivity ? "has-activity" : ""}`.trim()
                        }
                        onClick={onCloseSystemMenu}
                      >
                        <span className="nav-item-main">
                          <Icon size={16} />
                          <span className="nav-item-label">{navigationLabels[route.nav?.labelKey ?? route.id] ?? route.id}</span>
                        </span>
                        {hasActivity && <span className="nav-count">{activityCount}</span>}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </nav>
      <div className="sidebar-status">
        {dashboardDirty && <span className="status-badge">{dirtyWorkspaceLabel}</span>}
        <div className="sidebar-system" ref={systemMenuRef}>
          <div className="sidebar-company">
            <NavLink
              className={({ isActive }) => `company-switcher sidebar-company-switcher ${isActive ? "active" : ""}`.trim()}
              title={companyLabel}
              to={getRoutePath("companyDirectory")}
              onClick={onCloseSystemMenu}
            >
              <span className="company-switcher-avatar">
                {selectedCompanyLogoUrl ? (
                  <img src={selectedCompanyLogoUrl} alt={companyLabel} />
                ) : (
                  <span>{companyMonogram({ logoLabel: selectedCompanyLogoLabel, name: selectedCompanyName })}</span>
                )}
              </span>
              <span className="company-switcher-copy">
                <strong>{companyLabel}</strong>
              </span>
              <ChevronRight size={16} />
            </NavLink>
          </div>
          <div className="sidebar-system-control">
            <button
              type="button"
              className={`sidebar-system-version ${hivewardUpdateAvailable ? "update-available" : "online"}`}
              aria-label={hivewardVersionTitle}
              title={hivewardVersionTitle}
              onClick={() => {
                onCloseSystemMenu();
                onCheckHivewardUpdate();
              }}
            >
              <span className="sidebar-system-dot" aria-hidden="true" />
              <strong>{hivewardVersionLabel}</strong>
              {hivewardUpdateAvailable && <span className="sidebar-system-update-badge">{hivewardUpdateBadge}</span>}
            </button>
            <button
              type="button"
              className={`sidebar-system-settings ${systemMenuOpen ? "active" : ""}`}
              title={systemUi.settings}
              aria-label={systemUi.settings}
              aria-expanded={systemMenuOpen}
              onClick={onToggleSystemMenu}
            >
              <Settings size={14} />
            </button>
            {systemMenuOpen && (
              <div className="sidebar-system-menu" aria-label={systemUi.title}>
                <button type="button" title={themeToggleTitle} aria-label={themeToggleTitle} onClick={onToggleTheme}>
                  {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                  <span>{systemUi.theme}</span>
                  <strong>{themeToggleLabel}</strong>
                </button>
                <button type="button" title={languageSwitchTitle} aria-label={languageSwitchTitle} onClick={onToggleLanguage}>
                  <Languages size={14} />
                  <span>{systemUi.language}</span>
                  <strong>{language === "zh-CN" ? "ZH" : "EN"}</strong>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function AppSystemLabel({ systemId }: { systemId: RouteSystemId }) {
  if (isHarnessId(systemId)) {
    return <HarnessLabel {...harnessDisplayParts(systemId)} className="nav-system-label" />;
  }
  return <span className="nav-system-label">{routeSystemLabels[systemId]}</span>;
}

function companyMonogram(company?: { logoLabel?: string; name?: string }): string {
  if (company?.logoLabel?.trim()) return company.logoLabel.trim().slice(0, 2).toUpperCase();
  if (company?.name?.trim()) {
    const parts = company.name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return parts
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase();
  }
  return "CO";
}
