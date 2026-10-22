import Link from 'next/link';
import FadeIn from '@/components/FadeIn';
import { getPublicStats } from '@/lib/sheets';
import { getCandidateProfile, DEFAULT_ATS_COMPANIES } from '@/lib/profile';
import { siteConfig } from '@/config/site';
import InteractiveEvaluator from '@/components/InteractiveEvaluator';
import InstanceSwitcher from '@/components/InstanceSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import { ArrowUpRight, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
  const [stats, profile] = await Promise.all([
    getPublicStats(),
    Promise.resolve(getCandidateProfile()),
  ]);

  const brandName = profile.system_name || 'CareerOS';
  const atsCompanies = profile.ats_companies || DEFAULT_ATS_COMPANIES;

  return (
    <div className="flex flex-col flex-1 w-full bg-[#0B0F17] text-[#F8FAFC] font-sans">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 lg:px-10 h-16 border-b border-slate-800 bg-[#0B0F17]/95 backdrop-blur-md">
        <Link
          href="/"
          className="text-base font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          {brandName}
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-slate-400">
          <a
            href="#overview"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Overview
          </a>
          <a
            href="#evaluator"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Evaluator
          </a>
          <a
            href="#ownership"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Profile
          </a>
          <a
            href="#coverage"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Sources
          </a>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <ThemeToggle />
          <Link
            href="/admin/tracker"
            className="px-3.5 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Console →
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1240px] mx-auto px-6 lg:px-10 py-12 lg:py-16 space-y-16">
        {/* Section 1: Minimal High-Intent Hero + 4-Metric Strip */}
        <FadeIn>
          <section id="overview" className="space-y-6 scroll-mt-24">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 flex flex-col justify-between bg-[#111827] border border-slate-800 rounded-lg p-8 lg:p-10">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
                    <span className="text-white font-medium">{profile.name}</span>
                    <span aria-hidden="true">·</span>
                    <span>{profile.experience_level}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      Floor ₹{profile.min_salary_lpa}L / $
                      {profile.min_salary_usd_annual.toLocaleString()}
                    </span>
                  </div>

                  <h1
                    className="text-3xl sm:text-4xl font-display font-bold tracking-tight text-white leading-[1.15]"
                    style={{ textWrap: 'balance' }}
                  >
                    Autonomous Job Scouting & 4-Pillar Fit Scoring.
                  </h1>

                  <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-[54ch]">
                    Ingests live roles from direct ATS boards and global feeds. Scores every opening
                    against {profile.name.split(' ')[0]}&apos;s resume parameters and drafts
                    proof-backed outreach.
                  </p>
                </div>

                <div className="pt-6 mt-8 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Link
                      href="/admin/profile"
                      className="px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      Parse Resume <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    <Link
                      href="/admin/tracker"
                      className="px-4 py-2 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      Open Pipeline ({stats.total_tracked})
                    </Link>
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums">
                    {profile.target_roles.length} Target Roles · {profile.skills.length} Skills
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 flex flex-col justify-between bg-[#111827] border border-slate-800 rounded-lg p-6 lg:p-7">
                <div>
                  <div className="flex items-center justify-between pb-3.5 border-b border-slate-800">
                    <h2 className="text-sm font-display font-semibold text-white">
                      Recent High-Fit Matches
                    </h2>
                    <Link
                      href="/admin/tracker"
                      className="text-xs font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      All Leads <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>

                  <div className="divide-y divide-slate-800">
                    {stats.recent_matches.slice(0, 4).map((job) => (
                      <div
                        key={job.id}
                        className="py-3 flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">{job.title}</div>
                          <div className="text-xs text-slate-400 truncate mt-0.5">
                            {job.company} · <span className="font-mono tabular-nums">{job.date}</span>
                          </div>
                        </div>
                        <span className="font-mono tabular-nums text-xs font-semibold text-emerald-400 shrink-0">
                          {job.score}/100
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span>
                    {stats.storage_mode === 'cloud-sheets' ? 'Google Sheets v4' : 'Local Ledger'}
                  </span>
                  <span>Free Multi-LLM Chain</span>
                </div>
              </div>
            </div>

            {/* Minimal 4-KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-800 rounded-lg bg-[#111827] divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
              <div className="p-5">
                <div className="text-xs text-slate-400">Scouted (7d)</div>
                <div className="text-2xl font-mono font-bold text-white tabular-nums mt-1">
                  {stats.jobs_scouted_this_week}
                </div>
              </div>

              <div className="p-5">
                <div className="text-xs text-slate-400">Mean Fit Score</div>
                <div className="text-2xl font-mono font-bold text-emerald-400 tabular-nums mt-1">
                  {stats.avg_match_score}
                  <span className="text-xs text-slate-500 font-normal">/100</span>
                </div>
              </div>

              <div className="p-5">
                <div className="text-xs text-slate-400">Active Applications</div>
                <div className="text-2xl font-mono font-bold text-blue-400 tabular-nums mt-1">
                  {stats.applications_sent}
                </div>
              </div>

              <div className="p-5">
                <div className="text-xs text-slate-400">Reply Rate</div>
                <div className="text-2xl font-mono font-bold text-white tabular-nums mt-1">
                  {stats.response_rate}
                </div>
              </div>
            </div>
          </section>
        </FadeIn>

        {/* Section 2: Live 4-Pillar Role Evaluator */}
        <section id="evaluator" className="space-y-4 scroll-mt-24">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-slate-800 pb-3">
            <h2 className="text-lg font-display font-semibold text-white">
              01. Role Fit Evaluator
            </h2>
            <p className="text-xs text-slate-400">
              Scores any job description across Role (40), Skill (30), Seniority (15), and Comp (15).
            </p>
          </div>

          <InteractiveEvaluator
            ownerName={profile.name}
            ownerMetrics={profile.key_metrics}
            ownerPortfolio={profile.portfolio}
          />
        </section>

        {/* Section 3: Profile & Track Switcher */}
        <section id="ownership" className="space-y-4 scroll-mt-24">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-slate-800 pb-3">
            <h2 className="text-lg font-display font-semibold text-white">
              02. Candidate Profile & Track
            </h2>
            <p className="text-xs text-slate-400">
              Switch tracks in one click or upload a resume to recalibrate targeting.
            </p>
          </div>

          <InstanceSwitcher currentProfile={profile} />
        </section>

        {/* Section 4: Proof Metrics & Direct-ATS Sources */}
        <section id="coverage" className="space-y-4 scroll-mt-24">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-slate-800 pb-3">
            <h2 className="text-lg font-display font-semibold text-white">
              03. Proof Ledger & Direct-ATS Sources
            </h2>
            <Link
              href="/admin/profile"
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              Edit in Profile Console <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-lg overflow-hidden flex flex-col justify-between">
              <div>
                <div className="px-5 py-3 border-b border-slate-800 bg-[#0D131F] flex items-center justify-between text-xs">
                  <span className="font-medium text-white">Verified Impact Metrics</span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {profile.key_metrics.length} Claims
                  </span>
                </div>
                <div className="divide-y divide-slate-800">
                  {profile.key_metrics.map((metric, idx) => (
                    <div key={idx} className="px-5 py-3 flex items-baseline gap-3 text-xs">
                      <span className="font-mono text-emerald-400 tabular-nums shrink-0">
                        0{idx + 1}
                      </span>
                      <span className="text-slate-200 leading-relaxed">{metric}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-5 py-3 border-t border-slate-800 bg-[#0D131F] text-xs text-slate-400">
                <span className="text-slate-200 font-medium">Skills: </span>
                <span className="font-mono text-[11px]">{profile.skills.join(' · ')}</span>
              </div>
            </div>

            <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-lg overflow-hidden flex flex-col justify-between">
              <div>
                <div className="px-5 py-3 border-b border-slate-800 bg-[#0D131F] flex items-center justify-between text-xs">
                  <span className="font-medium text-white">Active Ingestion Channels</span>
                  <span className="font-mono text-emerald-400">strelov1/freehire</span>
                </div>
                <div className="divide-y divide-slate-800 text-xs">
                  <div className="px-5 py-3 flex items-baseline justify-between gap-4">
                    <span className="text-slate-400 shrink-0">Greenhouse</span>
                    <span className="text-slate-200 font-mono text-right truncate">
                      {(atsCompanies.greenhouse || []).join(' · ')}
                    </span>
                  </div>
                  <div className="px-5 py-3 flex items-baseline justify-between gap-4">
                    <span className="text-slate-400 shrink-0">Lever</span>
                    <span className="text-slate-200 font-mono text-right truncate">
                      {(atsCompanies.lever || []).join(' · ')}
                    </span>
                  </div>
                  <div className="px-5 py-3 flex items-baseline justify-between gap-4">
                    <span className="text-slate-400 shrink-0">Ashby</span>
                    <span className="text-slate-200 font-mono text-right truncate">
                      {(atsCompanies.ashby || []).join(' · ')}
                    </span>
                  </div>
                  <div className="px-5 py-3 flex items-baseline justify-between gap-4">
                    <span className="text-slate-400 shrink-0">Global Feeds</span>
                    <span className="text-slate-200 font-mono text-right">
                      RemoteOK · Remotive · Internshala · Arbeitnow
                    </span>
                  </div>
                </div>
              </div>
              <div className="px-5 py-3 border-t border-slate-800 bg-[#0D131F] text-[11px] font-mono text-slate-400">
                Synced with Google Sheets v4 & GitHub Actions (scout.yml)
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Single-Line Attribution Footer */}
      <footer className="border-t border-slate-800 py-5 px-6 lg:px-10 mt-auto bg-[#0B0F17]">
        <div className="max-w-[1240px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <p className="font-mono text-xs text-slate-300">Made by Shaik Kaisif Basha</p>
          <p className="font-mono text-[11px] text-slate-400">
            Direct-ATS credits:{' '}
            <a
              href="https://github.com/strelov1/freehire"
              target="_blank"
              rel="noreferrer"
              className="text-slate-300 hover:text-emerald-400 underline underline-offset-2"
            >
              strelov1/freehire
            </a>{' '}
            ·{' '}
            <a
              href={siteConfig.githubRepo}
              target="_blank"
              rel="noreferrer"
              className="text-slate-300 hover:text-emerald-400 underline underline-offset-2"
            >
              GitHub
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
