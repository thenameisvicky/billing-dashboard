import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ViewContainer } from "../../components/common/viewContainer";
import { DataTable } from "../../components/common/dataTable";
import { CustomerModal } from "../../components/common/customerModal";
import { SlideOver } from "../../components/common/SlideOver";
import { subscribeToTopNavAction } from "../../components/topNav/actions";
import axios from "../../utils/axios";

const getCustomerId = (item: any) => item?._id?.$oid || item?._id;
const getInvoiceId = (item: any) => item?._id?.$oid || item?._id;

const displayValue = (value: any, fallback = "N/A") => {
  if (value === null || value === undefined || value === "") return fallback;
  return value;
};

const searchValue = (value: any) => String(value || "").toLowerCase();

const normalizeId = (value: any): string => {
  if (!value) return "";
  if (typeof value === "object") {
    return String(value.$oid || value.oid || value.id || value._id || "");
  }
  return String(value);
};

const getMetadataValue = (metadata: any, keys: string[]) => {
  if (!metadata || typeof metadata !== "object") return "";

  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null) return normalizeId(value);
  }

  return "";
};

const parseEventDate = (value: any) => {
  if (!value) return null;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  }
  if (value.$date?.$numberLong)
    return new Date(Number(value.$date.$numberLong));
  if (value.$date) return new Date(value.$date);
  return null;
};

const formatEventName = (value: any) =>
  displayValue(value, "Activity")
    .toString()
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();

