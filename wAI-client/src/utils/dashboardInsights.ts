export const fromPaise = (value: number) =>
  (value / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

export const formatMoney = (value: number) => `₹${fromPaise(value)}`;

export const getId = (value: any) => value?.$oid ?? value;

export const parseDate = (value: any) => {
  if (!value) return null;
  if (value?.$date?.$numberLong) return new Date(Number(value.$date.$numberLong));
  if (value?.$date) return new Date(value.$date);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const isActive = (item: any) => item?.is_active !== false;

export const isPaidStatus = (status: any) => {
  const normalized = String(status || "").toLowerCase();
  return ["paid", "settled", "completed", "received"].some((word) =>
    normalized.includes(word),
  );
};

export const isCancelledStatus = (status: any) => {
  const normalized = String(status || "").toLowerCase();
  return ["cancel", "void", "deleted"].some((word) =>
    normalized.includes(word),
  );
};

export function buildDashboardInsights({
  customers,
  invoices,
  inventory,
}: {
  customers: any[];
  invoices: any[];
  inventory: any[];
}) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const activeInvoices = invoices.filter(
    (invoice) => isActive(invoice) && !isCancelledStatus(invoice.status),
  );
  const unpaidInvoices = activeInvoices.filter(
    (invoice) => !isPaidStatus(invoice.status),
  );
  const overdueInvoices = unpaidInvoices.filter((invoice) => {
    const dueDate = parseDate(invoice.due_date);
    return dueDate ? dueDate < today : false;
  });

  const currentMonthInvoices = activeInvoices.filter((invoice) => {
    const createdAt = parseDate(invoice.created_at);
    return createdAt ? createdAt >= monthStart && createdAt <= today : false;
  });

  const revenue = currentMonthInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.grand_total || 0),
    0,
  );
  const pendingPayments = unpaidInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.grand_total || 0),
    0,
  );
  const overdueAmount = overdueInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.grand_total || 0),
    0,
  );

  const inventoryAlerts = inventory
    .filter(isActive)
    .filter((item) => {
      const stock = Number(item.total_sub_units || 0);
      const reorderLevel = Number(item.reorder_level ?? item.min_stock_level ?? 10);
      return stock <= reorderLevel;
    })
    .sort((a, b) => Number(a.total_sub_units || 0) - Number(b.total_sub_units || 0));

  const cashflowRiskScore =
    overdueAmount > 0 && pendingPayments > 0
      ? Math.min(100, Math.round((overdueAmount / pendingPayments) * 100))
      : overdueInvoices.length > 0
        ? 65
        : inventoryAlerts.length > 0
          ? 35
          : 12;

  const cashflowRisk =
    cashflowRiskScore >= 60
      ? "High"
      : cashflowRiskScore >= 30
        ? "Medium"
        : "Low";

  const customerMap = new Map(
    customers.map((customer) => [getId(customer._id), customer.name]),
  );

  const recentInvoiceActivities = activeInvoices.map((invoice) => {
    const customerName =
      customerMap.get(getId(invoice.customer_id)) || "Unknown customer";
    const createdAt = parseDate(invoice.created_at);
    return {
      date: createdAt,
      type: "Invoice",
      title:
        invoice.invoice_number ||
        `INV-${String(invoice.invoice_tnx_id || "").substring(0, 8)}`,
      detail: `${customerName} · ${formatMoney(Number(invoice.grand_total || 0))}`,
    };
  });

  const recentInventoryActivities = inventory
    .filter(isActive)
    .slice(0, 4)
    .map((item) => ({
      date: parseDate(item.updated_at) || parseDate(item.created_at),
      type: "Stock",
      title: item.code || item.name || "Inventory item",
      detail: `${item.name || "Item"} · ${item.total_sub_units || 0} ${item.sub_unit || "units"}`,
    }));

  const recentActivities = [...recentInvoiceActivities, ...recentInventoryActivities]
    .sort((a, b) => Number(b.date || 0) - Number(a.date || 0))
    .slice(0, 8);

  const alerts = [
    overdueInvoices.length > 0
      ? {
          severity: "High" as const,
          title: `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? "" : "s"}`,
          detail: `${formatMoney(overdueAmount)} stuck beyond due date`,
          action: "Prioritise collection calls and reconcile receipts today.",
        }
      : null,
    pendingPayments > revenue && pendingPayments > 0
      ? {
          severity: "Medium" as const,
          title: "Pending collections exceed monthly revenue",
          detail: `${formatMoney(pendingPayments)} pending against ${formatMoney(revenue)} revenue`,
          action: "Review credit terms before dispatching more material.",
        }
      : null,
    inventoryAlerts.length > 0
      ? {
          severity: inventoryAlerts.length > 3 ? ("High" as const) : ("Medium" as const),
          title: `${inventoryAlerts.length} inventory alert${inventoryAlerts.length === 1 ? "" : "s"}`,
          detail: `${inventoryAlerts[0]?.name || "Stock"} needs attention first`,
          action: "Check reorder quantities and open purchase follow-ups.",
        }
      : null,
  ].filter(Boolean);

  return {
    revenue,
    pendingPayments,
    overdueInvoices,
    overdueAmount,
    inventoryAlerts,
    cashflowRisk,
    cashflowRiskScore,
    recentActivities,
    alerts,
    activeInvoices,
    unpaidInvoices,
  };
}
