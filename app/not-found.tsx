import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
      <h2 className="text-2xl font-bold mb-4">404 - Not Found</h2>
      <p className="text-slate-400 mb-8">Could not find the requested resource.</p>
      <Link 
        href="/"
        className="px-4 py-2 border border-slate-700 hover:border-emerald-500/50 rounded-md transition-colors"
      >
        Return Home
      </Link>
    </div>
  );
}
