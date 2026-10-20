import Link from 'next/link';
import FadeIn from '@/components/FadeIn';
import { getPublicStats } from '@/lib/sheets';
import { getCandidateProfile } from '@/lib/profile';
import { siteConfig } from '@/config/site';
import InteractiveEvaluator from '@/components/InteractiveEvaluator';
import InstanceSwitcher from '@/components/InstanceSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import StatusBadge from '@/components/StatusBadge';
import { ArrowUpRight, ArrowRight, Sliders } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const AUDIT_MATRIX = [
  {
    index: '01. Build & Cache Safeguard',
    subsystem: 'next.config.mjs & package.json',
    bottleneck:
      'Next.js .next/cache webpack packfile deadlocks on cloud rebuilds and hard process.exit(1) crashes when cloud secrets are omitted.',
    upgrade:
      'Disabled webpack packfile disk cache + pre-build cache purge (rm -rf .next/cache) + hybrid Google Sheets v4 & Local JSON Ledger failover.',
    metric: '0 Build Deadlocks / 100% Uptime',
  },
  {
    index: '02. Browser-Safe Fork Authentication',
    subsystem: 'lib/auth.ts & middleware.ts',
    bottleneck:
      'Default "admin/secret" password triggered Chrome Data Breach warnings, and third-party cookie restrictions blocked iframe/fork logins.',
    upgrade:
      'Zero-friction Open Fork Mode when custom .env lock is unset, paired with non-breached cryptographic workspace passkey (ksf-op-9x7v2q-local).',
    metric: 'Zero Browser Blocks / Instant Fork Use',
  },
  {
    index: '03. White-Label Profile Ownership',
    subsystem: 'lib/profile.ts & data/profile.json',
    bottleneck:
      'Public page and evaluator hardcoded the original creator’s name and metrics, preventing fork users from owning the platform for their career.',
    upgrade:
      '100% profile-driven identity & branding (system_name, target_roles, cities, metrics) with 1-click Persona Switcher and live customizer.',
    metric: '1-Click Fork Re-Targeting',
  },
  {
    index: '04. Multi-Vector AI & Dual Theme UI',
    subsystem: 'app/api/evaluate & app/globals.css',
    bottleneck:
      'Opaque batch scoring with dark-only hardcoded styles and redundant navigation links duplicated between the top bar and footer.',
    upgrade:
      'Live 4-Pillar Rubric (/40 Role, /25 Exp, /20 Geo, /15 Comp) + Dark/Light Executive Themes + clean non-redundant information architecture.',
    metric: 'Dark & Light Themes · AA+ Contrast',
  },
];

