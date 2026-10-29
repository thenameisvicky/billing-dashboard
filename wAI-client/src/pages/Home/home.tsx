import { useMemo, useState, useEffect } from "react";
import axios from "../../utils/axios";

const fromPaise = (value: number) =>
  `₹${(value / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const parseDate = (value: any) => {
  if (!value) return null;
  if (value?.$date?.$numberLong) return new Date(Number(value.$date.$numberLong));
  if (value?.$date) return new Date(value.$date);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const eventLabels = new Set([
  "CustomerCreated",
  "InvoiceCreated",
  "InvoiceImported",
  "InvoiceIssued",
  "InvoiceSent",
  "WhatsappDeliveryFailed",
  "PaymentReceived",
  "PaymentVerified",
  "Gstr1ImportCompleted",
  "Gstr1ExportGenerated",
]);

export default function HomePage() {
  const [events, setEvents] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [feedResponse, invoicesResponse] = await Promise.all([
          axios.get("/api/main/feed"),
          axios.get("/api/main/invoice"),
        ]);
        if (feedResponse.data?.status === "success") setEvents(feedResponse.data.data || []);
        if (invoicesResponse.data?.status === "success") setInvoices(invoicesResponse.data.data || []);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const metrics = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const active = invoices.filter((invoice) => invoice.is_active !== false && !["Cancelled", "Superseded"].includes(invoice.status));
    const weekInvoices = active.filter((invoice) => {
      const created = parseDate(invoice.created_at);
      return created ? created >= weekStart && created <= now : false;
    });
    const overdue = active.filter((invoice) => {
      const due = parseDate(invoice.due_date);
      return due && due < now && Number(invoice.due_amount ?? invoice.grand_total ?? 0) > 0;
    });
    return {
      createdThisWeek: weekInvoices.length,
      invoicedThisWeek: weekInvoices.reduce((sum, invoice) => sum + Number(invoice.grand_total || 0), 0),
      paymentsThisWeek: weekInvoices.reduce((sum, invoice) => sum + Number(invoice.amount_received || 0), 0),
      outstanding: active.reduce((sum, invoice) => sum + Number(invoice.due_amount ?? invoice.grand_total ?? 0), 0),
      overdueCount: overdue.length,
      whatsappFailures: active.filter((invoice) => invoice.delivery_status === "FAILED").length,
      overdue,
      whatsappFailed: active.filter((invoice) => invoice.delivery_status === "FAILED"),
      invalidImports: active.filter((invoice) => invoice.import_validation_status === "INVALID"),
      duplicates: active.filter((invoice) => invoice.duplicate_detected),
      unmatchedPayments: active.filter((invoice) => invoice.payment_match_status === "UNMATCHED"),
      gstrErrors: active.filter((invoice) => invoice.gstr1_validation_errors?.length),
    };
  }, [invoices]);

  const alerts = [
    ...metrics.overdue.map((invoice) => ({ title: "Overdue invoice", detail: invoice.invoice_number, severity: "High" })),
    ...metrics.whatsappFailed.map((invoice) => ({ title: "Failed WhatsApp delivery", detail: invoice.invoice_number, severity: "High" })),
    ...metrics.invalidImports.map((invoice) => ({ title: "Invalid imported invoice", detail: invoice.invoice_number, severity: "Medium" })),
    ...metrics.duplicates.map((invoice) => ({ title: "Duplicate invoice detected", detail: invoice.invoice_number, severity: "Medium" })),
    ...metrics.unmatchedPayments.map((invoice) => ({ title: "Payment received but not matched", detail: invoice.invoice_number, severity: "High" })),
    ...metrics.gstrErrors.map((invoice) => ({ title: "GSTR-1 validation errors", detail: invoice.invoice_number, severity: "High" })),
  ].slice(0, 12);

  const recentEvents = events
    .filter((event) => eventLabels.has(String(event.event_type)))
    .slice(0, 20);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        {[
          ["Invoices this week", metrics.createdThisWeek],
          ["Invoiced this week", fromPaise(metrics.invoicedThisWeek)],
          ["Payments this week", fromPaise(metrics.paymentsThisWeek)],
          ["Outstanding", fromPaise(metrics.outstanding)],
          ["Overdue", metrics.overdueCount],
          ["WhatsApp failures", metrics.whatsappFailures],
        ].map(([label, value]) => (
          <div key={label} className="border border-slate-300 bg-white p-3">
            <p className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-600">{label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_420px]">
        <section className="min-h-0 overflow-hidden border border-slate-300 bg-white">
          <div className="border-b border-slate-300 bg-slate-50 px-3 py-2">
            <h2 className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-800">Recent activity</h2>
          </div>
          <div className="hide-scrollbar h-full overflow-y-auto bg-slate-100 p-3">
            {loading ? (
              <p className="text-[16px] font-bold text-slate-500">Loading activity...</p>
            ) : recentEvents.length === 0 ? (
              <p className="text-[16px] font-bold text-slate-400">No launch activity recorded yet</p>
            ) : (
              <div className="space-y-2">
                {recentEvents.map((event) => (
                  <div key={event.id} className="border border-slate-200 bg-white p-3">
                    <p className="text-[16px] font-bold text-slate-900">{String(event.event_type).replace(/([A-Z])/g, " $1").trim()}</p>
                    <p className="mt-1 text-[16px] font-semibold text-slate-600">{new Date(event.created_at).toLocaleString("en-IN")}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden border border-slate-300 bg-white">
          <div className="border-b border-slate-300 bg-slate-50 px-3 py-2">
            <h2 className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-800">Actionable alerts</h2>
          </div>
          <div className="hide-scrollbar h-full overflow-y-auto bg-slate-100 p-3">
            {alerts.length === 0 ? (
              <p className="text-[16px] font-bold text-slate-400">No operational alerts right now</p>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert, index) => (
                  <div key={`${alert.title}-${alert.detail}-${index}`} className="border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[16px] font-bold text-slate-900">{alert.title}</p>
                        <p className="mt-1 text-[16px] font-semibold text-slate-700">{alert.detail || "Review required"}</p>
                      </div>
                      <span className="border border-slate-300 bg-slate-50 px-2 py-0.5 text-[16px] font-bold text-slate-700">{alert.severity}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
