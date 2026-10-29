import { moduleRoutes } from "../../modules/registry";
import type { TopNavAction } from "./actions";

export type QuickAddItem = {
  label: string;
  action: TopNavAction;
  page: string;
  enabled: boolean;
  note?: string;
};

export type QuickAddGroup = {
  label: string;
  items: QuickAddItem[];
};

export const routeBreadcrumbs: Record<string, [string, string?]> = {
  Home: ["Home"],
  Customers: ["Sales", "Customers"],
  Invoices: ["Sales", "Invoices"],
  "GST / GSTR-1": ["Compliance", "GST / GSTR-1"],
  Products: ["Inventory", "Products"],
  Dashboard: ["Analytics", "Dashboard"],
  Settings: ["Settings"],
};

export const navigationCommands = moduleRoutes
  .filter((route) => ["Home", "Customers", "Invoices", "GST / GSTR-1", "Settings"].includes(route.label))
  .map((route) => ({
  id: `nav-${route.label}`,
  category: "Navigation",
  title: `Go to ${route.label}`,
  subtitle: route.module,
  page: route.label,
}));

// Hidden for MVP: Products, inventory adjustments, warehouses, extra dashboards,
// reports, purchases, advanced settings, and experimental AI workflows.
export const inventoryCommands = [
  {
    id: "action-add-stock",
    category: "Inventory actions",
    title: "Add Stock",
    subtitle: "Coming soon",
    page: "Products",
    action: "add-stock" as TopNavAction,
    disabled: true,
  },
  {
    id: "action-adjust-stock",
    category: "Inventory actions",
    title: "Adjust Stock",
    subtitle: "Coming soon",
    page: "Products",
    action: "adjust-stock" as TopNavAction,
    disabled: true,
  },
  {
    id: "action-low-stock",
    category: "Inventory actions",
    title: "View Low Stock",
    subtitle: "Products below reorder level",
    page: "Products",
    action: "view-low-stock" as TopNavAction,
  },
  {
    id: "action-gstr1",
    category: "Inventory actions",
    title: "Prepare GSTR-1",
    subtitle: "Open GST / GSTR-1 workspace",
    page: "GST / GSTR-1",
    action: "prepare-gstr1" as TopNavAction,
  },
];

export const createCommands = [
  {
    id: "create-customer",
    category: "Navigation",
    title: "Create Customer",
    subtitle: "Open customer form",
    page: "Customers",
    action: "create-customer" as TopNavAction,
  },
  {
    id: "create-product",
    category: "Navigation",
    title: "Create Product",
    subtitle: "Open product form",
    page: "Products",
    action: "create-product" as TopNavAction,
    disabled: true,
  },
  {
    id: "create-invoice",
    category: "Navigation",
    title: "Create Invoice",
    subtitle: "Open invoice form",
    page: "Invoices",
    action: "create-invoice" as TopNavAction,
  },
];

export const quickAddGroups: QuickAddGroup[] = [
  {
    label: "General",
    items: [
      { label: "Customer", action: "create-customer", page: "Customers", enabled: true },
      { label: "Product", action: "create-product", page: "Products", enabled: false, note: "Hidden for MVP" },
      {
        label: "Warehouse",
        action: "add-stock",
        page: "Products",
        enabled: false,
        note: "Coming soon",
      },
    ],
  },
  {
    label: "Inventory",
    items: [
      {
        label: "Add Stock",
        action: "add-stock",
        page: "Products",
        enabled: false,
        note: "Coming soon",
      },
      {
        label: "Adjust Stock",
        action: "adjust-stock",
        page: "Products",
        enabled: false,
        note: "Coming soon",
      },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Invoice", action: "create-invoice", page: "Invoices", enabled: true },
    ],
  },
  {
    label: "Compliance",
    items: [
      {
        label: "Prepare GSTR-1",
        action: "prepare-gstr1",
        page: "GST / GSTR-1",
        enabled: true,
      },
    ],
  },
];