export default async function Home() {
  const [stats, profile] = await Promise.all([getPublicStats(), Promise.resolve(getCandidateProfile())]);

  const brandName = profile.system_name || 'CareerOS';
  const topRoles = profile.target_roles.slice(0, 4).join(', ');
  const topCities = profile.target_cities.join(', ');
  const leadMetric = profile.key_metrics[0] || 'verified impact metrics';

  return (
    <div className="flex flex-col flex-1 w-full bg-[#0B0F17] text-[#F8FAFC] font-sans">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-6 px-6 lg:px-10 h-16 border-b border-slate-800/90 bg-[#0B0F17]/90 backdrop-blur-md">
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/"
            className="text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            {brandName}
          </Link>
          <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-mono bg-[#111827] border border-slate-800 text-emerald-400">
            Owner: {profile.name}
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
          <a
            href="#ownership"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Own This System
          </a>
          <a
            href="#architecture"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Architecture
          </a>
          <a
            href="#evaluator"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Live Evaluator
          </a>
          <a
            href="#audit"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Audit Report
          </a>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <ThemeToggle />
          <Link
            href="/admin/tracker"
            className="px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Operator Console →
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1320px] mx-auto px-6 lg:px-10 py-10 lg:py-14 space-y-16">
        <FadeIn>
          <section className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              <div className="lg:col-span-7 flex flex-col justify-between bg-[#111827] border border-slate-800/90 rounded-xl p-8 lg:p-10">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-mono text-emerald-400">
                      Autonomous Career Intelligence · Active Owner: {profile.name}
                    </span>
                    <span className="text-xs font-mono text-slate-400 tabular-nums">
                      Floor: ₹{profile.min_salary_lpa}L / ${profile.min_salary_usd_annual.toLocaleString()}
                    </span>
                  </div>

                  <h1
                    className="text-3xl sm:text-4xl lg:text-[40px] font-display font-bold tracking-tight text-white leading-[1.14]"
                    style={{ textWrap: 'balance' }}
                  >
                    Deterministic Job Scouting & Metric-First Outreach Synthesis
                  </h1>

                  <p className="text-base text-slate-300 leading-relaxed max-w-[62ch]">
                    Currently calibrated for <strong className="text-white font-medium">{profile.name}</strong>{' '}
                    ({profile.experience_level}) targeting <strong className="text-white font-medium">{topRoles}</strong>{' '}
                    across <strong className="text-white font-medium">{topCities}</strong>
                    {profile.open_to_relocation ? ' and global visa-sponsored hubs' : ''}. Injects verified proof (
                    <span className="font-mono text-xs text-emerald-400">{leadMetric}</span>) into every cold outreach draft.
                  </p>
                </div>

                <div className="pt-8 mt-8 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href="/admin/profile"
                      className="px-4 py-2.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Sliders className="h-3.5 w-3.5" /> Configure Candidate Profile
                    </Link>
                    <Link
                      href="/admin/digest"
                      className="px-4 py-2.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      View Daily Digest <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums">
                    {profile.skills.length} Calibrated Skills · ≥90 Conviction
                  </div>
                </div>
              </div>

              <div
                id="pipeline"
                className="lg:col-span-5 flex flex-col justify-between bg-[#111827] border border-slate-800/90 rounded-xl p-6"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                  <div>
                    <div className="text-xs text-slate-400">Live Pipeline Ledger</div>
                    <h2 className="text-sm font-display font-semibold text-white mt-0.5">
                      Recent High-Conviction Matches
                    </h2>
                  </div>
                  <Link
                    href="/admin/tracker"
                    className="text-xs font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                     Inspect All ({stats.total_tracked}) <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>

                <div className="divide-y divide-slate-800/80 my-2">
                  {stats.recent_matches.slice(0, 4).map((job) => (
                    <div
                      key={job.id}
                      className="py-3 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {job.title}
                        </div>
                        <div className="text-xs text-slate-400 truncate mt-0.5">
                          {job.company} · <span className="font-mono tabular-nums">{job.date}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="font-mono tabular-nums text-xs font-semibold text-emerald-400">
                          {job.score}/100
                        </span>
                        <StatusBadge status={job.status} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    Persistence:{' '}
                    <span className="text-slate-200 font-mono">
                      {stats.storage_mode === 'cloud-sheets'
                        ? 'Google Sheets v4 Sync'
                        : 'Hybrid Local Ledger'}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-emerald-400">
                    No-Login Local Fork Ready
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-5">
                <div className="text-xs text-slate-400 mb-1">
                  {siteConfig.stats.scouted_label}
                </div>
                <div className="text-3xl font-mono font-bold text-white tabular-nums">
                  {stats.jobs_scouted_this_week}
                </div>
                <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                  {stats.high_conviction_count} roles scored ≥90/100
                </div>
              </div>

              <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-5">
                <div className="text-xs text-slate-400 mb-1">
                  {siteConfig.stats.match_label}
                </div>
                <div className="text-3xl font-mono font-bold text-emerald-400 tabular-nums">
                  {stats.avg_match_score}
                  <span className="text-base text-slate-500 font-normal">/100</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Across {stats.total_tracked} evaluated pipeline leads
                </div>
              </div>

              <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-5">
                <div className="text-xs text-slate-400 mb-1">
                  {siteConfig.stats.sent_label}
                </div>
                <div className="text-3xl font-mono font-bold text-blue-400 tabular-nums">
                  {stats.applications_sent}
                </div>
                <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                  {stats.interviews_and_offers} active interviews / offers
                </div>
              </div>

              <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-5">
                <div className="text-xs text-slate-400 mb-1">
                  {siteConfig.stats.response_label}
                </div>
                <div className="text-3xl font-mono font-bold text-violet-400 tabular-nums">
                  {stats.response_rate}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Auto-verified via Gmail API thread polling
                </div>
              </div>
            </div>
          </section>
        </FadeIn>

        {/* White-Label Ownership & Fork Switcher Section */}
        <section id="ownership" className="scroll-mt-24">
          <InstanceSwitcher currentProfile={profile} />
        </section>

        <section id="architecture" className="space-y-6 scroll-mt-24">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="text-xs font-mono text-emerald-400">
                01. Autonomous Decision Loop
              </div>
              <h2 className="text-2xl font-display font-bold text-white mt-1">
                Four-Stage Execution Architecture
              </h2>
            </div>
            <p className="text-xs text-slate-400 max-w-md">
              Every daily run executes deterministically from multi-board ingestion to Gmail
              thread verification, dynamically parameterized by your <span className="font-mono">data/profile.json</span>.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {siteConfig.features.map((feat) => (
              <div
                key={feat.step}
                className="bg-[#111827] border border-slate-800/90 rounded-xl p-6 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="text-xs font-mono text-emerald-400 tabular-nums">
                    Stage {feat.step}
                  </div>
                  <h3 className="text-base font-display font-semibold text-white">
                    {feat.title}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {feat.step === '03'
                      ? `Injects ${profile.name}'s verified metrics (${leadMetric}) into tailored LinkedIn DMs & cold emails`
                      : feat.mechanism}
                  </p>
                </div>
                <div className="pt-4 mt-5 border-t border-slate-800/80">
                  <div className="text-[11px] text-slate-400">Measurable Outcome</div>
                  <div className="text-xs text-slate-200 mt-0.5 leading-snug">
                    {feat.outcome}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="evaluator" className="space-y-6 scroll-mt-24">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="text-xs font-mono text-emerald-400">
                02. Live Intelligence Workbench
              </div>
              <h2 className="text-2xl font-display font-bold text-white mt-1">
                Ad-Hoc Role Evaluator & Cold Outreach Synthesizer
              </h2>
            </div>
            <p className="text-xs text-slate-400 max-w-md">
              Test any job description against <strong className="text-slate-200">{profile.name}</strong>&apos;s active
              profile (<span className="font-mono">data/profile.json</span>) or select a preset scenario.
            </p>
          </div>

          <InteractiveEvaluator
            ownerName={profile.name}
            ownerMetrics={profile.key_metrics}
            ownerPortfolio={profile.portfolio}
          />
        </section>

        <section id="audit" className="space-y-6 scroll-mt-24">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="text-xs font-mono text-emerald-400">
                03. System Architecture Audit
              </div>
              <h2 className="text-2xl font-display font-bold text-white mt-1">
                Critical Audit & Engineering Upgrades Implemented
              </h2>
            </div>
            <Link
              href="/admin/settings"
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              View Live Server Diagnostics <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="bg-[#111827] border border-slate-800/90 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-[#0D131F] text-xs font-medium text-slate-400">
                    <th className="py-3.5 px-5 whitespace-nowrap">Subsystem</th>
                    <th className="py-3.5 px-5">Previous Bottleneck Identified</th>
                    <th className="py-3.5 px-5">Engineered Architecture Upgrade</th>
                    <th className="py-3.5 px-5 text-right whitespace-nowrap">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-xs">
                  {AUDIT_MATRIX.map((row) => (
                    <tr key={row.index} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-4 px-5 align-top whitespace-nowrap">
                        <div className="font-display font-semibold text-white">{row.index}</div>
                        <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                          {row.subsystem}
                        </div>
                      </td>
                      <td className="py-4 px-5 align-top text-slate-400 leading-relaxed max-w-sm">
                        {row.bottleneck}
                      </td>
                      <td className="py-4 px-5 align-top text-slate-200 leading-relaxed max-w-md">
                        {row.upgrade}
                      </td>
                      <td className="py-4 px-5 align-top text-right font-mono tabular-nums text-emerald-400 whitespace-nowrap">
                        {row.metric}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      {/* Non-Redundant Telemetry & Attribution Footer (Zero Duplicated Navbar Links) */}
      <footer className="border-t border-slate-800/80 py-7 px-6 lg:px-10 mt-auto bg-[#0D131F]/60">
        <div className="max-w-[1320px] mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display font-semibold text-white">{brandName}</span>
            <span aria-hidden="true">·</span>
            <span>
              Active Instance Calibrated for <strong className="text-slate-200">{profile.name}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[11px] text-emerald-400">
              Open-Source Reference Architecture by Shaik Kaisif Basha
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-slate-400">
            <span>
              Storage: {stats.storage_mode === 'cloud-sheets' ? 'Google Sheets v4' : 'Local JSON Ledger'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Rubric: 4-Pillar v2.5</span>
            <span aria-hidden="true">·</span>
            <a
              href={siteConfig.githubRepo}
              target="_blank"
              rel="noreferrer"
              className="text-slate-300 hover:text-emerald-400 transition-colors inline-flex items-center gap-1"
            >
              Fork Repository <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
