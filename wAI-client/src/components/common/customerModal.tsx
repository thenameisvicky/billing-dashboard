import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import axios, { formatApiError } from "../../utils/axios";

const STATE_CODES: Record<string, string> = {
    "01": "Jammu & Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra & Nagar Haveli and Daman & Diu",
    "27": "Maharashtra",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman & Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh"
};

const STATE_NAMES = Object.values(STATE_CODES);
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

interface CustomerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    initialData?: any;
}

export function CustomerModal({ isOpen, onClose, onSuccess, initialData }: CustomerModalProps) {
    const [type, setType] = useState(initialData?.customer_type || "Individual");
    const [gstin, setGstin] = useState(initialData?.gstin || "");
    const [billingState, setBillingState] = useState(initialData?.billing_state === "N/A" ? "" : initialData?.billing_state || "");
    const [gstStateName, setGstStateName] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (gstin.length >= 2) {
            const code = gstin.substring(0, 2);
            const derivedState = STATE_CODES[code] || "Invalid Code";
            setGstStateName(derivedState);
            if (derivedState !== "Invalid Code") {
                setBillingState(derivedState);
            }
        } else {
            setGstStateName("");
        }
    }, [gstin]);

    if (!isOpen) return null;
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const fd = new FormData(e.currentTarget);
        const normalizedGstin = gstin.trim().toUpperCase();
        if (!billingState.trim() || billingState === "N/A") {
            alert("Billing state is required");
            setLoading(false);
            return;
        }
        if (type === "Business" && !GSTIN_PATTERN.test(normalizedGstin)) {
            alert("Invalid customer GSTIN format");
            setLoading(false);
            return;
        }
        try {
            const isEdit = !!initialData;
            const url = isEdit ? `/api/main/customers/${initialData._id.$oid || initialData._id}` : "/api/main/customers";
            const payload = {
                name: fd.get("name") as string,
                phone: fd.get("mobile") as string,
                email: fd.get("email") as string,
                customer_type: type,
                gstin: type === "Business" ? normalizedGstin : null,
                billing_state: billingState.trim(),
                address: fd.get("address") as string || null,
                notes: fd.get("notes") as string || null     
            };
            
            const response = isEdit
                ? await axios.patch(url, payload)
                : await axios.post(url, payload);

            if (response.ok) {
                onSuccess?.();
                onClose();
            } else {
                const errData = response.data;
                alert(formatApiError(response, errData, initialData ? "Failed to update customer" : "Failed to create customer"));
            }
        } catch (error) {
            console.error("Error creating customer:", error);
            alert(error instanceof Error ? `Customer save failed: ${error.message}` : "Customer save failed. Make sure backend is running on port 3000.");
        } finally {
            setLoading(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 bg-slate-900/40  ">
            <div className="bg-white w-full max-w-5xl rounded shadow-sm border border-slate-300 overflow-hidden ">
                <div className="p-3 border-b border-slate-200 flex justify-between items-center bg-white  sticky top-0 md:relative">
                    <div>
                        <h3 className="text-xl font-bold tracking-tight text-slate-900">{initialData ? "Edit Customer" : "New Customer"}</h3>
                        <p className="text-slate-600 text-[16px] font-bold uppercase tracking-[0.14em] mt-1">Customer Details</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded transition-colors text-slate-600 hover:text-slate-900">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-3 space-y-5">
                    <div className="space-y-1.5">
                        <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Full Name</label>
                        <input
                            required
                            name="name"
                            type="text"
                            defaultValue={initialData?.name}
                            placeholder="Customer legal name"
                            className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Mobile</label>
                            <input
                                required
                                name="mobile"
                                type="tel"
                                defaultValue={initialData?.phone}
                                placeholder="+91 00000 00000"
                                className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Email</label>
                            <input
                                required
                                name="email"
                                type="email"
                                defaultValue={initialData?.email}
                                placeholder="name@company.com"
                                className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Address</label>
                        <input
                            name="address"
                            type="text"
                            defaultValue={initialData?.address}
                            placeholder="Registered billing address"
                            className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Customer Type</label>
                        <div className="flex bg-slate-100 p-1 rounded border border-slate-200/50">
                            <button
                                type="button"
                                onClick={() => setType('Individual')}
                                className={`flex-1 py-2.5 rounded text-xs font-bold uppercase tracking-[0.14em] transition-colors ${type === 'Individual' ? 'bg-white text-emerald-600 shadow-sm border border-emerald-100' : 'text-slate-600 hover:text-slate-600'}`}
                            >
                                Individual
                            </button>
                            <button
                                type="button"
                                onClick={() => setType('Business')}
                                className={`flex-1 py-2.5 rounded text-xs font-bold uppercase tracking-[0.14em] transition-colors ${type === 'Business' ? 'bg-white text-emerald-600 shadow-sm border border-emerald-100' : 'text-slate-600 hover:text-slate-600'}`}
                            >
                                Business
                            </button>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Billing State</label>
                        <select
                            required
                            value={billingState}
                            onChange={(e) => setBillingState(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold"
                        >
                            <option value="">Select billing state</option>
                            {STATE_NAMES.map((state) => (
                                <option key={state} value={state}>{state}</option>
                            ))}
                        </select>
                    </div>

                    {type === 'Business' && (
                        <div className="space-y-1.5">
                            <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">GSTIN Pin</label>
                            <div className="relative">
                                <input
                                    required
                                    type="text"
                                    maxLength={15}
                                    pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]"
                                    title="Enter a valid 15-character GSTIN, e.g. 22AAAAA0000A1Z5"
                                    placeholder="22AAAAA0000A1Z5"
                                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold uppercase tracking-[0.05em] placeholder:text-slate-200"
                                    value={gstin}
                                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                                />
                                {gstStateName && (
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-3">
                                        <div className="h-5 w-[1.5px] bg-slate-200" />
                                        <span className={`text-[16px] font-bold uppercase tracking-[0.14em] ${gstStateName === 'Invalid Code' ? 'text-rose-500' : 'text-emerald-600'}`}>
                                            {gstStateName}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <label className="text-[16px] font-bold text-slate-600 uppercase tracking-[0.14em] ml-1">Notes</label>
                        <textarea
                            name="notes"
                            defaultValue={initialData?.notes}
                            placeholder="Additional details..."
                            className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/5 rounded px-4 py-3 text-sm transition-colors outline-none font-bold placeholder:text-slate-500 resize-none h-20"
                        />
                    </div>

                    <div className="pt-6 flex gap-3">
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
                            {loading ? "Saving..." : initialData ? "Update Customer" : "Add Customer"}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
