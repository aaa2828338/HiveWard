import type { ReactNode } from "react";
import { Link, Route, Routes } from "react-router";
import {
  getRouteGuardState,
  getRoutePath,
  routeRegistry,
  type AppRouteRecord,
  type RouteId
} from "./route-registry";

export type AppRoutesProps = {
  renderRoute: (routeId: RouteId) => ReactNode;
  selectedCompanyId?: string;
};

export function AppRoutes({ renderRoute, selectedCompanyId }: AppRoutesProps) {
  return (
    <Routes>
      {routeRegistry.map((route) => (
        <Route
          key={route.id}
          path={route.path}
          element={
            <RouteGuard route={route} selectedCompanyId={selectedCompanyId}>
              <RouteElement routeId={route.id} renderRoute={renderRoute} />
            </RouteGuard>
          }
        />
      ))}
      <Route path="*" element={<NotFoundRouteState />} />
    </Routes>
  );
}

function RouteElement({ routeId, renderRoute }: { routeId: RouteId; renderRoute: (routeId: RouteId) => ReactNode }) {
  return <>{renderRoute(routeId)}</>;
}

function RouteGuard({
  children,
  route,
  selectedCompanyId
}: {
  children: ReactNode;
  route: AppRouteRecord;
  selectedCompanyId?: string;
}) {
  if (getRouteGuardState(route, selectedCompanyId) === "requiresCompany") {
    return <CompanyRequiredRouteState route={route} />;
  }
  return <>{children}</>;
}

export function CompanyRequiredRouteState({ route }: { route: AppRouteRecord }) {
  return (
    <section className="route-state-panel" aria-label="Company required">
      <p className="eyebrow">Company required</p>
      <h1>Select a company to open this page</h1>
      <p>This route is available after a company is selected.</p>
      <Link className="primary-action" to={getRoutePath("companyDirectory")}>
        Choose company
      </Link>
      <span className="route-state-meta">{route.path}</span>
    </section>
  );
}

export function NotFoundRouteState() {
  return (
    <section className="route-state-panel" aria-label="Page not found">
      <p className="eyebrow">Not found</p>
      <h1>This page does not exist</h1>
      <p>The address does not match a HiveWard route.</p>
      <Link className="primary-action" to={getRoutePath("blueprint")}>
        Open Blueprint
      </Link>
    </section>
  );
}
