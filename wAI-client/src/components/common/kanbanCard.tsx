export function KanbanCard({ title }: any) {
    return (
        <div className="group shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-3 hover:border-emerald-200">
            <div className="flex justify-between items-start mb-3">
                <div className="flex flex-col">
                    <span className="text-[16px] font-bold text-slate-600 uppercase tracking-wider mb-1">Invoice</span>
                    <h3 className="text-sm font-bold text-slate-900 group-hover:text-emerald-700">{title}</h3>
                </div>
                <div className="h-2 w-2 border border-blue-600 bg-blue-500" />
            </div>
            <div className="flex justify-between items-end mt-4">
                <div className="h-3 w-28 bg-slate-200 opacity-70" />
                <div className="h-3 w-16 bg-slate-200 opacity-70" />
            </div>
        </div>
    );
}