const formatEventDate = (value: any) => {
  const date = parseEventDate(value);
  if (!date || Number.isNaN(date.getTime())) return "Date N/A";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const fromPaise = (value: any) => {
  const amount = Number(value || 0);

  return (amount / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatEventMeta = (event: any) => {
  const invoiceNumber =
    event.metadata?.invoice_number ||
    event.metadata?.invoiceNumber ||
    event.metadata?.invoice_tnx_id;
  const amount =
    event.metadata?.grand_total ||
    event.metadata?.amount ||
    event.metadata?.paid_amount;

  if (invoiceNumber && amount)
    return `${invoiceNumber} · ₹${fromPaise(amount)}`;
  if (invoiceNumber) return String(invoiceNumber);
  if (amount) return `₹${fromPaise(amount)}`;
  return "";
};

const isCustomerEvent = (
  event: any,
  customer: any,
  invoiceIds = new Set<string>(),
) => {
  const customerId = normalizeId(getCustomerId(customer));
  const eventEntityId = normalizeId(event.entity_id);
  const metadataCustomerId = getMetadataValue(event.metadata, [
    "customer_id",
    "customerId",
    "customer",
    "customer_oid",
  ]);
  const metadataInvoiceId = getMetadataValue(event.metadata, [
    "invoice_id",
    "invoiceId",
    "invoice",
    "invoice_oid",
  ]);

  if (
    customerId &&
    (eventEntityId === customerId || metadataCustomerId === customerId)
  ) {
    return true;
  }

  if (
    invoiceIds.size > 0 &&
    ((eventEntityId && invoiceIds.has(eventEntityId)) ||
      (metadataInvoiceId && invoiceIds.has(metadataInvoiceId)))
  ) {
    return true;
  }

  const customerName = searchValue(customer.name);
  const metadataName = searchValue(
    event.metadata?.customer_name ||
      event.metadata?.customerName ||
      event.metadata?.name,
  );

  return Boolean(customerName && metadataName && customerName === metadataName);
};

const isInvoiceForCustomer = (invoice: any, customer: any) => {
  const invoiceCustomerId = normalizeId(invoice.customer_id);
  const customerId = normalizeId(getCustomerId(customer));

  return Boolean(
    invoiceCustomerId && customerId && invoiceCustomerId === customerId,
  );
};

const hasInvoiceCreatedEvent = (events: any[], invoiceId: string) =>
  events.some((event) => {
    const eventEntityId = normalizeId(event.entity_id);
    const metadataInvoiceId = getMetadataValue(event.metadata, [
      "invoice_id",
      "invoiceId",
      "invoice",
      "invoice_oid",
    ]);
    const eventType = searchValue(event.event_type);

    return (
      (eventEntityId === invoiceId || metadataInvoiceId === invoiceId) &&
      eventType.includes("invoice") &&
      (eventType.includes("created") ||
        eventType.includes("generated") ||
        eventType.includes("create"))
    );
  });

const createInvoiceGeneratedEvent = (invoice: any) => {
  const invoiceId = normalizeId(getInvoiceId(invoice));

  return {
    id: `invoice-generated-${invoiceId}`,
    entity_id: invoiceId,
    entity_type: "Invoice",
    event_type: "Invoice generated",
    metadata: {
      invoice_number: invoice.invoice_number || invoice.invoice_tnx_id,
      grand_total: invoice.grand_total,
    },
    created_at: invoice.created_at || invoice.updated_at,
    isDerived: true,
  };
};

function CustomerActivityRail({
  events,
  loading,
  customer,
}: {
  events: any[];
  loading: boolean;
  customer: any;
}) {
  const fallbackDate =
    customer?.created_at || customer?.createdAt || customer?.updated_at || null;

  return (
    <aside className="flex h-full w-[30%] min-w-[260px] flex-col border-r border-slate-300 bg-slate-50">
      <div className="border-b border-slate-300 px-3 py-2">
        <h4 className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-800">
          Activity
        </h4>
        <p className="mt-1 text-[16px] font-semibold text-slate-500">
          Latest first
        </p>
      </div>

      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <p className="py-4 text-[16px] font-bold uppercase tracking-[0.12em] text-slate-400">
            Loading activity
          </p>
        ) : events.length === 0 ? (
          <div className="space-y-3 opacity-70">
            <div className="border-l-2 border-emerald-600 pl-3">
              <p className="text-[16px] font-bold text-slate-900">
                Customer created
              </p>
              <p className="mt-1 text-[16px] font-semibold text-slate-500">
                {fallbackDate
                  ? formatEventDate(fallbackDate)
                  : "Awaiting event log"}
              </p>
            </div>
            <p className="text-[16px] font-semibold text-slate-400">
              Invoice and payment activity will appear here when events are
              logged.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {events.map((event) => (
              <li
                key={event.id || `${event.event_type}-${event.created_at}`}
                className="border-l-2 border-slate-300 pl-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[16px] font-bold leading-5 text-slate-900">
                    {formatEventName(event.event_type)}
                  </p>
                  <span className="shrink-0 border border-slate-300 bg-white px-1.5 py-0.5 text-[12px] font-bold uppercase text-slate-600">
                    {formatEventName(event.entity_type)}
                  </span>
                </div>
                <p className="mt-1 text-[16px] font-semibold text-slate-500">
                  {formatEventDate(event.created_at)}
                </p>
                {formatEventMeta(event) && (
                  <p className="mt-1 text-[16px] font-semibold text-slate-700">
                    {formatEventMeta(event)}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function TypeBadge({ type }: { type: string }) {
  const isBusiness = type === "Business";

  return (
    <span
      className={`inline-flex min-w-[82px] items-center justify-center rounded border px-2 py-0.5 text-[16px] font-bold leading-5 ${
        isBusiness
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {displayValue(type, "Unknown")}
    </span>
  );
}

function GstBadge({ gstin }: { gstin?: string }) {
  const hasGstin = Boolean(gstin);

  return (
    <span
      className={`inline-flex min-w-[92px] items-center justify-center rounded border px-2 py-0.5 text-[16px] font-bold leading-5 ${
        hasGstin
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {hasGstin ? "GST Registered" : "No GSTIN"}
    </span>
  );
}

function ActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`inline-flex min-w-[62px] items-center justify-center rounded border px-2 py-0.5 text-[16px] font-bold leading-5 ${
        isActive
          ? "border-slate-200 bg-white text-slate-600"
          : "border-rose-200 bg-rose-50 text-rose-700"
      }`}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[108px_1fr] items-start gap-3 border-b border-slate-300 py-2 last:border-b-0">
      <dt className="text-[16px] font-bold uppercase tracking-[0.12em] text-slate-600">
        {label}
      </dt>
      <dd className="text-[16px] font-semibold leading-5 text-slate-900">
        {value}
      </dd>
    </div>
  );
}

export default function CustomersPage() {
  const [items, setItems] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [viewItem, setViewItem] = useState<any>(null);
  const [customerEvents, setCustomerEvents] = useState<any[]>([]);
  const [customerEventsLoading, setCustomerEventsLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const openNewCustomer = useCallback(() => {
    setEditItem(null);
    setIsModalOpen(true);
  }, []);

  const openEditCustomer = useCallback((item: any) => {
    setEditItem(item);
    setIsModalOpen(true);
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/main/customers");
      if (data?.status === "success" && Array.isArray(data.data)) {
        setItems(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch customers", err);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (!viewItem) {
      setCustomerEvents([]);
      setCustomerEventsLoading(false);
      return;
    }

    const fetchCustomerEvents = async () => {
      setCustomerEventsLoading(true);
      try {
        const customerId = getCustomerId(viewItem);
        const [feedResponse, invoicesResponse] = await Promise.all([
          axios.get("/api/main/feed", { params: { customerid: customerId } }),
          axios.get("/api/main/invoice"),
        ]);
        const feedData = feedResponse.data;
        const invoicesData = invoicesResponse.data;
        const events = Array.isArray(feedData?.data) ? feedData.data : [];
        const invoices = Array.isArray(invoicesData?.data)
          ? invoicesData.data
          : [];
        const customerInvoices = invoices.filter((invoice: any) =>
          isInvoiceForCustomer(invoice, viewItem),
        );
        const invoiceIds = new Set<string>(
          customerInvoices
            .map((invoice: any) => normalizeId(getInvoiceId(invoice)))
            .filter(Boolean),
        );
        const relatedEvents = events.filter((event: any) =>
          isCustomerEvent(event, viewItem, invoiceIds),
        );
        const derivedInvoiceEvents = customerInvoices
          .filter((invoice: any) => {
            const invoiceId = normalizeId(getInvoiceId(invoice));
            return (
              invoiceId && !hasInvoiceCreatedEvent(relatedEvents, invoiceId)
            );
          })
          .map(createInvoiceGeneratedEvent);

        setCustomerEvents(
          [...relatedEvents, ...derivedInvoiceEvents].sort((a: any, b: any) => {
            const aTime = parseEventDate(a.created_at)?.getTime() || 0;
            const bTime = parseEventDate(b.created_at)?.getTime() || 0;
            return bTime - aTime;
          }),
        );
      } catch (error) {
        console.error("Failed to fetch customer activity", error);
        setCustomerEvents([]);
      } finally {
        setCustomerEventsLoading(false);
      }
    };

    fetchCustomerEvents();
  }, [viewItem]);

  useEffect(
    () =>
      subscribeToTopNavAction((action) => {
        if (action === "create-customer") openNewCustomer();
      }),
    [openNewCustomer],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openNewCustomer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openNewCustomer]);

  const handleDelete = async (item: any) => {
    if (!window.confirm(`Are you sure you want to delete ${item.name}?`))
      return;
    try {
      const response = await axios.patch(
        `/api/main/customers/${getCustomerId(item)}`,
        { is_active: false },
      );
      if (response.ok) {
        fetchItems();
      }
    } catch (err) {
      console.error("Failed to delete customer", err);
    }
  };

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;

    return items.filter((item) => {
      const fields = [
        item.name,
        item.phone,
        item.email,
        item.customer_type,
        item.gstin,
        item.billing_state,
      ];

      return fields.some((field) =>
        searchValue(field).includes(normalizedQuery),
      );
    });
  }, [items, query]);

  const tableData = {
    columns: [
      "Customer",
      "Contact",
      "Classification",
      "GSTIN",
      "State",
      "Status",
    ],
    rows: filteredItems.map((item) => {
      const isActive = item.is_active !== false;

      return [
        <div className="min-w-0">
          <div className="truncate font-bold text-slate-900">
            {displayValue(item.name, "Unnamed customer")}
          </div>
          <div className="mt-0.5 truncate text-[16px] font-medium text-slate-700">
            {displayValue(item.email, "No email")}
          </div>
        </div>,
        <span className="font-semibold text-slate-900">
          {displayValue(item.phone, "Not provided")}
        </span>,
        displayValue(item.customer_type, "Unknown"),
        <span className="font-mono text-[16px] font-bold uppercase text-slate-800">
          {displayValue(item.gstin, "No GSTIN")}
        </span>,
        displayValue(item.billing_state, "N/A"),
        isActive ? "Active" : "Inactive",
      ];
    }),
    rawItems: filteredItems,
  };

  const subToolbar = {
    rightActions: (
      <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
        <div className="relative min-w-0 flex-1 lg:w-[360px]">
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, phone, GSTIN, state..."
            className="h-9 w-full rounded border border-slate-300 bg-slate-50 px-9 pr-16 text-[16px] font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <button
          type="button"
          onClick={openNewCustomer}
          className="inline-flex h-9 items-center justify-center gap-2 rounded border border-slate-900 bg-slate-900 px-4 text-[16px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        >
          <span>New Customer</span>
        </button>
      </div>
    ),
  };

  return (
    <>
      <ViewContainer
        subToolbar={subToolbar}
        activeView={
          <DataTable
            data={tableData}
            onEdit={(item) => openEditCustomer(item)}
            onDelete={handleDelete}
            onOpen={(item) => setViewItem(item)}
          />
        }
      />

      {isModalOpen && (
        <CustomerModal
          isOpen={isModalOpen}
          initialData={editItem}
          onClose={() => {
            setIsModalOpen(false);
            setEditItem(null);
          }}
          onSuccess={() => {
            fetchItems();
          }}
        />
      )}

      {viewItem && (
        <SlideOver
          isOpen={!!viewItem}
          onClose={() => setViewItem(null)}
          title={displayValue(viewItem.name, "Customer")}
          subtitle="Customer Details"
          widthClassName="max-w-none md:w-[70vw] md:min-w-[860px]"
        >
          <div className="flex h-full min-h-0 border border-slate-300 bg-white">
            <CustomerActivityRail
              events={customerEvents}
              loading={customerEventsLoading}
              customer={viewItem}
            />

            <div className="hide-scrollbar min-w-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                  <div className="flex flex-wrap gap-2">
                    <TypeBadge type={viewItem.customer_type} />
                    <GstBadge gstin={viewItem.gstin} />
                    <ActiveBadge isActive={viewItem.is_active !== false} />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setViewItem(null);
                      openEditCustomer(viewItem);
                    }}
                    className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-[16px] font-bold uppercase tracking-[0.12em] text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    Edit
                  </button>
                </div>

                <section className="rounded border border-slate-200 bg-white px-4 py-2">
                  <h4 className="border-b border-slate-300 py-2 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">
                    Contact
                  </h4>
                  <dl>
                    <DetailRow
                      label="Phone"
                      value={displayValue(viewItem.phone, "Not provided")}
                    />
                    <DetailRow
                      label="Email"
                      value={displayValue(viewItem.email, "N/A")}
                    />
                  </dl>
                </section>

                <section className="rounded border border-slate-200 bg-white px-4 py-2">
                  <h4 className="border-b border-slate-300 py-2 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">
                    GST & State
                  </h4>
                  <dl>
                    <DetailRow
                      label="Type"
                      value={displayValue(viewItem.customer_type, "Unknown")}
                    />
                    <DetailRow
                      label="GSTIN"
                      value={displayValue(viewItem.gstin, "No GSTIN")}
                    />
                    <DetailRow
                      label="State"
                      value={displayValue(viewItem.billing_state, "N/A")}
                    />
                  </dl>
                </section>

                <section className="rounded border border-slate-200 bg-white px-4 py-2">
                  <h4 className="border-b border-slate-300 py-2 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">
                    Address & Notes
                  </h4>
                  <dl>
                    <DetailRow
                      label="Address"
                      value={displayValue(viewItem.address, "N/A")}
                    />
                    <DetailRow
                      label="Notes"
                      value={displayValue(
                        viewItem.notes,
                        "No notes available.",
                      )}
                    />
                  </dl>
                </section>
              </div>
            </div>
          </div>
        </SlideOver>
      )}
    </>
  );
}
