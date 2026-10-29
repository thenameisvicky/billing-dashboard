import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "../../utils/axios";
import { buildDashboardInsights, parseDate } from "../../utils/dashboardInsights";
import { useOutsideDismiss } from "./useOutsideDismiss";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  timestamp: Date | null;
  severity: "High" | "Medium" | "Low";
  entity: string;
  page: string;
};

const formatTime = (date: Date | null) => {
  if (!date) return "Now";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getId = (value: any) => value?._id?.$oid || value?._id || value?.id || value;

export function NotificationCenter({
  onNavigate,
}: {
  onNavigate: (page: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [feed, setFeed] = useState<any[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useOutsideDismiss([triggerRef, panelRef], isOpen, closePanel);

  useEffect(() => {
    let cancelled = false;

    const loadNotifications = async () => {
      try {
        const [customersResponse, invoicesResponse, inventoryResponse, feedResponse] =
          await Promise.all([
            axios.get("/api/main/customers"),
            axios.get("/api/main/invoice"),
            axios.get("/api/main/inventory/items"),
            axios.get("/api/main/feed"),
          ]);

        if (cancelled) return;
        if (customersResponse.data?.status === "success" && Array.isArray(customersResponse.data.data)) {
          setCustomers(customersResponse.data.data);
        }
        if (invoicesResponse.data?.status === "success" && Array.isArray(invoicesResponse.data.data)) {
          setInvoices(invoicesResponse.data.data);
        }
        if (inventoryResponse.data?.status === "success" && Array.isArray(inventoryResponse.data.data)) {
          setInventory(inventoryResponse.data.data);
        }
        if (feedResponse.data?.status === "success" && Array.isArray(feedResponse.data.data)) {
          setFeed(feedResponse.data.data);
        }
      } catch (error) {
        console.error("Failed to load notifications", error);
      }
    };

    loadNotifications();
    return () => {
      cancelled = true;
    };
  }, []);

  const notifications = useMemo<NotificationItem[]>(() => {
    const insights = buildDashboardInsights({ customers, invoices, inventory });
    const derived: NotificationItem[] = [];

    insights.overdueInvoices.slice(0, 5).forEach((invoice: any) => {
      const invoiceId = getId(invoice) || invoice.invoice_tnx_id;
      derived.push({
        id: `overdue-${invoiceId}`,
        title: "Invoice overdue",
        message: `${invoice.invoice_number || "Invoice"} is past due`,
        timestamp: parseDate(invoice.due_date),
        severity: "High",
        entity: invoice.invoice_number || invoice.invoice_tnx_id || "Invoice",
        page: "Invoices",
      });
    });

    insights.inventoryAlerts.slice(0, 5).forEach((item: any) => {
      const stock = Number(item.total_sub_units || 0);
      const threshold = Number(item.reorder_level ?? item.min_stock_level ?? 10);
      derived.push({
        id: `low-stock-${getId(item) || item.code}`,
        title: "Product below reorder level",
        message: `${item.name || "Product"} has ${stock} against threshold ${threshold}`,
        timestamp: parseDate(item.updated_at) || parseDate(item.created_at),
        severity: stock === 0 ? "High" : "Medium",
        entity: item.code || item.name || "Product",
        page: "Products",
      });
    });

    feed
      .filter((event) => {
        const text = `${event.event_type || ""} ${event.status || ""}`.toLowerCase();
        return ["failed", "error", "validation", "mismatch", "warning"].some((word) =>
          text.includes(word),
        );
      })
      .slice(0, 5)
      .forEach((event) => {
        const eventType = String(event.event_type || "System activity").replace(/_/g, " ");
        derived.push({
          id: `feed-${event.id || event._id || event.entity_id || event.created_at}`,
          title: eventType,
          message: "System activity requires attention",
          timestamp: parseDate(event.created_at),
          severity: "Medium",
          entity: event.entity_type || "Activity",
          page: "Home",
        });
      });

    return derived.sort(
      (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0),
    );
  }, [customers, feed, inventory, invoices]);

  const unread = notifications.filter((item) => !readIds.has(item.id));
  const earlier = notifications.filter((item) => readIds.has(item.id));
  const unreadCount = unread.length;

  const markReadAndOpen = (item: NotificationItem) => {
    setReadIds((current) => new Set(current).add(item.id));
    onNavigate(item.page);
    setIsOpen(false);
  };

  const renderNotification = (item: NotificationItem) => (
    <button
      key={item.id}
      type="button"
      onClick={() => markReadAndOpen(item)}
      className="w-full rounded border border-slate-200 bg-white p-2 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-100"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[16px] font-bold text-slate-900">{item.title}</p>
          <p className="mt-1 text-[13px] font-semibold text-slate-600">{item.message}</p>
          <p className="mt-1 text-[13px] font-bold text-slate-500">
            {item.entity} · {formatTime(item.timestamp)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[12px] font-bold uppercase ${
            item.severity === "High"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {item.severity}
        </span>
      </div>
    </button>
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") closePanel();
        }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-h-2 min-w-2 rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unreadCount <= 9 ? unreadCount : ""}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-[42px] z-50 w-[340px] rounded border border-slate-300 bg-white p-2 shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "Escape") closePanel();
          }}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-1 pb-2">
            <div className="text-[16px] font-bold text-slate-900">Notifications</div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => setReadIds(new Set(notifications.map((item) => item.id)))}
                className="rounded px-2 py-1 text-[13px] font-bold text-emerald-700 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              >
                Mark all as read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-[16px] font-bold text-slate-500">
              No new notifications
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto py-2">
              {unread.length > 0 && (
                <div className="space-y-2">
                  <div className="px-1 text-[13px] font-bold uppercase text-slate-500">
                    Unread
                  </div>
                  {unread.map(renderNotification)}
                </div>
              )}
              {earlier.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="px-1 text-[13px] font-bold uppercase text-slate-500">
                    Earlier
                  </div>
                  {earlier.map(renderNotification)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
