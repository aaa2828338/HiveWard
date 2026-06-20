import type { ReactNode } from "react";
import { Link, Route, Routes } from "react-router";
import type { Language } from "../lib/i18n";
import { EmptyState, PageBody, PageHeader, PageShell } from "../shared/ui";
import {
  getRouteGuardState,
  getRoutePath,
  routeRegistry,
  type AppRouteRecord,
  type RouteId
} from "./route-registry";

export type AppRoutesProps = {
  language?: Language;
  renderRoute: (routeId: RouteId) => ReactNode;
  selectedCompanyId?: string;
};

export function AppRoutes({ language = "en", renderRoute, selectedCompanyId }: AppRoutesProps) {
  return (
    <Routes>
      {routeRegistry.map((route) => (
        <Route
          key={route.id}
          path={route.path}
          element={
            <RouteGuard language={language} route={route} selectedCompanyId={selectedCompanyId}>
              <RouteElement routeId={route.id} renderRoute={renderRoute} />
            </RouteGuard>
          }
        />
      ))}
      <Route path="*" element={<NotFoundRouteState language={language} />} />
    </Routes>
  );
}

function RouteElement({ routeId, renderRoute }: { routeId: RouteId; renderRoute: (routeId: RouteId) => ReactNode }) {
  return <>{renderRoute(routeId)}</>;
}

function RouteGuard({
  children,
  language,
  route,
  selectedCompanyId
}: {
  children: ReactNode;
  language: Language;
  route: AppRouteRecord;
  selectedCompanyId?: string;
}) {
  if (getRouteGuardState(route, selectedCompanyId) === "requiresCompany") {
    return <CompanyRequiredRouteState language={language} route={route} />;
  }
  return <>{children}</>;
}

export function CompanyRequiredRouteState({ language = "en", route }: { language?: Language; route: AppRouteRecord }) {
  const copy = getRouteStateCopy(language).companyRequired;
  return (
    <PageShell className="route-state-page" aria-label={copy.ariaLabel}>
      <PageHeader title={copy.header} description={route.path} />
      <PageBody className="route-state-body" aria-label={copy.ariaLabel}>
        <EmptyState
          title={copy.title}
          description={copy.description}
          action={<Link className="ui-button ui-button-primary route-state-action" to={getRoutePath("companyDirectory")}>{copy.action}</Link>}
        />
      </PageBody>
    </PageShell>
  );
}

export function NotFoundRouteState({ language = "en" }: { language?: Language }) {
  const copy = getRouteStateCopy(language).notFound;
  return (
    <PageShell className="route-state-page" aria-label={copy.ariaLabel}>
      <PageHeader title={copy.header} description={copy.headerDescription} />
      <PageBody className="route-state-body" aria-label={copy.ariaLabel}>
        <EmptyState
          title={copy.title}
          description={copy.description}
          action={<Link className="ui-button ui-button-primary route-state-action" to={getRoutePath("blueprint")}>{copy.action}</Link>}
        />
      </PageBody>
    </PageShell>
  );
}

function getRouteStateCopy(language: Language) {
  if (language === "zh-CN") {
    return {
      companyRequired: {
        action: "选择公司",
        ariaLabel: "需要公司",
        description: "选择公司后可以打开此路由。",
        header: "需要公司",
        title: "选择公司后打开此页面"
      },
      notFound: {
        action: "打开蓝图",
        ariaLabel: "页面不存在",
        description: "请改用一个有效的产品路由。",
        header: "未找到",
        headerDescription: "当前地址不匹配 HiveWard 路由。",
        title: "此页面不存在"
      }
    };
  }
  return {
    companyRequired: {
      action: "Choose company",
      ariaLabel: "Company required",
      description: "This route is available after a company is selected.",
      header: "Company required",
      title: "Select a company to open this page"
    },
    notFound: {
      action: "Open Blueprint",
      ariaLabel: "Page not found",
      description: "Use an active product route instead.",
      header: "Not found",
      headerDescription: "The address does not match a HiveWard route.",
      title: "This page does not exist"
    }
  };
}
