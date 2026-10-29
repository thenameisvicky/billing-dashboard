import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "../../utils/axios";
import { emitTopNavAction, type TopNavAction } from "./actions";
import {
  createCommands,
  inventoryCommands,
  navigationCommands,
} from "./topNavData";
import { useOutsideDismiss } from "./useOutsideDismiss";

type CommandResult = {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  page: string;
  action?: TopNavAction;
  disabled?: boolean;
};

const categoryOrder = [
  "Navigation",
  "Customers",
  "Products",
  "Invoices",
  "Warehouses",
  "Inventory actions",
];

const normalize = (value: unknown) => String(value || "").toLowerCase();
const getId = (value: any) => value?._id?.$oid || value?._id || value?.id || value;

function matchesQuery(result: CommandResult, query: string) {
  const search = `${result.title} ${result.subtitle || ""} ${result.category}`;
  return normalize(search).includes(query);
}

export function GlobalCommandSearch({
  activePage,
  onNavigate,
}: {
  activePage: string;
  onNavigate: (page: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const closeResults = useCallback(() => {
    setIsOpen(false);
    setSelectedIndex(0);
  }, []);

  useOutsideDismiss([containerRef], isOpen, closeResults);

  useEffect(() => {
    let cancelled = false;

    const loadSearchData = async () => {
      try {
        const [customersResponse, invoicesResponse] =
          await Promise.all([
            axios.get("/api/main/customers"),
            axios.get("/api/main/invoice"),
          ]);

        if (cancelled) return;
        if (
          customersResponse.data?.status === "success" &&
          Array.isArray(customersResponse.data.data)
        ) {
          setCustomers(customersResponse.data.data);
        }
        if (
          invoicesResponse.data?.status === "success" &&
          Array.isArray(invoicesResponse.data.data)
        ) {
          setInvoices(invoicesResponse.data.data);
        }
      } catch (error) {
        console.error("Failed to load command search data", error);
      }
    };

    loadSearchData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const results = useMemo<CommandResult[]>(() => {
    const baseResults: CommandResult[] = [
      ...navigationCommands,
      ...createCommands.filter((command) => !command.disabled),
      ...inventoryCommands.filter((command) => command.id === "action-gstr1"),
    ];

    const customerResults = customers.slice(0, 12).map((customer) => ({
      id: `customer-${getId(customer)}`,
      category: "Customers",
      title: customer.name || "Unnamed customer",
      subtitle: customer.gstin || customer.email || customer.phone || "Customer",
      page: "Customers",
    }));

    const invoiceResults = invoices.slice(0, 12).map((invoice) => ({
      id: `invoice-${getId(invoice) || invoice.invoice_tnx_id}`,
      category: "Invoices",
      title: invoice.invoice_number || `INV-${String(invoice.invoice_tnx_id || "").slice(0, 8)}`,
      subtitle: invoice.status || "Invoice",
      page: "Invoices",
    }));

    const allResults = [
      ...baseResults,
      ...customerResults,
      ...invoiceResults,
    ];

    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? allResults.filter((result) => matchesQuery(result, normalizedQuery))
      : allResults.slice(0, 12);

    return filtered.slice(0, 30);
  }, [customers, invoices, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const groupedResults = useMemo(
    () =>
      categoryOrder
        .map((category) => ({
          category,
          results: results.filter((result) => result.category === category),
        }))
        .filter((group) => group.results.length > 0),
    [results],
  );

  const runResult = (result: CommandResult) => {
    if (result.disabled) return;
    onNavigate(result.page);
    closeResults();
    setQuery("");
    if (result.action) {
      window.setTimeout(() => emitTopNavAction(result.action as TopNavAction), 0);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeResults();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((value) => Math.min(results.length - 1, value + 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((value) => Math.max(0, value - 1));
      return;
    }

    if (event.key === "Enter" && results[selectedIndex]) {
      event.preventDefault();
      runResult(results[selectedIndex]);
    }
  };

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 md:max-w-[520px]">
      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          type="search"
          placeholder="Search or type a command"
          className="h-9 w-full rounded border border-slate-300 bg-slate-50 px-9 pr-16 text-[16px] font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          aria-label="Global search or command"
          aria-expanded={isOpen}
          aria-controls="global-command-results"
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
        <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[12px] font-bold text-slate-500 sm:inline-flex">
          Ctrl K
        </span>
      </div>

      {isOpen && (
        <div
          id="global-command-results"
          className="absolute left-0 right-0 top-[42px] z-50 max-h-[420px] overflow-y-auto rounded border border-slate-300 bg-white p-2 shadow-lg"
          role="listbox"
        >
          {groupedResults.length === 0 ? (
            <div className="px-3 py-4 text-[16px] font-bold text-slate-500">
              No results
            </div>
          ) : (
            groupedResults.map((group) => (
              <div key={group.category} className="py-1">
                <div className="px-2 py-1 text-[13px] font-bold uppercase text-slate-500">
                  {group.category}
                </div>
                {group.results.map((result) => {
                  const flatIndex = results.findIndex((item) => item.id === result.id);
                  const selected = flatIndex === selectedIndex;

                  return (
                    <button
                      key={result.id}
                      type="button"
                      disabled={result.disabled}
                      onMouseEnter={() => setSelectedIndex(flatIndex)}
                      onClick={() => runResult(result)}
                      className={`flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-[16px] font-bold focus:outline-none focus:ring-2 focus:ring-emerald-100 ${
                        selected ? "bg-emerald-50 text-emerald-800" : "text-slate-800 hover:bg-slate-50"
                      } ${result.disabled ? "cursor-not-allowed opacity-55" : ""}`}
                      role="option"
                      aria-selected={selected}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{result.title}</span>
                        {result.subtitle && (
                          <span className="block truncate text-[13px] font-semibold text-slate-500">
                            {result.subtitle}
                          </span>
                        )}
                      </span>
                      {activePage === result.page && (
                        <span className="shrink-0 text-[12px] font-bold uppercase text-slate-500">
                          Current
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
