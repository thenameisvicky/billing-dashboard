import { KanbanCard } from "./kanbanCard";
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

interface KanbanColumn {
    title: string;
    cards: string[];
}

interface KanbanData {
    columns: KanbanColumn[];
    insights?: {
        graphData: any[];
        livePayments: { amount: string; from: string; time: string }[];
        aiSuggestions: { text: string; priority: "HIGH" | "MED" | "LOW" }[];
    };
}

interface KanbanBoardProps {
    data: KanbanData;
    viewType?: string;
}

export function KanbanBoard({ data }: KanbanBoardProps) {
    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex gap-3 h-full items-start overflow-x-auto hide-scrollbar pb-4">
                {data.columns.map((col) => (
                    <div key={col.title} className="flex-1 min-w-[280px] max-w-[400px] flex flex-col h-full shrink-0">
                        <div className="flex h-full flex-col border border-gray-400 bg-gray-50/40 p-3">
                            <div className="flex items-center justify-between mb-4 px-2">
                                <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-gray-900">{col.title}</h2>
                                <span className="text-sm font-bold text-gray-500">{col.cards.length}</span>
                            </div>
                            <div className="flex-1 space-y-3 overflow-y-auto px-1 pr-2 hide-scrollbar">
                                {col.cards.length === 0 ? (
                                    <div className="space-y-3 opacity-50">
                                        {[0, 1, 2].map((item) => (
                                            <div key={item} className="p-3">
                                                <div className="h-4 w-1/2 bg-slate-300" />
                                                <div className="mt-3 h-3 w-3/4 bg-slate-200" />
                                            </div>
                                        ))}
                                    </div>
                                ) : col.cards.map((card, i) => (
                                    <KanbanCard key={i} title={card} />
                                ))}
                            </div>
                        </div>
                    </div>
                ))}

                {data.insights && (
                    <div className="flex h-full min-w-[280px] max-w-[400px] flex-1 shrink-0 flex-col border border-gray-400 bg-white p-3">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex flex-col">
                                <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-gray-900">Insights</h2>
                                <p className="text-[16px] text-slate-700 font-bold">Operational signals</p>
                            </div>
                            <div className="group relative">
                                <div className="flex h-5 w-5 cursor-help items-center justify-center border border-slate-700 text-xs text-slate-700">?</div>
                                <div className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 w-48 border border-slate-300 bg-white p-3 text-xs font-medium text-slate-900 opacity-0 group-hover:opacity-100">
                                    Live records will populate operational trends and exception tasks.
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-3 hide-scrollbar">
                            <div className="border border-slate-700/50 p-3">
                                <span className="text-xs font-bold text-slate-700 uppercase tracking-[0.14em]">Payment Velocity</span>
                                <div className="h-24 w-full mt-3">
                                    {data.insights.graphData.length === 0 ? (
                                        <div className="flex h-full items-center justify-center text-[16px] font-bold uppercase tracking-[0.12em] text-slate-400 opacity-70">
                                            Trend Placeholder
                                        </div>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={data.insights.graphData}>
                                                <defs>
                                                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <Area type="monotone" dataKey="count" stroke="#10b981" fillOpacity={1} fill="url(#colorCount)" strokeWidth={3} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2 px-1">
                                    <div className="h-2 w-2 border border-emerald-600 bg-emerald-500" />
                                    <span className="text-[16px] font-bold text-slate-700 uppercase">Live Payments</span>
                                </div>
                                <div className="space-y-2">
                                    {data.insights.livePayments.length === 0 ? (
                                        <div className="p-3 opacity-50">
                                            <div className="h-3 w-2/3 bg-slate-300" />
                                        </div>
                                    ) : data.insights.livePayments.map((p, i) => (
                                        <div key={i} className="group flex cursor-default items-center justify-between border border-slate-300 p-3">
                                            <span className="text-sm font-bold text-gray-900">
                                                + {p.amount} <span className="text-slate-700 font-medium text-[16px]">from {p.from}</span>
                                            </span>
                                            <span className="text-[16px] text-slate-600 font-bold italic">{p.time}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <span className="text-[16px] font-bold text-slate-700 uppercase tracking-[0.14em] px-1">Operational Alerts</span>
                                <div className="space-y-2">
                                    {data.insights.aiSuggestions.length === 0 ? (
                                        <div className="p-3 opacity-50">
                                            <div className="h-3 w-3/4 bg-slate-300" />
                                        </div>
                                    ) : data.insights.aiSuggestions.map((s, i) => (
                                        <div key={i} className={`group cursor-pointer border p-3 ${s.priority === "HIGH" ? "bg-emerald-500/10 border-emerald-500/20" : "bg-blue-500/10 border-blue-500/20"
                                            }`}>
                                            <div className="flex justify-between items-center">
                                                <span className={`text-xs font-bold ${s.priority === "HIGH" ? "text-emerald-600" : "text-blue-600"}`}>
                                                    {s.text}
                                                </span>
                                                <div className={`border px-2 py-0.5 text-[16px] font-bold ${s.priority === "HIGH" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"
                                                    }`}>{s.priority}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
