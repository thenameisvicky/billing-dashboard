import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import axios, { formatApiError } from "../../utils/axios";

interface TaxRate { tax_name: string; tax_percentage: number; }
interface InventoryItem {
    _id: string; name: string; code: string; hsn_code: string;
    base_unit: string; sub_unit: string; total_sub_units: number;
    selling_price?: number;
    selling_price_minor?: number;
    unit_price?: number;
    tax: TaxRate[];
}
interface Customer { _id: any; name: string; gstin: string; customer_type: string; billing_state: string; }
interface SelectedItem {
    inventory_id: string; item_name: string; quantity: number;
    unit_price_paise: number; tax_details: TaxRate[]; hsn_code: string; unit: string;
}
interface Props { isOpen: boolean; onClose: () => void; onSuccess?: () => void; initialData?: any; }

const fromPaise = (p: number) => (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const getId = (id: any) => typeof id === 'object' ? id.$oid ?? String(id) : String(id);
const getInvoiceId = (invoice: any) => invoice?.invoice_tnx_id || getId(invoice?._id);

export function InvoiceModal({ isOpen, onClose, onSuccess, initialData }: Props) {
    const [step, setStep] = useState(1);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
    const [discount, setDiscount] = useState(0);
    const [placeOfSupply, setPlaceOfSupply] = useState("Intra-state");
    const [invoiceType, setInvoiceType] = useState("Tax Invoice");
    const [dueDate, setDueDate] = useState("");
    const [customerGst, setCustomerGst] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const versionNumber = Number(initialData?.version_number ?? 0);
    const hasVersionWarning = Boolean(initialData) && versionNumber > 3 && versionNumber < 5;
    const isVersionBlocked = Boolean(initialData) && versionNumber >= 5;

    const fetchData = useCallback(async () => {
        const [cr, ir] = await Promise.all([
            axios.get("/api/main/customers"),
            axios.get("/api/main/inventory/items")
        ]);
        const cd = cr.data; const id = ir.data;
        if (cd?.status === "success") setCustomers(cd.data);
        if (id?.status === "success") setInventory(id.data);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setError("");
            if (initialData) {
                setPlaceOfSupply(initialData.place_of_supply || "Intra-state");
                setInvoiceType(initialData.invoice_type || "Tax Invoice");
                setCustomerGst(initialData.customer_gst || "");
                if (initialData.due_date) {
                    const dd = initialData.due_date.$date ? new Date(Number(initialData.due_date.$date.$numberLong || initialData.due_date.$date)) : new Date(initialData.due_date);
                    setDueDate(dd.toISOString().split('T')[0]);
                } else {
                    setDueDate("");
                }
                setDiscount(Number(initialData.discount_percentage || 0));
            } else {
                setSelectedCustomer(null);
                setSelectedItems([]);
                setDiscount(0);
                setPlaceOfSupply("Intra-state");
                setInvoiceType("Tax Invoice");
                setDueDate("");
                setCustomerGst("");
            }
            fetchData();
        }
    }, [isOpen, fetchData, initialData]);

    // Second effect to map customers and inventory when they are fetched
    useEffect(() => {
        if (isOpen && initialData && customers.length > 0 && inventory.length > 0) {
            const cid = getId(initialData.customer_id);
            const cust = customers.find(c => getId(c._id) === cid);
            if (cust) setSelectedCustomer(cust);

            if (initialData.items && initialData.items.length > 0 && selectedItems.length === 0) {
                const mappedItems: SelectedItem[] = initialData.items.map((it: any) => {
                    const invItem = inventory.find(i => getId(i._id) === getId(it.inventory_id));
                    return {
                        inventory_id: getId(it.inventory_id),
                        item_name: invItem?.name || "Unknown Item",
                        quantity: it.quantity,
                        unit_price_paise: it.unit_price,
                        tax_details: it.tax_details || [],
                        hsn_code: it.hsn_code || invItem?.hsn_code || "",
                        unit: it.unit || invItem?.sub_unit || "NOS"
                    };
                });
                setSelectedItems(mappedItems);
            }
        }
    }, [customers, inventory, isOpen, initialData]);

    useEffect(() => {
        if (selectedCustomer) {
            setCustomerGst(selectedCustomer.gstin || "");
        }
    }, [selectedCustomer]);

    const filtered = inventory.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.code.toLowerCase().includes(search.toLowerCase()));

    const itemPrice = (item: InventoryItem) => Number(item.selling_price ?? item.selling_price_minor ?? item.unit_price ?? 0);

    const addItem = (item: InventoryItem) => {
        if (item.total_sub_units <= 0) { alert("Out of stock"); return; }
        const itemId = getId(item._id);
        const ex = selectedItems.find(s => s.inventory_id === itemId);
        if (ex) {
            setSelectedItems(p => p.map(s => s.inventory_id === itemId ? { ...s, quantity: s.quantity + 1 } : s));
        } else {
            setSelectedItems(p => [...p, { inventory_id: itemId, item_name: item.name, quantity: 1, unit_price_paise: itemPrice(item), tax_details: item.tax || [], hsn_code: item.hsn_code, unit: item.sub_unit || item.base_unit }]);
        }
        setInventory(p => p.map(i => getId(i._id) === itemId ? { ...i, total_sub_units: i.total_sub_units - 1 } : i));
    };

    const removeItem = (id: string) => {
        const item = selectedItems.find(s => s.inventory_id === id);
        if (!item) return;
        setSelectedItems(p => p.filter(s => s.inventory_id !== id));
        setInventory(p => p.map(i => i._id === id ? { ...i, total_sub_units: i.total_sub_units + item.quantity } : i));
    };

    const totals = useMemo(() => {
        let sub = 0, tax = 0;
        const breakdown: Record<string, number> = {};
        selectedItems.forEach(item => {
            const line = Math.round(item.quantity * item.unit_price_paise);
            sub += line;
            item.tax_details.forEach(t => {
                const ta = Math.floor((line * t.tax_percentage) / 10000);
                tax += ta;
                breakdown[t.tax_name] = (breakdown[t.tax_name] || 0) + ta;
            });
        });
        const disc = Math.round(sub * discount / 100);
        const netSub = sub - disc;
        return { sub, netSub, tax, breakdown, disc, grand: netSub + tax };
    }, [selectedItems, discount]);

    const submit = async (mode: "draft" | "issue" | "send") => {
        if (!selectedCustomer || selectedItems.length === 0) return;
        if (isVersionBlocked) { setError("Invoice has reached version 5 and can no longer be updated."); return; }
        if (totals.grand < 0) { setError("Grand total cannot be negative"); return; }
            setLoading(true); setError("");
        try {
            const isEdit = !!initialData;
            const url = isEdit ? `/api/main/invoice/${getInvoiceId(initialData)}` : "/api/main/invoice";
            const payload = {
                customer_id: getId(selectedCustomer._id),
                place_of_supply: placeOfSupply,
                items: selectedItems.map(s => ({ inventory_id: getId(s.inventory_id), quantity: s.quantity, unit: s.unit, unit_price: s.unit_price_paise, tax_details: s.tax_details, hsn_code: s.hsn_code })),
                customer_gst: selectedCustomer.customer_type === 'Business' ? (customerGst || "N/A") : "N/A",
                invoice_type: invoiceType,
                total_amount: totals.netSub,
                total_tax_amount: totals.tax,
                discount_amount: totals.disc,
                discount_percentage: Math.round(discount),
                grand_total: totals.grand,
                due_date: dueDate ? { $date: new Date(dueDate).toISOString() } : null
            };
            const res = isEdit
                ? await axios.patch(url, payload)
                : await axios.post(url, payload);
            const data = res.data;
            if (res.ok && data?.status === "success") {
                const invoiceId = data.invoice_tnx_id || getInvoiceId(initialData);
                if (mode === "issue") {
                    const issueResponse = await axios.post(`/api/main/invoice/${invoiceId}/issue`, { issue_method: "POS_MANUAL" });
                    if (!issueResponse.ok) {
                        setError(issueResponse.data?.message || "Invoice saved but issue failed");
                        return;
                    }
                }
                if (mode === "send") {
                    const sendResponse = await axios.post(`/api/main/invoice/${invoiceId}/send-whatsapp`);
                    if (!sendResponse.ok) {
                        setError(sendResponse.data?.data?.reason || sendResponse.data?.message || "Invoice saved but WhatsApp send failed");
                        return;
                    }
                }
                onSuccess?.(); onClose();
            }
            else setError(formatApiError(res, data, "Failed to save invoice"));
        } catch (error) {
            setError(error instanceof Error ? `Invoice save failed: ${error.message}` : "Invoice save failed. Make sure backend is running on port 3000.");
        }
        finally { setLoading(false); }
    };

    if (!isOpen) return null;

    const steps = ["Customer", "Items", "Details", "Review"];

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70  p-3">
            <div className="bg-white w-full max-w-5xl rounded shadow-sm overflow-hidden flex flex-col" style={{ height: '88vh' }}>

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-300">
                    <div className="flex items-center gap-3">
                        <div>
                            <p className="text-[16px] font-bold uppercase tracking-[0.3em] text-emerald-500">{initialData ? 'Edit Invoice' : 'New Invoice'}</p>
                            <h2 className="text-xl font-bold text-slate-900 mt-0.5">{initialData ? `Invoice ${initialData.invoice_number || initialData.invoice_tnx_id.substring(0,8)}` : 'Generate Invoice'}</h2>
                        </div>
                        {/* Step pills */}
                        <div className="flex items-center gap-1 bg-slate-50 rounded p-1">
                            {steps.map((s, i) => (
                                <button key={i} onClick={() => i + 1 < step && setStep(i + 1)}
                                    className={`px-4 py-2 rounded text-[16px] font-bold uppercase tracking-wider transition-colors ${step === i + 1 ? 'bg-slate-900 text-white shadow-sm' : step > i + 1 ? 'text-emerald-600 hover:bg-emerald-50 cursor-pointer' : 'text-slate-500 cursor-not-allowed'}`}>
                                    {i + 1}. {s}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                </div>

                {/* Body */}
                <div className="flex flex-1 overflow-hidden">

                    {/* Sidebar */}
                    <div className="w-64 bg-slate-50 border-r border-slate-300 flex flex-col p-3 gap-3 shrink-0">
                        {selectedCustomer && (
                            <div>
                                <p className="text-[16px] font-bold uppercase tracking-[0.3em] text-slate-700 mb-2">Billing To</p>
                                <p className="text-slate-900 font-bold text-sm">{selectedCustomer.name}</p>
                                <p className="text-slate-600 text-[16px] mt-0.5">{selectedCustomer.gstin || 'No GSTIN'}</p>
                                <p className="text-slate-600 text-[16px] mt-0.5">{selectedCustomer.billing_state || 'No billing state'}</p>
                            </div>
                        )}

                        {selectedItems.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="text-[16px] font-bold uppercase tracking-[0.3em] text-slate-700 mb-3">Line Items</p>
                                {selectedItems.map(s => (
                                    <div key={s.inventory_id} className="flex justify-between text-[16px]">
                                        <span className="text-slate-700 truncate max-w-[110px]">{s.item_name} ×{s.quantity}</span>
                                        <span className="text-slate-900 font-bold">₹{fromPaise(Math.round(s.quantity * s.unit_price_paise))}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Totals */}
                        {selectedItems.length > 0 && (
                            <div className="mt-auto bg-white rounded p-3 space-y-3 border border-slate-300 shadow-sm">
                                <div className="flex justify-between text-[16px]">
                                    <span className="text-slate-700">Subtotal</span>
                                    <span className="text-slate-900 font-bold">₹{fromPaise(totals.sub)}</span>
                                </div>
                                <div className="flex justify-between text-[16px]">
                                    <span className="text-slate-700">Tax</span>
                                    <span className="text-slate-900 font-bold">₹{fromPaise(totals.tax)}</span>
                                </div>
                                {totals.disc > 0 && (
                                    <div className="flex justify-between text-[16px]">
                                        <span className="text-rose-400">Discount</span>
                                        <span className="text-rose-500 font-bold">-₹{fromPaise(totals.disc)}</span>
                                    </div>
                                )}
                                <div className="pt-3 border-t border-slate-300 flex justify-between items-center">
                                    <span className="text-[16px] font-bold uppercase tracking-[0.14em] text-emerald-500">Grand Total</span>
                                    <span className="text-xl font-bold text-slate-900">₹{fromPaise(totals.grand)}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Main */}
                    <div className="flex-1 overflow-y-auto p-3">

                        {/* Step 1 — Customer */}
                        {step === 1 && (
                            <div className="space-y-3">
                                <div>
                                    <h3 className="text-2xl font-bold text-slate-900">Select Customer</h3>
                                    <p className="text-slate-600 text-sm mt-1">Choose the entity to bill for this invoice.</p>
                                </div>
                                {customers.length === 0 ? (
                                    <div className="flex items-center gap-3 border border-slate-300 bg-slate-50 p-3">
                                        <div className="h-3 w-3 border border-emerald-600 bg-emerald-50" />
                                        <span className="text-slate-600 text-sm font-bold">Loading customers...</span>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-3">
                                        {customers.map(c => {
                                            const cid = getId(c._id);
                                            const sel = selectedCustomer && getId(selectedCustomer._id) === cid;
                                            return (
                                                <button key={cid} onClick={() => { setSelectedCustomer(c); setStep(2); }}
                                                    className={`group border-2 p-3 text-left ${sel ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-white hover:border-slate-300'}`}>
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="font-bold text-slate-900">{c.name}</p>
                                                            <p className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] mt-1">{c.customer_type}</p>
                                                            <p className="text-[16px] font-mono text-slate-600 mt-0.5">{c.gstin || '—'}</p>
                                                            <p className="text-[16px] font-bold text-slate-600 mt-0.5">{c.billing_state || 'No billing state'}</p>
                                                        </div>
                                                        <div className={`flex h-8 w-8 items-center justify-center ${sel ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'}`}>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Step 2 — Items */}
                        {step === 2 && (
                            <div className="space-y-3">
                                <div className="flex items-end justify-between">
                                    <div>
                                        <h3 className="text-2xl font-bold text-slate-900">Add Items</h3>
                                        <p className="text-slate-600 text-sm mt-1">Select products from your inventory.</p>
                                    </div>
                                    <div className="relative">
                                        <input type="text" placeholder="Search..." defaultValue={search} 
                                            onChange={e => {
                                                const v = e.target.value;
                                                clearTimeout((window as any).searchTimeout);
                                                (window as any).searchTimeout = setTimeout(() => setSearch(v), 250);
                                            }}
                                            className="w-64 bg-slate-100 rounded px-5 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 placeholder:text-slate-600"/>
                                        <svg className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                                    </div>
                                </div>

                                {/* Inventory Grid */}
                                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                                    {filtered.length === 0 && <p className="py-4 text-center text-[16px] font-semibold text-slate-400 opacity-70">No items found</p>}
                                    {filtered.map(item => {
                                        const itemId = getId(item._id);
                                        const sel = selectedItems.find(s => s.inventory_id === itemId);
                                        const outOfStock = item.total_sub_units <= 0;
                                        return (
                                            <div key={itemId} className={`flex items-center justify-between border p-3 ${sel ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-300 bg-slate-100 hover:border-slate-200 hover:bg-white'}`}>
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded bg-slate-900 text-white flex items-center justify-center text-xs font-bold">
                                                        {item.code.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-slate-900 text-sm">{item.name}</p>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                        <span className={`border px-2 py-0.5 text-[16px] font-bold ${outOfStock ? 'border-rose-200 bg-rose-50 text-rose-500' : 'border-slate-200 bg-slate-100 text-slate-700'}`}>
                                                                {outOfStock ? 'OUT OF STOCK' : `${item.total_sub_units} ${item.sub_unit}`}
                                                            </span>
                                                            <span className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[16px] font-bold text-emerald-700">
                                                                ₹{fromPaise(itemPrice(item))}/{item.sub_unit || item.base_unit}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {sel && <span className="border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[16px] font-bold text-emerald-700">×{sel.quantity}</span>}
                                                    <button onClick={() => addItem(item)} disabled={outOfStock}
                                                        className="rounded border border-slate-900 bg-slate-900 px-4 py-2 text-[16px] font-bold uppercase tracking-wider text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-30">
                                                        {sel ? '+ More' : 'Add'}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Selected Items Summary */}
                                {selectedItems.length > 0 && (
                                    <div className="border-t border-slate-300 pt-6">
                                        <h4 className="font-bold text-slate-900 mb-3">Selected ({selectedItems.length})</h4>
                                        <div className="space-y-2">
                                            {selectedItems.map(s => (
                                                <div key={s.inventory_id} className="group flex items-center justify-between border border-slate-200 bg-slate-50 p-3">
                                                    <div className="flex items-center gap-3">
                                                        <span className="flex h-7 w-7 items-center justify-center bg-emerald-600 text-xs font-bold text-white">{s.quantity}</span>
                                                        <div>
                                                            <p className="text-sm font-bold text-slate-900">{s.item_name}</p>
                                                            <p className="text-[16px] text-slate-600 font-bold">₹{fromPaise(s.unit_price_paise)} × {s.quantity} = ₹{fromPaise(Math.round(s.quantity * s.unit_price_paise))}</p>
                                                        </div>
                                                    </div>
                                                    <button onClick={() => removeItem(s.inventory_id)} className="border border-transparent p-1.5 text-slate-500 opacity-0 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Step 3 — Details */}
                        {step === 3 && (
                            <div className="space-y-3">
                                <div>
                                    <h3 className="text-2xl font-bold text-slate-900">Invoice Details</h3>
                                    <p className="text-slate-600 text-sm mt-1">Provide additional information for this invoice.</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Invoice Type</label>
                                        <input type="text" value={invoiceType} onChange={e => setInvoiceType(e.target.value)} placeholder="e.g. Tax Invoice" className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500"/>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Place of Supply</label>
                                        <input type="text" value={placeOfSupply} onChange={e => setPlaceOfSupply(e.target.value)} placeholder="e.g. Intra-state" className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500"/>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Due Date</label>
                                        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold text-slate-600"/>
                                    </div>
                                    {selectedCustomer?.customer_type === 'Business' && (
                                        <div className="space-y-1.5">
                                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Customer GST</label>
                                            <input type="text" value={customerGst} onChange={e => setCustomerGst(e.target.value.toUpperCase())} placeholder="Customer GST Number" className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500"/>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Step 4 — Review */}
                        {step === 4 && (
                            <div className="space-y-3">
                                <div>
                                    <h3 className="text-2xl font-bold text-slate-900">Review & Finalize</h3>
                                    <p className="text-slate-600 text-sm mt-1">Confirm totals before generating the invoice.</p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    {/* Tax Breakdown */}
                                    <div className="space-y-3">
                                        <div className="bg-slate-50 rounded p-3 space-y-3">
                                            <p className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-600">Tax Breakdown</p>
                                            {Object.entries(totals.breakdown).length === 0 ? (
                                                <p className="text-slate-500 italic text-sm">No taxes applicable</p>
                                            ) : (
                                                Object.entries(totals.breakdown).map(([name, amt]) => {
                                                    const taxDetails = selectedItems.flatMap(i => i.tax_details).find(t => t.tax_name === name);
                                                    const pctDisplay = taxDetails ? ` (${taxDetails.tax_percentage / 100}%)` : '';
                                                    return (
                                                        <div key={name} className="flex justify-between text-sm">
                                                            <span className="font-bold text-slate-600">{name}{pctDisplay}</span>
                                                            <span className="font-bold text-slate-900">₹{fromPaise(amt)}</span>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>

                                        <div>
                                            <label className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-600 block mb-2">Discount (%)</label>
                                            <input type="number" min="0" max="100" defaultValue={discount}
                                                onChange={e => {
                                                    const v = e.target.value;
                                                    clearTimeout((window as any).discountTimeout);
                                                    (window as any).discountTimeout = setTimeout(() => {
                                                        setDiscount(Math.min(100, Math.max(0, Number(v) || 0)));
                                                    }, 250);
                                                }}
                                                className="w-full bg-slate-100 rounded px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"/>
                                        </div>
                                    </div>

                                    {/* Invoice Summary */}
                                    <div className="bg-slate-50 border border-slate-300 rounded p-3 text-slate-900 space-y-3">
                                        <p className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-600">Invoice Summary</p>
                                        {selectedCustomer && (
                                            <div className="pb-4 border-b border-slate-200">
                                                <p className="text-slate-700 text-[16px]">Customer</p>
                                                <p className="font-bold text-slate-900">{selectedCustomer.name}</p>
                                            </div>
                                        )}
                                        <div className="space-y-3">
                                            {[
                                                { label: 'Subtotal', value: totals.sub },
                                                { label: 'Tax Total', value: totals.tax },
                                            ].map(({ label, value }) => (
                                                <div key={label} className="flex justify-between text-sm">
                                                    <span className="text-slate-700">{label}</span>
                                                    <span className="font-bold text-slate-900">₹{fromPaise(value)}</span>
                                                </div>
                                            ))}
                                            {totals.disc > 0 && (
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-rose-400">Discount ({discount}%)</span>
                                                    <span className="font-bold text-rose-500">-₹{fromPaise(totals.disc)}</span>
                                                </div>
                                            )}
                                        </div>
                                        {hasVersionWarning && (
                                            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
                                                This invoice is on version {versionNumber}. Updates are blocked once version 5 is reached.
                                            </div>
                                        )}
                                        {isVersionBlocked && (
                                            <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
                                                This invoice has reached version 5 and can no longer be updated.
                                            </div>
                                        )}
                                        <div className="pt-4 border-t border-slate-200">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[16px] font-bold uppercase tracking-[0.14em] text-emerald-500">Grand Total</span>
                                                <span className="text-3xl font-bold text-slate-900">₹{fromPaise(totals.grand)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {error && (
                                    <div className="p-3 rounded bg-rose-50 border border-rose-100 text-rose-600 text-sm font-bold">
                                        ⚠ {error}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-slate-300 flex items-center justify-between bg-white">
                    <button onClick={() => step > 1 ? setStep(step - 1) : onClose()}
                        className="px-6 py-3 rounded text-sm font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                        {step === 1 ? 'Cancel' : '← Back'}
                    </button>

                    <div className="flex items-center gap-2">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className={`h-1.5 ${step === i ? 'w-6 bg-emerald-600' : step > i ? 'w-3 bg-emerald-300' : 'w-3 bg-slate-200'}`}/>
                        ))}
                    </div>

                    {step < 4 ? (
                        <button
                            disabled={(step === 1 && !selectedCustomer) || (step === 2 && selectedItems.length === 0)}
                            onClick={() => setStep(step + 1)}
                            className="rounded border border-slate-900 bg-slate-900 px-8 py-3 text-sm font-bold uppercase tracking-wider text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-30">
                            Continue →
                        </button>
                    ) : (
                        <>
                        <button disabled={loading || isVersionBlocked} onClick={() => submit("draft")}
                            className="rounded border border-slate-300 bg-white px-5 py-3 text-sm font-bold uppercase tracking-wider text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                            {loading ? 'Saving...' : (initialData ? 'Update Draft' : 'Save Draft')}
                        </button>
                        <button disabled={loading || isVersionBlocked} onClick={() => submit("issue")}
                            className="rounded border border-slate-900 bg-slate-900 px-5 py-3 text-sm font-bold uppercase tracking-wider text-white hover:bg-emerald-700 disabled:opacity-60">
                            Issue Without Sending
                        </button>
                        <button disabled={loading || isVersionBlocked} onClick={() => submit("send")}
                            className="rounded border border-emerald-700 bg-emerald-600 px-5 py-3 text-sm font-bold uppercase tracking-wider text-white hover:bg-emerald-700 disabled:opacity-60">
                            Issue & Send via WhatsApp
                        </button>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
