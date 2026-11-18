import pg from 'pg';

const { Pool } = pg;

let poolInstance = null;

export function sanitizePostgresErrorMessage(err) {
  const raw = String(err?.message || err || 'Unknown database error');
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgresql://[REDACTED]')
    .replace(/(password|pwd|token|secret)=([^\s&"']+)/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

function getRawNeonConnectionString() {
  const pooled = String(process.env.DATABASE_URL_POOLED || '').trim();
  if (/^postgres(?:ql)?:\/\//i.test(pooled)) return pooled;
  const direct = String(process.env.DATABASE_URL || '').trim();
  if (/^postgres(?:ql)?:\/\//i.test(direct)) return direct;
  return '';
}

function normalizeNeonConnectionString(rawUrl) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    const isLocal =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1';
    if (!isLocal && parsed.searchParams.get('sslmode') === 'require') {
      // Upgrade libpq alias 'require' to strict 'verify-full' so TLS validates cert & hostname without pg deprecation warning
      parsed.searchParams.set('sslmode', 'verify-full');
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function isNeonPostgresConfigured() {
  return Boolean(getRawNeonConnectionString());
}

function getPool() {
  const raw = getRawNeonConnectionString();
  if (!raw) return null;
  if (!poolInstance) {
    const connectionString = normalizeNeonConnectionString(raw);
    const isLocal =
      connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    poolInstance = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 8000,
      ssl: isLocal ? false : { rejectUnauthorized: true },
    });
    poolInstance.on('error', (err) => {
      console.warn('[NeonDB] Idle pool warning:', sanitizePostgresErrorMessage(err));
    });
  }
  return poolInstance;
}

export function computeProfileVersionHash(profile) {
  const payload = JSON.stringify({
    target_roles: profile?.target_roles || [],
    target_cities: profile?.target_cities || [],
    open_to_relocation: Boolean(profile?.open_to_relocation),
    experience_years: Number(profile?.experience_years || 0),
    skills: profile?.skills || [],
  });
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `v_${(hash >>> 0).toString(16)}`;
}

let schemaInitialized = false;

export async function ensureNeonSchema() {
  const pool = getPool();
  if (!pool) return false;
  if (schemaInitialized) return true;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kaisifos_jobs (
      canonical_key TEXT PRIMARY KEY,
      primary_id TEXT NOT NULL,
      discovered_date TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT DEFAULT '',
      salary TEXT DEFAULT '',
      description_snippet TEXT DEFAULT '',
      score INTEGER DEFAULT 0,
      reasons TEXT DEFAULT '',
      gap TEXT DEFAULT '',
      apply_url TEXT DEFAULT '',
      dm_draft TEXT DEFAULT '',
      email_draft TEXT DEFAULT '',
      resume_angle TEXT DEFAULT '',
      stage TEXT DEFAULT 'NEW',
      evaluation_status TEXT DEFAULT 'LLM_SCORED',
      needs_llm_retry BOOLEAN DEFAULT FALSE,
      sources_seen JSONB DEFAULT '[]'::jsonb,
      subscores JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE kaisifos_jobs ADD COLUMN IF NOT EXISTS description_snippet TEXT DEFAULT '';

    CREATE INDEX IF NOT EXISTS idx_kaisifos_jobs_primary_id ON kaisifos_jobs (primary_id);
    CREATE INDEX IF NOT EXISTS idx_kaisifos_jobs_stage ON kaisifos_jobs (stage);
    CREATE INDEX IF NOT EXISTS idx_kaisifos_jobs_retry ON kaisifos_jobs (needs_llm_retry);

    CREATE TABLE IF NOT EXISTS kaisifos_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      profile_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS kaisifos_scout_runs (
      id SERIAL PRIMARY KEY,
      run_at TIMESTAMPTZ DEFAULT NOW(),
      mode TEXT DEFAULT 'live_sweep',
      runner TEXT DEFAULT 'live_sweep',
      total_fetched INTEGER DEFAULT 0,
      canonical_dedup_saved INTEGER DEFAULT 0,
      hard_gate_rejected INTEGER DEFAULT 0,
      evaluated_count INTEGER DEFAULT 0,
      committed_count INTEGER DEFAULT 0,
      queued_for_retry INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      source_counts JSONB DEFAULT '{}'::jsonb,
      hard_gate_reasons JSONB DEFAULT '{}'::jsonb
    );

    ALTER TABLE kaisifos_scout_runs ADD COLUMN IF NOT EXISTS runner TEXT DEFAULT 'live_sweep';
    ALTER TABLE kaisifos_scout_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER DEFAULT 0;
  `);

  schemaInitialized = true;
  return true;
}

export async function getNeonCanonicalStateMap() {
  const pool = getPool();
  const map = new Map();
  if (!pool) return map;
  try {
    await ensureNeonSchema();
    const res = await pool.query(`
      SELECT canonical_key, primary_id, score, stage, evaluation_status, needs_llm_retry, apply_url, sources_seen
      FROM kaisifos_jobs
    `);
    for (const row of res.rows) {
      map.set(row.canonical_key, {
        canonicalKey: row.canonical_key,
        id: row.primary_id,
        score: Number(row.score || 0),
        status: row.stage || 'NEW',
        evaluationStatus: row.evaluation_status || 'LLM_SCORED',
        needsLlmRetry: Boolean(row.needs_llm_retry),
        url: row.apply_url || '',
        sourcesSeen: Array.isArray(row.sources_seen) ? row.sources_seen : [],
      });
    }
  } catch (err) {
    console.warn('[NeonDB] getNeonCanonicalStateMap warning:', sanitizePostgresErrorMessage(err));
  }
  return map;
}

export async function getNeonJobsPendingLlmRetry(limit = 12) {
  const pool = getPool();
  if (!pool) return [];
  try {
    await ensureNeonSchema();
    const res = await pool.query(
      `
      SELECT canonical_key, primary_id, discovered_date, title, company, location, salary,
             description_snippet, score, reasons, gap, apply_url, dm_draft, email_draft,
             resume_angle, stage, sources_seen
      FROM kaisifos_jobs
      WHERE needs_llm_retry = TRUE
        AND evaluation_status NOT IN ('REJECTED_GATE', 'REJECTED_PREFILTER')
      ORDER BY score DESC, updated_at DESC
      LIMIT $1
      `,
      [limit]
    );
    return res.rows.map((r) => {
      const sources = Array.isArray(r.sources_seen) ? r.sources_seen : [];
      return {
        canonicalKey: r.canonical_key,
        id: r.primary_id,
        date: r.discovered_date,
        title: r.title,
        company: r.company,
        location: r.location || '',
        salary: r.salary || '',
        description: r.description_snippet || '',
        score: Number(r.score || 0),
        reasons: r.reasons || '',
        gap: r.gap || '',
        url: r.apply_url || '',
        source: (sources[0] && sources[0].source) || 'Retry Queue',
        dm: r.dm_draft || '',
        emailDraft: r.email_draft || '',
        resumeAngle: r.resume_angle || '',
        status: r.stage || 'NEW',
        sourcesSeen: sources,
      };
    });
  } catch (err) {
    console.warn('[NeonDB] getNeonJobsPendingLlmRetry warning:', sanitizePostgresErrorMessage(err));
    return [];
  }
}

export async function upsertNeonCanonicalJob(record) {
  const pool = getPool();
  if (!pool) return { ok: false, merged: false };
  try {
    await ensureNeonSchema();
    const canonicalKey = String(record.canonicalKey || '').trim();
    if (!canonicalKey) return { ok: false, merged: false };

    const stageValue = record.status ?? record.pipelineStage ?? 'NEW';
    const dmValue = record.dm ?? record.dmDraft ?? '';
    const descSnippet = String(record.descriptionSnippet ?? record.description ?? '').slice(0, 1500);
    const evalStatus = record.evaluationStatus || 'LLM_SCORED';
    const isRejectedGate =
      evalStatus === 'REJECTED_GATE' || evalStatus === 'REJECTED_PREFILTER';

    const existingRes = await pool.query(
      `SELECT canonical_key, primary_id, score, stage, apply_url, evaluation_status, needs_llm_retry, sources_seen
       FROM kaisifos_jobs WHERE canonical_key = $1`,
      [canonicalKey]
    );

    const incomingSources = Array.isArray(record.sourcesSeen) ? record.sourcesSeen : [];
    if (existingRes.rows.length > 0) {
      const ex = existingRes.rows[0];
      const existingSources = Array.isArray(ex.sources_seen) ? ex.sources_seen : [];
      const seenKeySet = new Set(existingSources.map((s) => `${s.source}::${s.url}`));
      const mergedSources = [...existingSources];
      for (const s of incomingSources) {
        const k = `${s.source}::${s.url}`;
        if (!seenKeySet.has(k)) {
          seenKeySet.add(k);
          mergedSources.push(s);
        }
      }

      const shouldUpgradeEval =
        isRejectedGate ||
        (ex.needs_llm_retry && !record.needsLlmRetry) ||
        Number(record.score || 0) > Number(ex.score || 0);

      await pool.query(
        `
        UPDATE kaisifos_jobs
        SET score = CASE WHEN $2::boolean THEN $3 ELSE score END,
            reasons = CASE WHEN $2::boolean AND $4 != '' THEN $4 ELSE reasons END,
            gap = CASE WHEN $2::boolean AND $5 != '' THEN $5 ELSE gap END,
            apply_url = CASE WHEN $6 != '' THEN $6 ELSE apply_url END,
            dm_draft = CASE WHEN $2::boolean AND $7 != '' THEN $7 ELSE dm_draft END,
            email_draft = CASE WHEN $8 != '' THEN $8 ELSE email_draft END,
            resume_angle = CASE WHEN $2::boolean AND $9 != '' THEN $9 ELSE resume_angle END,
            evaluation_status = CASE WHEN $2::boolean THEN $10 ELSE evaluation_status END,
            needs_llm_retry = CASE WHEN $2::boolean THEN $11 ELSE needs_llm_retry END,
            sources_seen = $12::jsonb,
            stage = CASE
              WHEN $13 = 'REJECTED' THEN 'REJECTED'
              WHEN $2::boolean AND stage = 'NEW' AND $13 = 'SHORTLISTED' THEN 'SHORTLISTED'
              ELSE stage
            END,
            description_snippet = CASE WHEN $14 != '' THEN $14 ELSE description_snippet END,
            updated_at = NOW()
        WHERE canonical_key = $1
        `,
        [
          canonicalKey,
          shouldUpgradeEval,
          Math.round(Number(record.score ?? ex.score ?? 0)),
          record.reasons || record.hardRejectReason || '',
          record.gap || '',
          record.url || ex.apply_url || '',
          dmValue,
          record.emailDraft || '',
          record.resumeAngle || '',
          evalStatus,
          Boolean(record.needsLlmRetry),
          JSON.stringify(mergedSources),
          stageValue,
          descSnippet,
        ]
      );
      return { ok: true, merged: true };
    }

    await pool.query(
      `
      INSERT INTO kaisifos_jobs (
        canonical_key, primary_id, discovered_date, title, company, location, salary,
        description_snippet, score, reasons, gap, apply_url, dm_draft, email_draft,
        resume_angle, stage, evaluation_status, needs_llm_retry, sources_seen, subscores, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19::jsonb, $20::jsonb, NOW()
      )
      `,
      [
        canonicalKey,
        record.id || canonicalKey,
        record.date || new Date().toISOString().split('T')[0],
        record.title || 'Untitled Role',
        record.company || 'Unknown Company',
        record.location || '',
        record.salary || '',
        descSnippet,
        Math.round(Number(record.score || 0)),
        record.reasons || record.hardRejectReason || '',
        record.gap || '',
        record.url || '',
        dmValue,
        record.emailDraft || '',
        record.resumeAngle || '',
        stageValue,
        evalStatus,
        Boolean(record.needsLlmRetry),
        JSON.stringify(incomingSources),
        JSON.stringify(record.subscores || {}),
      ]
    );

    return { ok: true, merged: false };
  } catch (err) {
    const safeMsg = sanitizePostgresErrorMessage(err);
    console.warn('[NeonDB] upsertNeonCanonicalJob error:', safeMsg);
    return { ok: false, merged: false, error: safeMsg };
  }
}

export async function getNeonPipelineJobs(options = {}) {
  const pool = getPool();
  if (!pool) return null;
  const includeRetryPending = options?.includeRetryPending !== false;
  try {
    await ensureNeonSchema();
    const res = await pool.query(
      `
      SELECT canonical_key, primary_id, discovered_date, title, company, location, salary,
             description_snippet, score, reasons, gap, apply_url, dm_draft, email_draft,
             resume_angle, stage, evaluation_status, needs_llm_retry, sources_seen
      FROM kaisifos_jobs
      WHERE evaluation_status NOT IN ('REJECTED_GATE', 'REJECTED_PREFILTER')
        AND ($1::boolean OR needs_llm_retry = FALSE)
      ORDER BY discovered_date DESC, score DESC, updated_at DESC
      `,
      [includeRetryPending]
    );
    return res.rows.map((r) => ({
      canonicalKey: r.canonical_key,
      id: r.primary_id,
      date: r.discovered_date,
      title: r.title,
      company: r.company,
      location: r.location || '',
      salary: r.salary || '',
      descriptionSnippet: r.description_snippet || '',
      score: Number(r.score || 0),
      reasons: r.reasons || '',
      gap: r.gap || '',
      url: r.apply_url || '',
      dm: r.dm_draft || '',
      emailDraft: r.email_draft || '',
      resumeAngle: r.resume_angle || '',
      status: r.stage || 'NEW',
      evaluationStatus: r.evaluation_status || 'LLM_SCORED',
      needsLlmRetry: Boolean(r.needs_llm_retry),
      sourcesSeen: Array.isArray(r.sources_seen) ? r.sources_seen : [],
    }));
  } catch (err) {
    console.warn('[NeonDB] getNeonPipelineJobs error:', sanitizePostgresErrorMessage(err));
    return null;
  }
}

export async function updateNeonJobFields(target, patch) {
  const pool = getPool();
  if (!pool) return false;
  try {
    await ensureNeonSchema();
    const idOrKey = target?.id || target?.canonicalKey;
    if (!idOrKey) return false;

    const sets = [];
    const vals = [];
    let idx = 1;

    if (patch.status !== undefined) {
      sets.push(`stage = $${idx++}`);
      vals.push(patch.status);
    }
    if (patch.dm !== undefined) {
      sets.push(`dm_draft = $${idx++}`);
      vals.push(patch.dm);
    }
    if (patch.emailDraft !== undefined) {
      sets.push(`email_draft = $${idx++}`);
      vals.push(patch.emailDraft);
    }
    if (patch.resumeAngle !== undefined) {
      sets.push(`resume_angle = $${idx++}`);
      vals.push(patch.resumeAngle);
    }
    if (patch.gap !== undefined) {
      sets.push(`gap = $${idx++}`);
      vals.push(patch.gap);
    }
    if (patch.score !== undefined) {
      sets.push(`score = $${idx++}`);
      vals.push(Math.round(Number(patch.score)));
    }
    if (patch.reasons !== undefined) {
      sets.push(`reasons = $${idx++}`);
      vals.push(patch.reasons);
    }
    if (patch.evaluationStatus !== undefined) {
      sets.push(`evaluation_status = $${idx++}`);
      vals.push(patch.evaluationStatus);
    }
    if (patch.needsLlmRetry !== undefined) {
      sets.push(`needs_llm_retry = $${idx++}`);
      vals.push(Boolean(patch.needsLlmRetry));
    }

    if (sets.length === 0) return false;
    sets.push(`updated_at = NOW()`);
    vals.push(idOrKey);

    const res = await pool.query(
      `UPDATE kaisifos_jobs SET ${sets.join(', ')} WHERE primary_id = $${idx} OR canonical_key = $${idx}`,
      vals
    );
    return (res.rowCount || 0) > 0;
  } catch (err) {
    console.warn('[NeonDB] updateNeonJobFields error:', sanitizePostgresErrorMessage(err));
    return false;
  }
}

export async function batchUpdateNeonJobStage(targets, status) {
  const pool = getPool();
  if (!pool) return 0;
  try {
    await ensureNeonSchema();
    const keys = targets
      .flatMap((t) => [t?.id, t?.canonicalKey])
      .filter(Boolean);
    if (keys.length === 0) return 0;
    const res = await pool.query(
      `UPDATE kaisifos_jobs SET stage = $1, updated_at = NOW() WHERE primary_id = ANY($2::text[]) OR canonical_key = ANY($2::text[])`,
      [status, keys]
    );
    return res.rowCount || 0;
  } catch (err) {
    console.warn('[NeonDB] batchUpdateNeonJobStage error:', sanitizePostgresErrorMessage(err));
    return 0;
  }
}

export async function readNeonCandidateProfile() {
  const pool = getPool();
  if (!pool) return null;
  try {
    await ensureNeonSchema();
    const res = await pool.query(`SELECT profile_json FROM kaisifos_profile WHERE id = 1`);
    if (res.rows.length > 0 && res.rows[0].profile_json) {
      return res.rows[0].profile_json;
    }
    return null;
  } catch (err) {
    console.warn('[NeonDB] readNeonCandidateProfile warning:', sanitizePostgresErrorMessage(err));
    return null;
  }
}

export async function writeNeonCandidateProfile(profile) {
  const pool = getPool();
  if (!pool) return false;
  try {
    await ensureNeonSchema();
    await pool.query(
      `
      INSERT INTO kaisifos_profile (id, profile_json, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET profile_json = EXCLUDED.profile_json, updated_at = NOW()
      `,
      [JSON.stringify(profile)]
    );
    return true;
  } catch (err) {
    console.warn('[NeonDB] writeNeonCandidateProfile warning:', sanitizePostgresErrorMessage(err));
    return false;
  }
}

export async function recordNeonScoutRun(telemetry) {
  const pool = getPool();
  if (!pool) return false;
  try {
    await ensureNeonSchema();
    const mode = telemetry.mode || telemetry.runner || 'live_sweep';
    const runner = telemetry.runner || telemetry.mode || 'live_sweep';
    const totalFetched = Number(telemetry.totalFetched ?? telemetry.rawFetched ?? 0);
    const canonicalDedupSaved = Number(telemetry.canonicalDedupSaved ?? 0);
    const hardGateRejected = Number(telemetry.hardGateRejected ?? 0);
    const evaluatedCount = Number(telemetry.evaluatedCount ?? 0);
    const committedCount = Number(telemetry.committedCount ?? 0);
    const queuedForRetry = Number(
      telemetry.queuedForRetry ?? telemetry.queuedForRetryCount ?? 0
    );
    const durationMs = Number(telemetry.durationMs ?? 0);
    const sourceCounts = telemetry.sourceCounts || {};
    const hardGateReasons =
      telemetry.hardGateReasons || telemetry.rejectionBreakdown || {};

    await pool.query(
      `
      INSERT INTO kaisifos_scout_runs (
        mode, runner, total_fetched, canonical_dedup_saved, hard_gate_rejected,
        evaluated_count, committed_count, queued_for_retry, duration_ms,
        source_counts, hard_gate_reasons
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
      `,
      [
        mode,
        runner,
        totalFetched,
        canonicalDedupSaved,
        hardGateRejected,
        evaluatedCount,
        committedCount,
        queuedForRetry,
        durationMs,
        JSON.stringify(sourceCounts),
        JSON.stringify(hardGateReasons),
      ]
    );
    return true;
  } catch (err) {
    console.warn('[NeonDB] recordNeonScoutRun warning:', sanitizePostgresErrorMessage(err));
    return false;
  }
}

export async function getNeonAppliedJobs(limit = 200) {
  const pool = getPool();
  if (!pool) return [];
  try {
    await ensureNeonSchema();
    const res = await pool.query(
      `
      SELECT canonical_key, primary_id, title, company
      FROM kaisifos_jobs
      WHERE stage = 'APPLIED'
      ORDER BY updated_at DESC
      LIMIT $1
      `,
      [limit]
    );
    return res.rows.map((r) => ({
      canonicalKey: r.canonical_key,
      id: r.primary_id,
      title: r.title,
      company: r.company,
    }));
  } catch (err) {
    console.warn('[NeonDB] getNeonAppliedJobs warning:', sanitizePostgresErrorMessage(err));
    return [];
  }
}

export async function getNeonTelemetrySummary() {
  const pool = getPool();
  if (!pool) return null;
  try {
    await ensureNeonSchema();
    const countsRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE evaluation_status NOT IN ('REJECTED_GATE', 'REJECTED_PREFILTER')) AS active_jobs,
        COUNT(*) FILTER (WHERE evaluation_status IN ('REJECTED_GATE', 'REJECTED_PREFILTER')) AS rejected_gate_jobs,
        COUNT(*) FILTER (WHERE needs_llm_retry = TRUE AND evaluation_status NOT IN ('REJECTED_GATE', 'REJECTED_PREFILTER')) AS pending_retry_jobs,
        COUNT(*) FILTER (WHERE jsonb_array_length(sources_seen) > 1) AS multi_source_merged_jobs
      FROM kaisifos_jobs
    `);
    const lastRunRes = await pool.query(`
      SELECT run_at, mode, runner, total_fetched, canonical_dedup_saved, hard_gate_rejected,
             evaluated_count, committed_count, queued_for_retry, duration_ms,
             source_counts, hard_gate_reasons
      FROM kaisifos_scout_runs
      ORDER BY id DESC
      LIMIT 1
    `);
    const c = countsRes.rows[0] || {};
    return {
      activeJobs: Number(c.active_jobs || 0),
      rejectedGateJobs: Number(c.rejected_gate_jobs || 0),
      pendingRetryJobs: Number(c.pending_retry_jobs || 0),
      multiSourceMergedJobs: Number(c.multi_source_merged_jobs || 0),
      lastRun: lastRunRes.rows[0] || null,
    };
  } catch {
    return null;
  }
}
