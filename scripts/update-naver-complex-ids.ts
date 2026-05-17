/**
 * naver-complex-mapping.jsonl → apartments.naver_complex_id 컬럼에 update.
 *
 * 입력: ~/hakgun-data/naver-complex-mapping.jsonl
 * 출력: apartments 테이블에 naver_complex_id 일괄 update.
 *
 * 사전 조건: SQL migration (column add) 이미 적용.
 *   alter table apartments add column if not exists naver_complex_id int;
 *   create index if not exists apartments_naver_idx on apartments(naver_complex_id);
 *
 * 환경:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   HAKGUN_DATA_DIR (기본 ~/hakgun-data)
 *
 * 사용:
 *   tsx scripts/update-naver-complex-ids.ts
 */
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ─── .env.local 자동 로드 ──────────────────────────────────────────────
(function loadDotenvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  const raw = readFileSync(file, "utf-8");
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
})();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = process.env.HAKGUN_DATA_DIR ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data");
const INFILE = path.join(DATA_DIR, "naver-complex-mapping.jsonl");

interface MappingResult {
  apt_id: number;
  naver_id: number | null;
  status: string;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[update-naver] SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요");
    process.exit(1);
  }

  const raw = await readFile(INFILE, "utf-8");
  const rows: MappingResult[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { rows.push(JSON.parse(s) as MappingResult); } catch { /* skip corrupt */ }
  }
  console.log(`[1/2] jsonl: ${rows.length}건`);

  const matched = rows.filter((r) => r.naver_id != null);
  console.log(`  매칭된 단지: ${matched.length}건`);

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  // chunked update — Supabase는 bulk update 직접 지원 X. 개별 update 직렬화.
  // 32k건이지만 매칭된 것만 update → 보통 수천 건. parallel 8 worker.
  console.log(`[2/2] apartments update (workers=8)...`);
  let cursor = 0;
  let okCount = 0, errCount = 0;
  const start = Date.now();

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= matched.length) return;
      const r = matched[idx];
      const { error } = await sb
        .from("apartments")
        .update({ naver_complex_id: r.naver_id })
        .eq("id", r.apt_id);
      if (error) {
        errCount++;
        console.warn(`  [${r.apt_id}] update 실패: ${error.message}`);
      } else {
        okCount++;
      }
      if ((okCount + errCount) % 200 === 0) {
        const elapsed = (Date.now() - start) / 1000;
        console.log(`  [${okCount + errCount}/${matched.length}] ok=${okCount} err=${errCount} elapsed=${elapsed.toFixed(0)}s`);
      }
    }
  }

  await Promise.all(Array.from({ length: 8 }, () => worker()));

  console.log(`\n완료: update ok=${okCount}, err=${errCount}`);
}

main().catch((e) => { console.error("실패:", e); process.exit(1); });
