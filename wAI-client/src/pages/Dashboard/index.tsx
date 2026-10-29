import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "../../utils/axios";
import type { ReactNode } from "react";
import {
  buildDashboardInsights,
  formatMoney,
  getId,
  parseDate,
} from "../../utils/dashboardInsights";

function MetricTile({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "slate" | "emerald" | "amber" | "rose";
}) {
  const toneClass = {
    slate: "border-slate-200 bg-white text-slate-900",
    emerald: "border-emerald-200 bg-emerald-50/60 text-emerald-800",
    amber: "border-amber-200 bg-amber-50/70 text-amber-800",
    rose: "border-rose-200 bg-rose-50/70 text-rose-800",
  }[tone];

  return (
    <div className={`border px-3 py-2 shadow-sm ${toneClass}`}>
      <div className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">
        {label}
      </div>
      <div className="mt-2 text-[22px] font-bold leading-none">{value}</div>
      <div className="mt-2 truncate text-[16px] font-semibold text-slate-700">
        {detail}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex h-full min-h-0 flex-col border border-slate-200 bg-white shadow-sm ${className}`}
    >
      <div className="flex h-10 items-center justify-between border-b border-slate-200 bg-slate-50 px-4">
        <h3 className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">
          {title}
        </h3>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

function AlertRow({
  severity,
  title,
  detail,
  action,
}: {
  severity: "High" | "Medium" | "Low";
  title: string;
  detail: string;
  action: string;
}) {
  const severityClass = {
    High: "border-rose-200 bg-rose-50 text-rose-700",
    Medium: "border-amber-200 bg-amber-50 text-amber-700",
    Low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  }[severity];

  return (
    <div className="grid grid-cols-[82px_1fr] gap-3 border-b border-slate-300 px-3 py-2 last:border-b-0">
      <span
        className={`mt-0.5 inline-flex h-6 items-center justify-center rounded border text-[16px] font-bold ${severityClass}`}
      >
        {severity}
      </span>
      <div className="min-w-0">
        <div className="text-[16px] font-bold text-slate-900">{title}</div>
        <div className="mt-0.5 text-[16px] font-semibold text-slate-700">
          {detail}
        </div>
        <div className="mt-1 text-[16px] font-bold text-slate-700">
          {action}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-4 text-center">
      <p className="text-[16px] font-bold uppercase tracking-[0.12em] text-slate-400 opacity-70">
        {label}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const fetchDashboardData = useCallback(async () => {
    try {
      const [customersResponse, invoicesResponse, inventoryResponse] =
        await Promise.all([
          axios.get("/api/main/customers"),
          axios.get("/api/main/invoice"),
          axios.get("/api/main/inventory/items"),
        ]);

      const customersData = customersResponse.data;
      const invoicesData = invoicesResponse.data;
      const inventoryData = inventoryResponse.data;

      if (
        customersData?.status === "success" &&
        Array.isArray(customersData.data)
      )
        setCustomers(customersData.data);
      if (invoicesData?.status === "success" && Array.isArray(invoicesData.data))
        setInvoices(invoicesData.data);
      if (
        inventoryData?.status === "success" &&
        Array.isArray(inventoryData.data)
      )
        setInventory(inventoryData.data);
    } catch (error) {
      console.error("Failed to fetch dashboard data", error);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const dashboard = useMemo(
    () => buildDashboardInsights({ customers, invoices, inventory }),
    [customers, inventory, invoices],
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1.25fr)_minmax(0,1fr)] gap-3 overflow-hidden">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricTile
          label="Revenue"
          value={formatMoney(dashboard.revenue)}
          detail="Current month booked invoices"
          tone="emerald"
        />
        <MetricTile
          label="Pending Payments"
          value={formatMoney(dashboard.pendingPayments)}
          detail={`${dashboard.unpaidInvoices.length} invoices awaiting receipt`}
          tone="amber"
        />
        <MetricTile
          label="Overdue Invoices"
          value={String(dashboard.overdueInvoices.length)}
          detail={`${formatMoney(dashboard.overdueAmount)} beyond due date`}
          tone={dashboard.overdueInvoices.length ? "rose" : "slate"}
        />
        <MetricTile
          label="Inventory Alerts"
          value={String(dashboard.inventoryAlerts.length)}
          detail="Items at or below reorder level"
          tone={dashboard.inventoryAlerts.length ? "amber" : "slate"}
        />
        <MetricTile
          label="Cashflow Risk"
          value={dashboard.cashflowRisk}
          detail={`${dashboard.cashflowRiskScore}% operating risk index`}
          tone={
            dashboard.cashflowRisk === "High"
              ? "rose"
              : dashboard.cashflowRisk === "Medium"
                ? "amber"
                : "emerald"
          }
        />
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <Section title="Receivables Control">
          <div className="flex h-full min-h-0 flex-col overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[48%]" />
                <col className="w-[24%]" />
                <col className="w-[28%]" />
              </colgroup>
              <thead className="border-b border-slate-200 bg-slate-50 text-[16px] font-bold uppercase tracking-[0.12em] text-slate-700">
                <tr>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[16px]">
                {dashboard.unpaidInvoices.slice(0, 8).map((invoice) => {
                  const dueDate = parseDate(invoice.due_date);
                  const age = dueDate
                    ? Math.max(
                        0,
                        Math.floor((Date.now() - dueDate.getTime()) / 86400000),
                      )
                    : 0;
                  const overdue = dueDate ? dueDate < new Date() : false;

                  return (
                    <tr key={getId(invoice._id)} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-900">
                        <div className="truncate">
                          {invoice.invoice_number ||
                            `INV-${String(invoice.invoice_tnx_id || "").substring(0, 8)}`}
                        </div>
                        <div className="mt-0.5 text-[15px] font-semibold text-slate-600">
                          {overdue ? "Overdue" : invoice.status || "Pending"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                        {formatMoney(Number(invoice.grand_total || 0))}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">
                        <div>{dueDate ? dueDate.toLocaleDateString("en-IN") : "N/A"}</div>
                        <div className={overdue ? "text-rose-700" : "text-slate-600"}>{overdue ? `${age}d late` : "-"}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {dashboard.unpaidInvoices.length === 0 && (
              <EmptyState label="Receivable rows will appear here" />
            )}
          </div>
        </Section>

        <Section title="Operational Alerts">
          <div className="flex h-full min-h-0 flex-col divide-y divide-slate-100">
            {dashboard.alerts.length === 0 ? (
              <EmptyState label="Operational alerts will appear here" />
            ) : (
              dashboard.alerts.map((alert: any, index) => (
                <AlertRow key={`${alert.title}-${index}`} {...alert} />
              ))
            )}
          </div>
        </Section>
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <Section title="Inventory Exceptions">
          <div className="flex h-full min-h-0 flex-col overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[48%]" />
                <col className="w-[24%]" />
                <col className="w-[28%]" />
              </colgroup>
              <thead className="border-b border-slate-200 bg-slate-50 text-[16px] font-bold uppercase tracking-[0.12em] text-slate-700">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2.5 text-right">Stock</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[16px]">
                {dashboard.inventoryAlerts.slice(0, 7).map((item) => (
                  <tr key={getId(item._id)} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-bold text-slate-900">
                      <div className="truncate">{item.name || "Inventory item"}</div>
                      <div className="mt-0.5 font-mono text-[15px] font-semibold text-slate-600">
                        {item.code || "N/A"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-amber-700">
                      {item.total_sub_units || 0} {item.sub_unit || ""}
                    </td>
                    <td className="px-3 py-2 text-[16px] font-semibold text-slate-600">
                      Reorder / verify stock
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dashboard.inventoryAlerts.length === 0 && (
              <EmptyState label="Inventory exceptions will appear here" />
            )}
          </div>
        </Section>

        <Section title="Recent Activities">
          <div className="flex h-full min-h-0 flex-col divide-y divide-slate-100">
            {dashboard.recentActivities.length === 0 ? (
              <EmptyState label="Recent activity will appear here" />
            ) : (
              dashboard.recentActivities.map((activity, index) => (
                <div
                  key={`${activity.type}-${activity.title}-${index}`}
                  className="grid grid-cols-[76px_1fr_auto] gap-3 px-3 py-2 text-[16px]"
                >
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-center text-[16px] font-bold text-slate-600">
                    {activity.type}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-bold text-slate-900">
                      {activity.title}
                    </div>
                    <div className="mt-0.5 truncate text-[16px] font-semibold text-slate-700">
                      {activity.detail}
                    </div>
                  </div>
                  <div className="text-right text-[16px] font-semibold text-slate-600">
                    {activity.date
                      ? activity.date.toLocaleDateString("en-IN")
                      : "N/A"}
                  </div>
                </div>
              ))
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
