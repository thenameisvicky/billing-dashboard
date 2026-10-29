import { ReactNode } from "react";

interface PrimaryToolbarProps {
  leftActions?: ReactNode;
  rightActions?: ReactNode;
}

export function PrimaryToolbar({ leftActions, rightActions }: PrimaryToolbarProps) {
  return (
    <div className="flex w-full flex-col gap-2 border border-slate-200 bg-white px-3 py-2 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {leftActions}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {rightActions}
      </div>
    </div>
  );
}
