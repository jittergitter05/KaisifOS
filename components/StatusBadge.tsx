import React from 'react';
export default function StatusBadge({ status }: { status: string }) {
  const tStatus = status.toLowerCase();
  let classes = "";
  if (tStatus === "new") classes = "status-new";
  else if (tStatus === "applied") classes = "status-applied";
  else if (tStatus === "replied") classes = "status-replied";
  else if (tStatus === "interview") classes = "status-interview";
  else if (tStatus === "rejected") classes = "status-rejected";
  else if (tStatus === "ignored") classes = "status-ignored";
  else classes = "bg-slate-800 text-slate-400 border-slate-700";

  return (
    <span className={`px-2 py-0.5 inline-flex text-[10px] font-bold uppercase rounded ${classes}`}>
      {status}
    </span>
  );
}
