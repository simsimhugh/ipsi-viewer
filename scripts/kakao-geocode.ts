/**
 * 카카오 Local API 지오코딩.
 *
 * 두 가지 사용 모드:
 *   1) 거래 JSONL → unique 단지 자동 추출 → 좌표 적재 (MVP 메인)
 *      tsx scripts/kakao-geocode.ts --tx ~/hakgun-data/apt-transactions.jsonl \
 *        --out ~/hakgun-data/apartments-geocoded.jsonl
 *
 *   2) 단일 주소 디버그
 *      tsx scripts/kakao-geocode.ts --addr "성남시 분당구 정자일로 1"
 *
 * 환경변수:
 *   KAKAO_REST_API_KEY  — kakao developers REST key.
 *
 * 출력 (JSONL — line 별 1 단지):
 *   { name, sigungu, road_address, lat, lng, built_year, source }
 *
 * Rate limit: 카카오 무료 30만 req/day. 100~200ms sleep + 캐싱 적용.
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
const USER_AGENT = "Mozilla/5.0";

interface GeocodeOut {
  name: string;
  sigungu: string;
  road_address: string | null;
  lat: number | null;
  lng: number | null;
  built_year: number | null;
  source: string;
}

interface TxLine {
  apt_name: string;
  sigungu: string;
  jibun: string;
  road_name: string;
  build_year: number | null;
  lawd_cd?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface KakaoDoc {
  x: string;
  y: string;
  road_address?: { address_name?: string } | null;
  address?: { address_name?: string } | null;
  road_address_name?: string;
  address_name?: string;
}

async function kakaoSearchAddress(query: string): Promise<KakaoDoc | null> {
  if (!KAKAO_KEY) throw new Error("KAKAO_REST_API_KEY env 누락");
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}`, "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    if (res.status === 429) {
      await sleep(1000);
      return null;
    }
    throw new Error(`kakao address ${res.status}: ${await res.text()}`);
  }
  const j = await res.json() as { documents?: KakaoDoc[] };
  return j.documents?.[0] ?? null;
}

async function kakaoSearchKeyword(query: string): Promise<KakaoDoc | null> {
  if (!KAKAO_KEY) throw new Error("KAKAO_REST_API_KEY env 누락");
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}`, "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    if (res.status === 429) {
      await sleep(1000);
      return null;
    }
    throw new Error(`kakao keyword ${res.status}: ${await res.text()}`);
  }
  const j = await res.json() as { documents?: KakaoDoc[] };
  return j.documents?.[0] ?? null;
}

function lawdToFullSido(lawdCd: string | undefined): string {
  if (!lawdCd) return "";
  // 11xxx = 서울, 41xxx = 경기.
  const prefix = lawdCd.slice(0, 2);
  if (prefix === "11") return "서울특별시";
  if (prefix === "41") return "경기도";
  if (prefix === "26") return "부산광역시";
  if (prefix === "27") return "대구광역시";
  if (prefix === "28") return "인천광역시";
  if (prefix === "29") return "광주광역시";
  if (prefix === "30") return "대전광역시";
  if (prefix === "31") return "울산광역시";
  return "";
}

async function geocodeOne(tx: TxLine): Promise<GeocodeOut | null> {
  const sido = lawdToFullSido(tx.lawd_cd);

  // 1) 도로명 주소 우선 (가장 정확) — "<시·도> <법정동> <도로명> <아파트명>"
  if (tx.road_name) {
    const q = [sido, tx.sigungu, tx.road_name, tx.apt_name].filter(Boolean).join(" ");
    try {
      const doc = await kakaoSearchKeyword(q);
      if (doc) return docToOut(doc, tx, "kakao:keyword:road");
    } catch (e) {
      console.warn(`  keyword road 실패 [${tx.apt_name}]: ${(e as Error).message}`);
    }
    await sleep(150);
  }

  // 2) 키워드 — "<시·도> <법정동> <아파트명>"
  const q2 = [sido, tx.sigungu, tx.apt_name].filter(Boolean).join(" ");
  try {
    const doc = await kakaoSearchKeyword(q2);
    if (doc) return docToOut(doc, tx, "kakao:keyword");
  } catch (e) {
    console.warn(`  keyword 실패 [${tx.apt_name}]: ${(e as Error).message}`);
  }
  await sleep(150);

  // 3) 지번 주소 fallback — "<시·도> <법정동> <지번>"
  if (tx.jibun) {
    const q3 = [sido, tx.sigungu, tx.jibun].filter(Boolean).join(" ");
    try {
      const doc = await kakaoSearchAddress(q3);
      if (doc) return docToOut(doc, tx, "kakao:address:jibun");
    } catch (e) {
      console.warn(`  address jibun 실패 [${tx.apt_name}]: ${(e as Error).message}`);
    }
  }
  return null;
}

function docToOut(doc: KakaoDoc, tx: TxLine, source: string): GeocodeOut {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const road = doc.road_address?.address_name ?? doc.road_address_name ?? null;
  return {
    name: tx.apt_name,
    sigungu: tx.sigungu,
    road_address: road,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    built_year: tx.build_year,
    source,
  };
}

interface CacheEntry { name: string; sigungu: string; result: GeocodeOut | null }

async function loadCache(file: string): Promise<Map<string, GeocodeOut | null>> {
  const m = new Map<string, GeocodeOut | null>();
  try { await access(file); } catch { return m; }
  const text = await readFile(file, "utf-8");
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s) as CacheEntry;
      m.set(`${obj.name}||${obj.sigungu}`, obj.result);
    } catch { /* skip */ }
  }
  return m;
}

