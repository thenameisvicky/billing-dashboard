import type { ReactElement } from "react";
import HomePage from "../pages/Home/home";
import CustomersPage from "../pages/Customers";
import InvoicesPage from "../pages/Invoices";
import ProductsPage from "../pages/Products";
import DashboardPage from "../pages/Dashboard";
import SettingsPage from "../pages/Settings";
import Gstr1Page from "../pages/Gstr1";

export type ModuleId = "factory" | "accounting" | "stock";

export interface ModuleRoute {
  id: string;
  label: string;
  module: ModuleId;
  component: () => ReactElement;
}

export const moduleRoutes: ModuleRoute[] = [
  { id: "Home", label: "Home", module: "factory", component: HomePage },
  { id: "Customers", label: "Customers", module: "accounting", component: CustomersPage },
  { id: "Invoices", label: "Invoices", module: "accounting", component: InvoicesPage },
  { id: "GSTR1", label: "GST / GSTR-1", module: "accounting", component: Gstr1Page },
  // Hidden for Bharath/Nile MVP launch; preserved for post-launch re-enable.
  { id: "Products", label: "Products", module: "stock", component: ProductsPage },
  // Hidden launch dashboard; Home is the operational MVP dashboard.
  { id: "Dashboard", label: "Dashboard", module: "factory", component: DashboardPage },
  { id: "Settings", label: "Settings", module: "factory", component: SettingsPage },
];

export const routeLabels = moduleRoutes
  .filter((route) => ["Home", "Customers", "Invoices", "GST / GSTR-1"].includes(route.label))
  .map((route) => route.label);

export function getModuleRoute(label: string) {
  return moduleRoutes.find((route) => route.label === label) ?? moduleRoutes[0];
}
