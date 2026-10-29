const sections = ["Company", "Invoice", "Inventory", "GST", "Users and Roles"];

export default function SettingsPage() {
  return (
    <div className="flex h-full flex-col border border-slate-300 bg-white">
      <div className="border-b border-slate-300 bg-slate-50 px-3 py-2">
        <h2 className="text-[16px] font-bold uppercase text-slate-800">
          Settings
        </h2>
        <p className="mt-1 text-[16px] font-semibold text-slate-600">
          Configuration sections are placeholders until backend support is added.
        </p>
      </div>
      <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <section
            key={section}
            className="rounded border border-slate-200 bg-white p-3"
          >
            <h3 className="text-[16px] font-bold text-slate-900">{section}</h3>
            <p className="mt-2 text-[16px] font-semibold text-slate-600">
              Coming soon
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
