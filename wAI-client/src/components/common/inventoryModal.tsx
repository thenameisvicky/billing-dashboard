import { useState } from "react";
import { createPortal } from "react-dom";
import axios, { formatApiError } from "../../utils/axios";

interface InventoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    initialData?: any;
}

type InventoryPayload = {
    name: string;
    code: string;
    hsn_code: string;
    uqc_code: string;
    base_unit: string;
    sub_unit: string;
    manufac_units: number;
    total_sub_units: number;
    conversion_factor: number;
    unit_price: number;
    cost_price: number;
    selling_price: number;
    mrp: number;
    qc_status: string;
    batch_number: string;
    warehouse_location: string;
    alert_threshold: number;
    mfg_date?: null;
    exp_date?: null;
    tax: { tax_name: string; tax_percentage: number }[];
};

const normalizeComparable = (value: unknown) => {
    if (Array.isArray(value)) return JSON.stringify(value);
    if (value === undefined || value === null) return "";
    return value;
};

const buildPatchPayload = (payload: InventoryPayload, initialData: any) => {
    const current: Partial<InventoryPayload> = {
        name: initialData?.name || "",
        code: initialData?.code || "",
        hsn_code: initialData?.hsn_code || "",
        uqc_code: initialData?.uqc_code || "NOS",
        base_unit: initialData?.base_unit || "PACK",
        sub_unit: initialData?.sub_unit || "UNIT",
        manufac_units: Number(initialData?.manufac_units ?? 1),
        total_sub_units: Number(initialData?.total_sub_units ?? 1),
        conversion_factor: Number(initialData?.conversion_factor ?? 1),
        unit_price: Number(initialData?.unit_price ?? 0),
        cost_price: Number(initialData?.cost_price ?? 0),
        selling_price: Number(initialData?.selling_price ?? 0),
        mrp: Number(initialData?.mrp ?? 0),
        qc_status: initialData?.qc_status || "Pending",
        batch_number: initialData?.batch_number || "",
        warehouse_location: initialData?.warehouse_location || "Main",
        alert_threshold: Number(initialData?.alert_threshold ?? 10),
        tax: initialData?.tax || [],
    };

    return Object.fromEntries(
        Object.entries(payload).filter(([key, value]) => {
            if (key === "mfg_date" || key === "exp_date") return false;
            const currentValue = current[key as keyof InventoryPayload];
            return normalizeComparable(value) !== normalizeComparable(currentValue);
        }),
    );
};