async function appendCache(file: string, entry: CacheEntry): Promise<void> {
  const line = JSON.stringify(entry) + "\n";
  await writeFile(file, line, { encoding: "utf-8", flag: "a" });
}

async function main() {
  if (!KAKAO_KEY) {
    console.error("[kakao-geocode] KAKAO_REST_API_KEY env 누락 — graceful exit.");
    process.exit(0);
  }

  // --- single address debug ---
  const singleAddr = arg("addr");
  if (singleAddr) {
    const doc = await kakaoSearchAddress(singleAddr);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  // --- bulk: tx jsonl → unique apartments ---
  const txFile = arg("tx");
  const outFile = arg("out") ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data", "apartments-geocoded.jsonl");
  if (!txFile) {
    console.error("필수: --tx <apt-transactions.jsonl> 또는 --addr <주소>");
    process.exit(1);
  }

  const cacheFile = outFile + ".cache.jsonl";
  const cache = await loadCache(cacheFile);
  console.log(`[kakao-geocode] cache 로드: ${cache.size}건`);

  const raw = await readFile(txFile, "utf-8");
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  console.log(`  거래 라인: ${lines.length}`);

  // unique by (apt_name, sigungu) — 첫 등장 row 유지 (build_year/jibun/road 보유 확률 ↑)
  const unique = new Map<string, TxLine>();
  for (const ln of lines) {
    try {
      const tx = JSON.parse(ln) as TxLine;
      if (!tx.apt_name) continue;
      const key = `${tx.apt_name}||${tx.sigungu}`;
      if (!unique.has(key)) {
        unique.set(key, tx);
      } else {
        // build_year/road 빈 칸 보강
        const ex = unique.get(key)!;
        if (!ex.build_year && tx.build_year) ex.build_year = tx.build_year;
        if (!ex.road_name && tx.road_name) ex.road_name = tx.road_name;
        if (!ex.jibun && tx.jibun) ex.jibun = tx.jibun;
      }
    } catch { /* skip */ }
  }
  console.log(`  unique 단지: ${unique.size}`);

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, "", "utf-8"); // truncate

  let okCount = 0;
  let failCount = 0;
  let cacheHit = 0;
  let idx = 0;
  const entries = Array.from(unique.values());

  for (const tx of entries) {
    idx++;
    const key = `${tx.apt_name}||${tx.sigungu}`;
    let result: GeocodeOut | null;
    if (cache.has(key)) {
      result = cache.get(key) ?? null;
      cacheHit++;
    } else {
      try {
        result = await geocodeOne(tx);
      } catch (e) {
        console.warn(`  [${idx}/${entries.length}] ${tx.apt_name}: ${(e as Error).message}`);
        result = null;
      }
      await appendCache(cacheFile, { name: tx.apt_name, sigungu: tx.sigungu, result });
      await sleep(120 + Math.random() * 80);
    }
    if (result && result.lat != null && result.lng != null) {
      await writeFile(outFile, JSON.stringify(result) + "\n", { encoding: "utf-8", flag: "a" });
      okCount++;
    } else {
      failCount++;
    }
    if (idx % 50 === 0) {
      console.log(`  [${idx}/${entries.length}] ok=${okCount} fail=${failCount} cache=${cacheHit}`);
    }
  }
  console.log(`\nOK 지오코딩 완료: ok=${okCount} fail=${failCount} cache=${cacheHit} → ${outFile}`);
}

if (process.argv[1]?.endsWith("/kakao-geocode.ts")) {
  main().catch((err) => { console.error("실패:", err); process.exit(1); });
}
