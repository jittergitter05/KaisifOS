import React from 'react';

export default function StatusBadge({ status }: { status: string }) {
  const tStatus = status.toLowerCase();
  
  let classes = "";
  if (tStatus === "new") classes = "bg-blue-500/10 text-blue-400 border-blue-500/20";
  else if (tStatus === "applied") classes = "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
  else if (tStatus === "replied") classes = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  else if (tStatus === "interview") classes = "bg-purple-500/10 text-purple-400 border-purple-500/20";
  else if (tStatus === "rejected") classes = "bg-slate-500/10 text-slate-400 border-slate-500/20";
  else classes = "bg-slate-500/10 text-slate-500 border-slate-500/20";

  return (
    <span className={`px-2 py-0.5 inline-flex text-[10px] uppercase font-bold rounded border ${classes}`}>
      {status}
    </span>
  );
}
