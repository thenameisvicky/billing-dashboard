import { useState, useEffect, useCallback, useMemo } from "react";
import { ViewContainer } from "../../components/common/viewContainer";
import { DataTable } from "../../components/common/dataTable";
import { InventoryModal } from "../../components/common/inventoryModal";
import { SlideOver } from "../../components/common/SlideOver";
import { subscribeToTopNavAction } from "../../components/topNav/actions";
import axios from "../../utils/axios";

const fromPaise = (v: number) =>
  (v / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function ProductsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/main/inventory/items");
      if (data?.status === "success" && Array.isArray(data.data)) {
        setItems(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch inventory items", err);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(
    () =>
      subscribeToTopNavAction((action) => {
        if (action === "create-product") {
          setEditItem(null);
          setIsModalOpen(true);
        }
        if (action === "view-low-stock") {
          setLowStockOnly(true);
          setQuery("");
        }
      }),
    [],
  );

  const handleDelete = async (item: any) => {
    if (!window.confirm(`Are you sure you want to delete ${item.name}?`))
      return;
    try {
      const response = await axios.patch(
        `/api/main/inventory/items/${item._id.$oid || item._id}`,
        { is_active: false },
      );
      if (response.ok) {
        fetchItems();
      }
    } catch (err) {
      console.error("Failed to delete item", err);
    }
  };

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const visibleItems = lowStockOnly
      ? items.filter((item) => {
          const stock = Number(item.total_sub_units || 0);
          const reorderLevel = Number(
            item.reorder_level ?? item.min_stock_level ?? 10,
          );
          return stock <= reorderLevel;
        })
      : items;

    if (!normalizedQuery) return visibleItems;

    return visibleItems.filter((item) =>
      [
        item.code,
        item.name,
        item.hsn_code,
        item.sub_unit,
        item.warehouse_location,
      ].some((field) =>
        String(field || "")
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    );
  }, [items, lowStockOnly, query]);

  const tableData = {
    columns: ["Code", "Name", "HSN", "Stock", "Threshold", "Selling Price", "MRP"],
    rows: filteredItems.map((item) => {
      const stock = Number(item.total_sub_units || 0);
      const threshold = Number(item.reorder_level ?? item.min_stock_level ?? 10);
      const belowThreshold = stock <= threshold;

      return [
        item.code || "N/A",
        item.name || "Unnamed item",
        item.hsn_code || "N/A",
        <span
          className={`inline-flex rounded border px-2 py-0.5 text-[16px] font-bold ${belowThreshold ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}
        >
          {item.total_sub_units || 0} {item.sub_unit}
        </span>,
        belowThreshold ? `Below (${threshold})` : `OK (${threshold})`,
        `₹${fromPaise(item.selling_price)}`,
        `₹${fromPaise(item.mrp)}`,
      ];
    }),
    rawItems: filteredItems,
  };

  const [editItem, setEditItem] = useState<any>(null);
  const [viewItem, setViewItem] = useState<any>(null);

  const subToolbar = {
    rightActions: (
      <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
        <div className="relative min-w-0 flex-1 lg:w-[320px]">
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLowStockOnly(false);
            }}
            placeholder="Search item, code, HSN..."
            className="h-9 w-full rounded border border-slate-300 bg-slate-50 px-9 text-[16px] font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
        </div>
        <button
          onClick={() => {
            setEditItem(null);
            setIsModalOpen(true);
          }}
          className="inline-flex h-9 items-center justify-center rounded border border-slate-900 bg-slate-900 px-4 text-[16px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        >
          New Product
        </button>
        {lowStockOnly && (
          <button
            type="button"
            onClick={() => setLowStockOnly(false)}
            className="inline-flex h-9 items-center justify-center rounded border border-amber-200 bg-amber-50 px-3 text-[16px] font-bold text-amber-700 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-100"
          >
            Low Stock
          </button>
        )}
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
            onEdit={(item) => {
              setEditItem(item);
              setIsModalOpen(true);
            }}
            onDelete={handleDelete}
            onOpen={(item) => setViewItem(item)}
          />
        }
      />
      {isModalOpen && (
        <InventoryModal
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
          title={viewItem.name}
          subtitle={viewItem.code}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 bg-white p-3">
              <div>
                <p className="mb-2 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">
                  Pricing
                </p>
                <p className="text-[16px] font-bold text-slate-900">
                  SP: ₹{fromPaise(viewItem.selling_price)}
                </p>
                <p className="text-[16px] font-bold text-slate-900">
                  MRP: ₹{fromPaise(viewItem.mrp)}
                </p>
                <p className="text-[16px] font-bold text-slate-900">
                  CP: ₹{fromPaise(viewItem.cost_price)}
                </p>
              </div>
              <div>
                <p className="mb-2 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">
                  Stock Info
                </p>
                <p className="text-[16px] font-bold text-slate-900">
                  {viewItem.total_sub_units} {viewItem.sub_unit}
                </p>
                <p className="text-[16px] font-bold text-slate-900">
                  Warehouse: {viewItem.warehouse_location || "N/A"}
                </p>
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3">
              <p className="mb-2 text-[16px] font-bold uppercase tracking-[0.14em] text-slate-700">
                Codes & Taxes
              </p>
              <p className="text-[16px] font-bold text-slate-900">
                HSN: {viewItem.hsn_code || "N/A"}
              </p>
              <p className="text-[16px] font-bold text-slate-900">
                UQC: {viewItem.uqc_code || "N/A"}
              </p>
              {viewItem.tax?.length > 0 && (
                <p className="mt-2 text-[16px] font-bold text-slate-900">
                  Tax: {viewItem.tax[0].tax_name} (
                  {viewItem.tax[0].tax_percentage / 100}%)
                </p>
              )}
            </div>
          </div>
        </SlideOver>
      )}
    </>
  );
}