export function InventoryModal({ isOpen, onClose, onSuccess, initialData }: InventoryModalProps) {
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const fd = new FormData(e.currentTarget);
        try {
            const isEdit = !!initialData;
            const url = isEdit ? `/api/main/inventory/items/${initialData._id.$oid || initialData._id}` : "/api/main/inventory/items";
            const payload: InventoryPayload = {
                name: fd.get("name") as string,
                code: fd.get("code") as string,
                hsn_code: fd.get("hsn_code") as string,
                uqc_code: fd.get("uqc_code") as string,
                base_unit: fd.get("base_unit") as string,
                sub_unit: fd.get("sub_unit") as string,
                manufac_units: Math.round(Number(fd.get("manufac_units") || 1)),
                total_sub_units: Math.round(Number(fd.get("total_sub_units") || 1)),
                conversion_factor: Math.round(Number(fd.get("conversion_factor") || 1)),
                unit_price: Math.round(Number(fd.get("unit_price") || 0) * 100),
                cost_price: Math.round(Number(fd.get("cost_price") || 0) * 100),
                selling_price: Math.round(Number(fd.get("selling_price") || 0) * 100),
                mrp: Math.round(Number(fd.get("mrp") || 0) * 100),
                qc_status: fd.get("qc_status") as string || "Pending",
                batch_number: fd.get("batch_number") as string,
                warehouse_location: fd.get("warehouse_location") as string || "Main",
                alert_threshold: Math.round(Number(fd.get("alert_threshold") || 10)),
                mfg_date: null,
                exp_date: null,
                tax: fd.get("tax_name") ? [{ 
                    tax_name: fd.get("tax_name") as string, 
                    tax_percentage: Math.round(Number(fd.get("tax_percentage") || 0) * 100)
                }] : []
            };
            const requestPayload = isEdit ? buildPatchPayload(payload, initialData) : payload;

            if (isEdit && Object.keys(requestPayload).length === 0) {
                onSuccess?.();
                onClose();
                return;
            }
            
            const response = isEdit
                ? await axios.patch(url, requestPayload)
                : await axios.post(url, requestPayload);

            if (response.ok) {
                onSuccess?.();
                onClose();
            } else {
                const errData = response.data;
                alert(formatApiError(response, errData, "Failed to save item"));
            }
        } catch (error) {
            console.error("Error saving inventory item:", error);
            alert(error instanceof Error ? `Inventory save failed: ${error.message}` : "Inventory save failed. Make sure backend is running on port 3000.");
        } finally {
            setLoading(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 bg-slate-900/40  ">
            <div className="bg-white w-full max-w-5xl rounded shadow-sm border border-slate-300 overflow-hidden  max-h-[90vh] flex flex-col">
                <div className="p-3 border-b border-slate-200 flex justify-between items-center bg-white ">
                    <div>
                        <h3 className="text-xl font-bold tracking-tight text-slate-900">{initialData ? "Edit Inventory Item" : "New Inventory Item"}</h3>
                        <p className="text-slate-600 text-[16px] font-bold uppercase tracking-[0.14em] mt-1">Product Details</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded transition-colors text-slate-600 hover:text-slate-900">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-3 overflow-y-auto space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Product Name</label>
                            <input
                                required
                                name="name"
                                type="text"
                                defaultValue={initialData?.name}
                                placeholder="Product or item name"
                                className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Item Code</label>
                            <input
                                required
                                name="code"
                                type="text"
                                defaultValue={initialData?.code}
                                placeholder="Item code"
                                className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">HSN Code</label>
                            <input
                                required
                                name="hsn_code"
                                type="text"
                                defaultValue={initialData?.hsn_code}
                                className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">UQC Code</label>
                            <input
                                required
                                name="uqc_code"
                                defaultValue={initialData?.uqc_code || "NOS"}
                                type="text"
                                className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Batch No.</label>
                            <input
                                required
                                name="batch_number"
                                type="text"
                                defaultValue={initialData?.batch_number}
                                className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-5 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Base Unit</label>
                            <input
                                name="base_unit"
                                defaultValue={initialData?.base_unit || "PACK"}
                                type="text"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Sub Unit</label>
                            <input
                                name="sub_unit"
                                defaultValue={initialData?.sub_unit || "UNIT"}
                                type="text"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Conv. Factor</label>
                            <input
                                name="conversion_factor"
                                defaultValue={initialData?.conversion_factor || 1}
                                type="number"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Total Stock</label>
                            <input
                                name="total_sub_units"
                                defaultValue={initialData?.total_sub_units || 1}
                                type="number"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Threshold</label>
                            <input
                                name="alert_threshold"
                                defaultValue={initialData?.alert_threshold || 10}
                                type="number"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Unit Price (₹)</label>
                            <input
                                name="unit_price"
                                defaultValue={initialData?.unit_price ? initialData.unit_price / 100 : 0}
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Cost Price (₹)</label>
                            <input
                                name="cost_price"
                                defaultValue={initialData?.cost_price ? initialData.cost_price / 100 : 0}
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Selling Price (₹)</label>
                            <input
                                name="selling_price"
                                defaultValue={initialData?.selling_price ? initialData.selling_price / 100 : 0}
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">MRP (₹)</label>
                            <input
                                name="mrp"
                                defaultValue={initialData?.mrp ? initialData.mrp / 100 : 0}
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Warehouse Location</label>
                            <input
                                name="warehouse_location"
                                defaultValue={initialData?.warehouse_location || "Main"}
                                type="text"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">QC Status</label>
                            <select
                                name="qc_status"
                                defaultValue={initialData?.qc_status || "Pending"}
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold outline-none"
                            >
                                <option value="Pending">Pending</option>
                                <option value="Approved">Approved</option>
                                <option value="Rejected">Rejected</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Tax Name</label>
                            <input
                                name="tax_name"
                                placeholder="e.g. GST"
                                defaultValue={initialData?.tax?.[0]?.tax_name || ""}
                                type="text"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Tax Percentage (%)</label>
                            <input
                                name="tax_percentage"
                                defaultValue={initialData?.tax?.[0]?.tax_percentage ? initialData.tax[0].tax_percentage / 100 : 0}
                                type="number"
                                min="0"
                                max="100"
                                className="w-full bg-slate-50 border border-slate-300 rounded px-4 py-3 text-sm font-bold outline-none"
                            />
                        </div>
                    </div>

                    <div className="pt-6 flex gap-3 sticky bottom-0 bg-white pb-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 rounded text-[16px] font-bold uppercase tracking-[0.14em] text-slate-600 hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-300"
                        >
                            Dismiss
                        </button>
                        <button
                            disabled={loading}
                            type="submit"
                            className="flex-[2] rounded border border-slate-900 bg-slate-900 px-4 py-3 text-[16px] font-bold uppercase tracking-[0.14em] text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loading ? "Saving..." : initialData ? "Update Item" : "Add Item"}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
