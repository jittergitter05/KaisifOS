import { google } from 'googleapis';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getStats() {
  if (!process.env.GOOGLE_SERVICE_KEY_BASE64 || !process.env.GOOGLE_SHEET_ID) {
    return { scoutedWeek: 0, avgScore: 0, applied: 0, responseRate: 0 };
  }

  try {
    const creds = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets('v4');
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:M',
    });

    const rows = response.data.values || [];
    
    let scoutedWeek = 0;
    let totalScore = 0;
    let scoreCount = 0;
    let applied = 0;
    let replied = 0; 

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue;
        
        const dateStr = row[0];
        const score = parseInt(row[4] || '0', 10);
        const status = row[10] || 'NEW';

        const rowDate = new Date(dateStr);
        if (rowDate >= oneWeekAgo) {
            scoutedWeek++;
        }

        if (score > 0) {
            totalScore += score;
            scoreCount++;
        }

        if (['APPLIED', 'REPLIED', 'INTERVIEW', 'REJECTED'].includes(status)) {
            applied++;
        }
        
        if (['REPLIED', 'INTERVIEW', 'REJECTED'].includes(status)) {
            replied++;
        }
    }

    const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
    const responseRate = applied > 0 ? Math.round((replied / applied) * 100) : 0;

    return { scoutedWeek, avgScore, applied, responseRate };

  } catch(e) {
    console.error(e);
    return { scoutedWeek: 0, avgScore: 0, applied: 0, responseRate: 0 };
  }
}

export default async function Home() {
    const stats = await getStats();

    return (
        <div className="flex flex-col min-h-screen w-full bg-slate-900 text-slate-50">
            <header className="h-16 border-b border-slate-800 px-8 flex items-center justify-between bg-slate-900/50 backdrop-blur-md shrink-0">
                <div className="flex items-center space-x-4">
                    <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center font-bold text-white font-mono text-xl">K</div>
                    <div className="flex flex-col">
                        <h1 className="text-lg font-bold tracking-tight">KaisifOS <span className="text-xs font-mono text-emerald-500 ml-2 font-normal">Public</span></h1>
                    </div>
                </div>
                <Link href="/admin/tracker" className="text-xs text-slate-400 hover:text-emerald-400 font-mono transition-colors">
                    Admin Login &rarr;
                </Link>
            </header>
            
            <main className="flex-1 overflow-auto">
                <div className="max-w-4xl mx-auto py-16 px-6">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4 text-white">Automated Job Hunting Engine</h2>
                        <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto">
                            This is an AI-powered job hunting agent built by Kaisif while actively job searching. 
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-8 mb-16">
                         <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors">
                             <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                             <h3 className="text-xl font-bold mb-3 text-white">What it does</h3>
                             <ul className="text-slate-400 space-y-2 text-sm">
                                 <li className="flex items-start"><span className="text-blue-500 mr-2">✓</span> Runs a daily scout agent using GitHub Actions</li>
                                 <li className="flex items-start"><span className="text-blue-500 mr-2">✓</span> Scores job fit using Gemini 2.5 Flash</li>
                                 <li className="flex items-start"><span className="text-blue-500 mr-2">✓</span> Tracks active applications via Google Sheets</li>
                                 <li className="flex items-start"><span className="text-blue-500 mr-2">✓</span> Detects pipeline replies automatically from Gmail</li>
                             </ul>
                         </div>

                         <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors">
                             <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                             <h3 className="text-xl font-bold mb-3 text-white">Why it was built</h3>
                             <p className="text-slate-400 text-sm leading-relaxed">
                                Built for transparency, automation, and accountability. Job hunting is a numbers game, but quality of applications matters. KaisifOS ensures no high-fit opportunity is missed, drafts contextual outreach messages, and maintains a strict analytics pipeline without manual data entry.
                             </p>
                         </div>
                    </div>

                    <div className="mb-16">
                        <h3 className="text-sm font-mono text-slate-500 uppercase tracking-widest text-center mb-8">Live Anonymized Stats</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center shadow-sm hover:border-slate-700 transition-colors">
                                <div className="text-3xl font-mono text-white mb-2">{stats.scoutedWeek}</div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-wide">Jobs Scouted (7d)</div>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center shadow-sm hover:border-slate-700 transition-colors">
                                <div className="text-3xl font-mono text-emerald-400 mb-2">{stats.avgScore} <span className="text-sm opacity-50">/ 100</span></div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-wide">Avg Match Score</div>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center shadow-sm hover:border-slate-700 transition-colors">
                                <div className="text-3xl font-mono text-blue-400 mb-2">{stats.applied}</div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-wide">Applications Sent</div>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center shadow-sm hover:border-slate-700 transition-colors">
                                <div className="text-3xl font-mono text-purple-400 mb-2">{stats.responseRate}%</div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-wide">Response Rate</div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                        <h3 className="text-lg font-bold text-white mb-2">Want to build your own?</h3>
                        <p className="text-sm text-slate-400 mb-6">Fork the open source engine and set up your own automated job scout for zero cost using GitHub Actions and Vercel.</p>
                        <a href="https://github.com/shaikkaisifbasha" target="_blank" rel="noreferrer" className="inline-flex items-center px-4 py-2 border border-slate-700 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors">
                            View on GitHub
                        </a>
                    </div>
                </div>
            </main>
        </div>
    );
}
