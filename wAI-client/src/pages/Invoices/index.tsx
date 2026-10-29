import { useState, useEffect, useCallback, useMemo } from "react";
import { ViewContainer } from "../../components/common/viewContainer";
import { DataTable } from "../../components/common/dataTable";
import { InvoiceModal } from "../../components/common/invoiceModal";
import { Tooltip } from "../../components/common/Tooltip";
import { SlideOver } from "../../components/common/SlideOver";
import { subscribeToTopNavAction } from "../../components/topNav/actions";
import axios, { getAuthToken, readApiJson } from "../../utils/axios";

const fromPaise = (v: number) => (v / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const defaultExportPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const parseDate = (value: any) => {
  if (!value) return null;
  if (value?.$date?.$numberLong) return new Date(Number(value.$date.$numberLong));
  if (value?.$date) return new Date(value.$date);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function InvoicesPage() {
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [realCustomers, setRealCustomers] = useState<any[]>([]);
  const [realInvoices, setRealInvoices] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [exportPeriod, setExportPeriod] = useState(defaultExportPeriod);
  const [exportProgress, setExportProgress] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const [editItem, setEditItem] = useState<any>(null);
  const [viewItem, setViewItem] = useState<any>(null);
  const [paymentEvents, setPaymentEvents] = useState<any[]>([]);
  const [paymentEventsLoading, setPaymentEventsLoading] = useState(false);

  const fetchCustomers = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/main/customers");
      if (data?.status === "success" && Array.isArray(data.data)) {
        setRealCustomers(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch customers", err);
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/main/invoice");
      if (data?.status === "success" && Array.isArray(data.data)) {
        setRealInvoices(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch invoices", err);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
    fetchInvoices();
  }, [fetchCustomers, fetchInvoices]);

  useEffect(() => {
    const invoiceId = viewItem?.invoice_tnx_id;
    if (!invoiceId) {
      setPaymentEvents([]);
      return;
    }
    let active = true;
    setPaymentEventsLoading(true);
    axios.get(`/api/main/invoice/${invoiceId}/payment-events`)
      .then(({ data }) => {
        if (active) setPaymentEvents(data?.status === "success" && Array.isArray(data.data) ? data.data : []);
      })
      .catch((error) => {
        console.error("Failed to load invoice payment events", error);
        if (active) setPaymentEvents([]);
      })
      .finally(() => {
        if (active) setPaymentEventsLoading(false);
      });
    return () => { active = false; };
  }, [viewItem?.invoice_tnx_id]);

  useEffect(
    () =>
      subscribeToTopNavAction((action) => {
        if (action === "create-invoice") {
          setEditItem(null);
          setIsInvoiceModalOpen(true);
        }
        if (action === "prepare-gstr1") {
          setQuery("gstr");
        }
      }),
    [],
  );

  const handleDelete = async (item: any) => {
      if (!window.confirm(`Are you sure you want to cancel/delete invoice ${item.invoice_number || item.invoice_tnx_id}?`)) return;
      try {
          const invoiceId = item.invoice_tnx_id || item._id?.$oid || item._id;
          const response = await axios.patch(`/api/main/invoice/${invoiceId}/delete`);
          if (response.ok) {
              fetchInvoices();
          }
      } catch (err) {
          console.error("Failed to delete invoice", err);
      }
  };

  const handleGstr1Export = async () => {
    setIsExporting(true);
    setExportProgress("Preparing export");
    try {
      const headers = new Headers();
      const token = getAuthToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const response = await fetch(
        `/api/main/invoice/gstr1-export?period=${encodeURIComponent(exportPeriod)}`,
        { headers },
      );

      const disposition = response.headers.get("Content-Disposition") || "";
      if (!response.ok || !disposition.includes("attachment")) {
        const errorData = await readApiJson(response);
        throw new Error((errorData as any)?.message || `Export failed with ${response.status}`);
      }

      const contentLength = Number(response.headers.get("Content-Length") || 0);
      const invoiceCount = response.headers.get("X-Export-Invoice-Count") || "0";
      const chunks: Uint8Array[] = [];
      let received = 0;

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            if (contentLength > 0) {
              setExportProgress(`Downloading ${Math.min(100, Math.round((received / contentLength) * 100))}%`);
            } else {
              setExportProgress("Downloading export");
            }
          }
        }
      } else {
        chunks.push(new Uint8Array(await response.arrayBuffer()));
      }

      setExportProgress("Saving file");
      const blob = new Blob(
        chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer),
        { type: "application/json" },
      );
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `gstr1-${exportPeriod}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportProgress(`Downloaded ${invoiceCount} invoices`);
    } catch (error) {
      console.error("Failed to export GSTR-1", error);
      setExportProgress(error instanceof Error ? error.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const handleBulkWhatsapp = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm("Send selected issued invoices through WhatsApp?\n\nDraft invoices will be issued before sending.\nInvoices with missing customer phone numbers will be skipped.")) return;
    setBulkStatus("Sending WhatsApp messages");
    const response = await axios.post("/api/main/invoices/bulk-send-whatsapp", { invoice_ids: selectedIds });
    if (response.ok) {
      setBulkStatus(`Selected ${response.data?.summary?.selected || 0}, sent ${response.data?.summary?.sent || 0}, failed ${response.data?.summary?.failed || 0}, skipped ${response.data?.summary?.skipped || 0}`);
      setSelectedIds([]);
      fetchInvoices();
    } else {
      setBulkStatus(response.data?.message || "Bulk send failed");
    }
  };

  const handleImportCsv = () => {
    setBulkStatus("Use GST / GSTR-1 for POS imports. Invoice CSV preview/commit endpoints are available at /invoice-imports/preview and /invoice-imports/commit.");
  };

  const subToolbar = {
    rightActions: (
      <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
        <div className="flex min-w-0 items-center gap-2 rounded border border-slate-300 bg-white px-2">
          <input
            type="month"
            value={exportPeriod}
            onChange={(event) => setExportPeriod(event.target.value)}
            className="h-9 min-w-[132px] bg-transparent text-[16px] font-bold text-slate-800 outline-none"
          />
          <button
            onClick={handleGstr1Export}
            disabled={isExporting || !exportPeriod}
            className="inline-flex h-7 items-center justify-center gap-2 rounded border border-emerald-700 bg-emerald-600 px-3 text-[13px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            title="Download GSTR-1 JSON"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            {isExporting ? "Exporting" : "GSTR-1"}
          </button>
        </div>
        {exportProgress && (
          <div className="flex h-9 min-w-[160px] items-center rounded border border-slate-300 bg-slate-50 px-3 text-[16px] font-bold text-slate-700">
            {exportProgress}
          </div>
        )}
        {bulkStatus && (
          <div className="flex h-9 min-w-[180px] items-center rounded border border-slate-300 bg-slate-50 px-3 text-[16px] font-bold text-slate-700">
            {bulkStatus}
          </div>
        )}
        <div className="relative min-w-0 flex-1 lg:w-[320px]">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search invoice, customer, status..."
            className="h-9 w-full rounded border border-slate-300 bg-slate-50 px-9 text-[16px] font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          </div>
        </div>
        <button
          onClick={() => { setEditItem(null); setIsInvoiceModalOpen(true); }}
          className="inline-flex h-9 items-center justify-center rounded border border-slate-900 bg-slate-900 px-4 text-[16px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        >
          New Invoice
        </button>
        <button
          onClick={handleImportCsv}
          className="inline-flex h-9 items-center justify-center rounded border border-slate-300 bg-white px-4 text-[16px] font-bold uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-50"
        >
          Import CSV
        </button>
        <button
          onClick={handleBulkWhatsapp}
          disabled={selectedIds.length === 0}
          className="inline-flex h-9 items-center justify-center rounded border border-emerald-700 bg-emerald-600 px-4 text-[16px] font-bold uppercase tracking-[0.12em] text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          WhatsApp
        </button>
      </div>
    )
  };

  const filteredInvoices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filteredByStatus = realInvoices.filter((inv) => {
      const status = String(inv.lifecycle_status || inv.status || "").toLowerCase();
      const delivery = String(inv.delivery_status || "").toLowerCase();
      const payment = String(inv.payment_status || "").toLowerCase();
      const dueDate = parseDate(inv.due_date);
      const overdue = dueDate && dueDate < new Date() && Number(inv.due_amount ?? inv.grand_total ?? 0) > 0;
      if (filter === "Draft") return status.includes("draft");
      if (filter === "Issued") return status.includes("issued") || String(inv.status) === "Sent";
      if (filter === "Unpaid") return payment.includes("unpaid");
      if (filter === "Partially paid") return payment.includes("partial");
      if (filter === "Paid") return payment === "paid";
      if (filter === "Overdue") return Boolean(overdue);
      if (filter === "WhatsApp failed") return delivery === "failed";
      if (filter === "Imported") return ["CSV_IMPORT", "POS_IMPORT"].includes(inv.source);
      return true;
    });
    if (!normalizedQuery) return filteredByStatus;

    return filteredByStatus.filter((inv) => {
      const customerId = inv.customer_id?.$oid ?? inv.customer_id;
      const customer = realCustomers.find(c => (c._id?.$oid ?? c._id) === customerId);
      return [
        inv.invoice_number,
        inv.invoice_tnx_id,
        customer?.name,
        inv.status,
        inv.invoice_type,
        inv.place_of_supply,
      ].some((field) => String(field || "").toLowerCase().includes(normalizedQuery));
    });
  }, [filter, query, realCustomers, realInvoices]);

  const invoiceTableData = {
    columns: ["", "Invoice number", "Customer", "Invoice date", "Due date", "Source", "Lifecycle", "WhatsApp", "Payment", "Grand total", "Received", "Due", "Last updated"],
    rows: filteredInvoices.map(inv => {
      const customerId = inv.customer_id?.$oid ?? inv.customer_id;
      const customer = realCustomers.find(c => (c._id?.$oid ?? c._id) === customerId);
      const createdAt = parseDate(inv.created_at);
      const dueDate = parseDate(inv.due_date);
      const updatedAt = parseDate(inv.last_updated);
      const invoiceId = inv.invoice_tnx_id || inv._id?.$oid || inv._id;

      return [
        <input
          type="checkbox"
          checked={selectedIds.includes(invoiceId)}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, invoiceId] : current.filter((id) => id !== invoiceId))}
        />,
        inv.invoice_number || `INV-${inv.invoice_tnx_id.substring(0, 8)}`,
        customer ? customer.name : inv.customer_id ?? "Unknown",
        createdAt ? (
          <Tooltip 
            content={createdAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} 
            showArrow={true} 
            size="small"
          >
            <span className="inline-flex cursor-help">{createdAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
          </Tooltip>
        ) : "N/A",
        dueDate ? dueDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : "N/A",
        inv.source || "MANUAL",
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[16px] font-bold text-slate-700">
          {inv.lifecycle_status || inv.status || "Draft"}
        </span>,
        inv.delivery_status || "NOT_SENT",
        inv.payment_status || "UnPaid",
        `₹${fromPaise(inv.grand_total)}`,
        `₹${fromPaise(inv.amount_received || 0)}`,
        `₹${fromPaise(inv.due_amount ?? inv.grand_total ?? 0)}`,
        updatedAt ? updatedAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : "N/A",
      ];
    }),
    rawItems: filteredInvoices
  };

  return (
    <>
      <ViewContainer
        subToolbar={subToolbar}
        activeView={
          <>
            <div className="mb-2 flex flex-wrap gap-2">
              {["All", "Draft", "Issued", "Unpaid", "Partially paid", "Paid", "Overdue", "WhatsApp failed", "Imported"].map((item) => (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={`h-8 rounded border px-3 text-[16px] font-bold ${filter === item ? "border-emerald-700 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <DataTable 
                data={invoiceTableData}
                onEdit={(item) => { setEditItem(item); setIsInvoiceModalOpen(true); }}
                onDelete={handleDelete}
                onOpen={(item) => setViewItem(item)}
                actionVariant="buttons"
            />
          </>
        }
      />
      {isInvoiceModalOpen && (
        <InvoiceModal
          isOpen={isInvoiceModalOpen}
          initialData={editItem}
          onClose={() => { setIsInvoiceModalOpen(false); setEditItem(null); }}
          onSuccess={() => {
            fetchInvoices();
          }}
        />
      )}
      {viewItem && (
          <SlideOver
              isOpen={!!viewItem}
              onClose={() => setViewItem(null)}
              title={`Invoice ${viewItem.invoice_number || viewItem.invoice_tnx_id.substring(0,8)}`}
              subtitle={viewItem.status}
          >
              <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 bg-white p-3">
                      <div>
                          <p className="mb-2 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">Financials</p>
                          <p className="text-[16px] font-bold text-slate-900">Total: ₹{fromPaise(viewItem.total_amount)}</p>
                          <p className="text-[16px] font-bold text-slate-900">Tax: ₹{fromPaise(viewItem.total_tax_amount)}</p>
                          {(viewItem.discount_amount || viewItem.discount_percentage) ? (
                            <p className="text-[16px] font-bold text-rose-600">Discount: ₹{fromPaise(viewItem.discount_amount || 0)} ({viewItem.discount_percentage || 0}%)</p>
                          ) : null}
                          <p className="mt-1 text-[16px] font-bold text-emerald-700">Grand: ₹{fromPaise(viewItem.grand_total)}</p>
                      </div>
                      <div>
                          <p className="mb-2 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">Details</p>
                          <p className="text-[16px] font-bold text-slate-900">Type: {viewItem.invoice_type}</p>
                          <p className="text-[16px] font-bold text-slate-900">Supply: {viewItem.place_of_supply}</p>
                          <p className="text-[16px] font-bold text-slate-900">Billing State: {realCustomers.find(c => (c._id?.$oid ?? c._id) === (viewItem.customer_id?.$oid ?? viewItem.customer_id))?.billing_state || 'N/A'}</p>
                          <p className="text-[16px] font-bold text-slate-900">Due: {viewItem.due_date ? new Date(viewItem.due_date.$date ? Number(viewItem.due_date.$date.$numberLong) : viewItem.due_date).toLocaleDateString() : 'N/A'}</p>
                      </div>
                  </div>
                  
                  <div className="rounded border border-slate-200 bg-white p-3">
                      <p className="mb-3 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">Line Items ({viewItem.items?.length || 0})</p>
                      <div className="space-y-2">
                          {viewItem.items?.map((it: any, i: number) => (
                              <div key={i} className="flex items-center justify-between border border-slate-300 bg-slate-50 p-2.5">
                                  <div>
                                      <p className="text-[16px] font-bold text-slate-900">Item {i + 1}</p>
                                      <p className="text-[16px] text-slate-700">{it.quantity} {it.unit} @ ₹{fromPaise(it.unit_price)}</p>
                                  </div>
                                  <div className="text-right">
                                      <p className="text-[16px] font-bold text-slate-900">₹{fromPaise(it.line_grand_total || (it.quantity * it.unit_price))}</p>
                                      <p className="text-[16px] font-bold text-slate-600">Tax: ₹{fromPaise(it.line_tax_total || 0)}</p>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white p-3">
                      <p className="mb-3 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">Payment Attempts</p>
                      {paymentEventsLoading ? (
                        <p className="text-[16px] font-semibold text-slate-500">Loading payment history...</p>
                      ) : paymentEvents.length === 0 ? (
                        <p className="text-[16px] font-semibold text-slate-500">No payment attempts yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {paymentEvents.map((event: any) => (
                            <div key={event.internal_tnx_id || event._id?.$oid || event._id} className="flex items-center justify-between gap-3 border border-slate-200 bg-slate-50 p-2.5">
                              <div className="min-w-0">
                                <p className="text-[16px] font-bold text-slate-900">{event.status || "Pending"} · Razorpay</p>
                                <p className="truncate text-[13px] font-semibold text-slate-600">{event.razorpay_payment_id || event.razorpay_order_id || "Payment attempt created"}</p>
                              </div>
                              <p className="shrink-0 text-[16px] font-bold text-slate-900">₹{fromPaise(Number(event.amount_minor ?? event.amount ?? 0))}</p>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
              </div>
          </SlideOver>
      )}
    </>
  );
}
