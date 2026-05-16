/**
 * Supabase schools 테이블에서 중학교 SHL_IDF_CD 추출 → stdout (or 파일).
 *
 * weekly/manual sync 워크플로에서 batch-fetch input 만들 때 사용.
 * master.jsonl 없이도 SHL list 확보 가능.
 *
 * 사용:
 *   tsx scripts/extract-middle-shl.ts > data/sync/middle.txt
 *
 * 환경변수:
 *   SUPABASE_URL              — 또는 NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY — 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY (RLS public read OK)
 */
import { createClient } from "@supabase/supabase-js";

const URL  = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error("SUPABASE_URL + KEY 환경변수 필요");
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  const PAGE = 1000;
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("schools")
      .select("shl_idf_cd")
      .eq("kind", "중학교")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`schools fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) ids.push(r.shl_idf_cd as string);
    if (data.length < PAGE) break;
  }
  console.error(`[extract-middle-shl] ${ids.length} 중학교 SHL`);
  process.stdout.write(ids.join("\n") + "\n");
}

main().catch((e) => { console.error("실패:", e); process.exit(1); });
