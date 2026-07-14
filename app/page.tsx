import Link from 'next/link';
import Image from 'next/image';
import FadeIn from '@/components/FadeIn';
import { getPublicStats } from '@/lib/sheets';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Terminal, Cpu, Zap, Radar, Orbit, MailCheck, BriefcaseBusiness, TrendingUp, Users } from 'lucide-react';
import { siteConfig } from '@/config/site';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
    const stats = await getPublicStats();

    return (
        <div className="flex flex-col flex-1 w-full bg-slate-950 text-slate-50 font-sans selection:bg-emerald-500/30">
            <header className="h-16 border-b border-slate-800 px-8 flex items-center justify-between bg-slate-950/80 backdrop-blur-md shrink-0">
                <div className="flex items-center space-x-4">
                    <Cpu className="h-6 w-6 text-emerald-500" />
                    <div className="flex items-center gap-3">
                        <h1 className="text-lg font-bold tracking-tight">{siteConfig.name}</h1>
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400 border border-slate-700 tracking-wider">PUBLIC</span>
                    </div>
                </div>
            </header>
            
            <main className="flex-1 w-full pb-24">
                <FadeIn className="max-w-5xl mx-auto py-12 sm:py-20 px-4 sm:px-6">
                    <div className="text-center mb-12 sm:mb-20">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-emerald-500/30 text-emerald-400 text-xs font-mono mb-6">
                            <Orbit className="h-3.5 w-3.5" />
                            System Online
                        </div>
                        <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-6 text-transparent bg-clip-text bg-gradient-to-r from-slate-100 to-slate-400">
                            Automated Job Hunting Engine
                        </h2>
                        <p className="text-sm sm:text-lg text-slate-400 max-w-2xl mx-auto">
                            {siteConfig.description}
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6 md:gap-8 mb-12 sm:mb-20">
                         <Card className="relative overflow-hidden group hover:border-slate-700">
                             <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                             <CardContent className="p-6 sm:p-8">
                               <h3 className="text-xl font-bold mb-4 text-slate-100 flex items-center gap-2">
                                  <Terminal className="h-5 w-5 text-blue-500" /> What it does
                               </h3>
                               <ul className="text-slate-400 space-y-3 text-sm">
                                   <li className="flex items-center gap-3"><Zap className="h-4 w-4 text-emerald-500 shrink-0" /> Runs a daily scout agent using GitHub Actions</li>
                                   <li className="flex items-center gap-3"><Zap className="h-4 w-4 text-emerald-500 shrink-0" /> Scores job fit using Gemini 2.5 Flash</li>
                                   <li className="flex items-center gap-3"><Zap className="h-4 w-4 text-emerald-500 shrink-0" /> Tracks active applications via Google Sheets</li>
                                   <li className="flex items-center gap-3"><Zap className="h-4 w-4 text-emerald-500 shrink-0" /> Detects pipeline replies automatically from Gmail</li>
                               </ul>
                             </CardContent>
                         </Card>

                         <Card className="relative overflow-hidden group hover:border-slate-700">
                             <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                             <CardContent className="p-6 sm:p-8">
                               <h3 className="text-xl font-bold mb-4 text-slate-100 flex items-center gap-2">
                                  <BriefcaseBusiness className="h-5 w-5 text-emerald-500" /> Why it was built
                               </h3>
                               <p className="text-slate-400 text-sm leading-relaxed">
                                  Built for absolute transparency, automation, and accountability. Job hunting is a numbers game, but the quality of applications matters immensely. {siteConfig.name} ensures no high-fit opportunity is missed, drafts contextual outreach messages, and maintains a strict analytics pipeline without tedious data entry.
                               </p>
                             </CardContent>
                         </Card>
                    </div>

                    <div className="mb-12 sm:mb-20">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] text-center mb-8">System Decision Logic</h3>
                        <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 relative">
                            <div className="flex flex-col md:flex-row items-center justify-between space-y-8 md:space-y-0 relative z-10">
                                <div className="text-center group w-full flex flex-col items-center">
                                    <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mb-4 text-blue-400 group-hover:scale-110 group-hover:border-blue-500/50 transition-all shadow-md">
                                        <Radar className="h-6 w-6" />
                                    </div>
                                    <h4 className="text-sm font-bold text-slate-200 mb-1">1. {siteConfig.features[0].title}</h4>
                                    <p className="text-xs text-slate-500 max-w-[150px]">{siteConfig.features[0].description}</p>
                                </div>
                                <div className="hidden md:block w-full h-[1px] bg-slate-800/80"></div>
                                <div className="text-center group w-full flex flex-col items-center">
                                    <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mb-4 text-emerald-400 group-hover:scale-110 group-hover:border-emerald-500/50 transition-all shadow-md">
                                        <TrendingUp className="h-6 w-6" />
                                    </div>
                                    <h4 className="text-sm font-bold text-slate-200 mb-1">2. {siteConfig.features[1].title}</h4>
                                    <p className="text-xs text-slate-500 max-w-[150px]">{siteConfig.features[1].description}</p>
                                </div>
                                <div className="hidden md:block w-full h-[1px] bg-slate-800/80"></div>
                                <div className="text-center group w-full flex flex-col items-center">
                                    <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mb-4 text-purple-400 group-hover:scale-110 group-hover:border-purple-500/50 transition-all shadow-md">
                                        <Users className="h-6 w-6" />
                                    </div>
                                    <h4 className="text-sm font-bold text-slate-200 mb-1">3. {siteConfig.features[2].title}</h4>
                                    <p className="text-xs text-slate-500 max-w-[150px]">{siteConfig.features[2].description}</p>
                                </div>
                                <div className="hidden md:block w-full h-[1px] bg-slate-800/80"></div>
                                <div className="text-center group w-full flex flex-col items-center">
                                    <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mb-4 text-orange-400 group-hover:scale-110 group-hover:border-orange-500/50 transition-all shadow-md">
                                        <MailCheck className="h-6 w-6" />
                                    </div>
                                    <h4 className="text-sm font-bold text-slate-200 mb-1">4. {siteConfig.features[3].title}</h4>
                                    <p className="text-xs text-slate-500 max-w-[150px]">{siteConfig.features[3].description}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mb-20">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] text-center mb-8">Live Anonymized Stats</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <Card className="hover:border-slate-700 bg-slate-900/40">
                                <CardContent className="p-6 text-center">
                                    <div className="text-4xl font-mono font-bold text-slate-100 mb-2">{stats.jobs_scouted_this_week}</div>
                                    <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">{siteConfig.stats.scouted_label}</div>
                                </CardContent>
                            </Card>
                            <Card className="hover:border-slate-700 bg-slate-900/40">
                                <CardContent className="p-6 text-center">
                                    <div className="text-4xl font-mono font-bold text-emerald-400 mb-2">{stats.avg_match_score} <span className="text-base text-slate-600">/100</span></div>
                                    <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">{siteConfig.stats.match_label}</div>
                                </CardContent>
                            </Card>
                            <Card className="hover:border-slate-700 bg-slate-900/40">
                                <CardContent className="p-6 text-center">
                                    <div className="text-4xl font-mono font-bold text-blue-400 mb-2">{stats.applications_sent}</div>
                                    <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">{siteConfig.stats.sent_label}</div>
                                </CardContent>
                            </Card>
                            <Card className="hover:border-slate-700 bg-slate-900/40">
                                <CardContent className="p-6 text-center">
                                    <div className="text-4xl font-mono font-bold text-purple-400 mb-2">{stats.response_rate}</div>
                                    <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">{siteConfig.stats.response_label}</div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-10 text-center max-w-3xl mx-auto shadow-sm">
                        <Terminal className="h-8 w-8 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-100 mb-3">Want to build your own engine?</h3>
                        <p className="text-sm text-slate-400 mb-8 max-w-md mx-auto">
                            Fork the open source engine and set up your own automated job scout for zero cost using GitHub Actions and Vercel.
                        </p>
                        <Button asChild variant="default" size="lg" className="px-8 font-mono tracking-wide">
                            <a href={siteConfig.githubRepo} target="_blank" rel="noreferrer">
                                View Core System on GitHub
                            </a>
                        </Button>
                    </div>
                </FadeIn>
            </main>
        </div>
    );
}
