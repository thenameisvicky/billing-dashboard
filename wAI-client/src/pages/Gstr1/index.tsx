import { useState } from "react";
import { ViewContainer } from "../../components/common/viewContainer";
import axios from "../../utils/axios";

const template = "invoice_number,invoice_date,due_date,customer_name,customer_phone,customer_gstin,billing_state,item_description,hsn_code,uqc,quantity,unit_price,taxable_value,gst_rate,cgst,sgst,igst,invoice_total\n";

export default function Gstr1Page() {
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [posSource, setPosSource] = useState("Nile Store POS");
  const [summary, setSummary] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [status, setStatus] = useState("");

  const downloadTemplate = () => {
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gstr1-pos-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file: File) => {
    setStatus("Previewing import");
    const content = await file.text();
    const response = await axios.post("/api/main/gstr1/imports/preview", {
      filename: file.name,
      content,
      return_period: period,
      external_system: posSource,
    });
    setSummary(response.data?.data || response.data);
    setStatus(response.ok ? "Preview ready" : "Preview failed");
  };

  const validate = async () => {
    setStatus("Validating");
    const response = await axios.post("/api/main/gstr1/validate", { period });
    setSummary(response.data);
    setStatus(response.ok ? "Validation complete" : "Validation failed");
  };

  const exportJson = async () => {
    setStatus("Exporting");
    const response = await axios.post("/api/main/gstr1/export", { period });
    setSummary(response.data);
    setStatus(response.ok ? "Export generated" : "Export failed");
    const historyResponse = await axios.get("/api/main/gstr1/export-history");
    if (historyResponse.data?.status === "success") setHistory(historyResponse.data.data || []);
  };

  return (
    <ViewContainer
      activeView={
        <div className="flex h-full flex-col gap-3 overflow-auto bg-slate-100 p-3">
          <div className="flex flex-wrap items-center gap-3 border border-slate-300 bg-white p-3">
            <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="h-10 rounded border border-slate-300 px-3 text-[16px] font-bold" />
            <select value={posSource} onChange={(event) => setPosSource(event.target.value)} className="h-10 rounded border border-slate-300 px-3 text-[16px] font-bold">
              <option>Nile Store POS</option>
              <option>Nile Factory POS</option>
            </select>
            <label className="inline-flex h-10 cursor-pointer items-center rounded border border-slate-900 bg-slate-900 px-4 text-[16px] font-bold text-white">
              Import POS Invoices
              <input type="file" accept=".csv" className="hidden" onChange={(event) => event.target.files?.[0] && readFile(event.target.files[0])} />
            </label>
            <button onClick={downloadTemplate} className="h-10 rounded border border-slate-300 bg-white px-4 text-[16px] font-bold">Download CSV Template</button>
            <button onClick={validate} className="h-10 rounded border border-slate-300 bg-white px-4 text-[16px] font-bold">Prepare GSTR-1</button>
            <button onClick={exportJson} className="h-10 rounded border border-emerald-700 bg-emerald-600 px-4 text-[16px] font-bold text-white">Export JSON</button>
          </div>
          <div className="grid min-h-[240px] grid-cols-1 gap-3 lg:grid-cols-2">
            <section className="border border-slate-300 bg-white p-3">
              <h2 className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-800">Validation summary</h2>
              <p className="mt-2 text-[16px] font-bold text-slate-700">{status || "No import or validation run yet"}</p>
              <pre className="mt-3 max-h-[420px] overflow-auto bg-slate-50 p-3 text-[13px] font-semibold text-slate-700">{summary ? JSON.stringify(summary, null, 2) : "Awaiting data"}</pre>
            </section>
            <section className="border border-slate-300 bg-white p-3">
              <h2 className="text-[16px] font-bold uppercase tracking-[0.14em] text-slate-800">Export history</h2>
              <div className="mt-3 space-y-2">
                {history.length === 0 ? <p className="text-[16px] font-semibold text-slate-500">No export history loaded</p> : history.map((item) => (
                  <div key={item._id?.$oid || item._id} className="border border-slate-200 bg-slate-50 p-2 text-[16px] font-semibold">
                    {item.period} · {item.invoice_count} invoices
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      }
    />
  );
}
