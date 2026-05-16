/**
 * 카카오 Local API 지오코딩.
 *
 * 입력: 주소 (road_address 또는 지번 주소) — JSONL or argv.
 * 출력: { address, lat, lng, road_address } JSONL.
 *
 * 환경변수:
 *   KAKAO_REST_API_KEY  — kakao developers에서 발급한 REST API key.
 *
 * 사용:
 *   KAKAO_REST_API_KEY=xxx tsx scripts/kakao-geocode.ts --in addresses.jsonl --out geocoded.jsonl
 *   KAKAO_REST_API_KEY=xxx tsx scripts/kakao-geocode.ts --addr "성남시 분당구 정자일로 1"
 *
 * Rate limit: 카카오 무료 300,000 req/day. 본 script는 100ms 간격 sleep.
 *
 * TODO: 키 도착 후
 *   1. .env.local에 KAKAO_REST_API_KEY 추가 (commit 금지)
 *   2. 학교 마스터의 빈 lat/lng 보강 또는 아파트 주소 → 좌표 변환
 */
import { readFile, writeFile } from "node:fs/promises";

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;

interface GeocodeResult {
  address: string;
  road_address: string | null;
  lat: number | null;
  lng: number | null;
}

async function geocodeOne(address: string): Promise<GeocodeResult> {
  if (!KAKAO_KEY) throw new Error("KAKAO_REST_API_KEY env 누락");
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  if (!res.ok) throw new Error(`kakao ${res.status}: ${await res.text()}`);
  const json = await res.json() as { documents?: Array<{ x: string; y: string; road_address?: { address_name?: string } | null }> };
  const doc = json.documents?.[0];
  if (!doc) return { address, road_address: null, lat: null, lng: null };
  return {
    address,
    road_address: doc.road_address?.address_name ?? null,
    lat: Number(doc.y),
    lng: Number(doc.x),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!KAKAO_KEY) {
    console.error("[kakao-geocode] KAKAO_REST_API_KEY env 누락 — graceful exit.");
    console.error("  발급: https://developers.kakao.com → 내 애플리케이션 → REST API 키");
    console.error("  사용 예시:");
    console.error("    KAKAO_REST_API_KEY=xxx tsx scripts/kakao-geocode.ts --addr '성남시 분당구 정자일로 1'");
    process.exit(0);
  }

  const singleAddr = arg("addr");
  if (singleAddr) {
    const r = await geocodeOne(singleAddr);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const inFile  = arg("in");
  const outFile = arg("out");
  if (!inFile || !outFile) {
    console.error("[kakao-geocode] --in <jsonl> --out <jsonl> 또는 --addr <주소> 필요");
    process.exit(1);
  }

  const lines = (await readFile(inFile, "utf-8")).split("\n").map((s) => s.trim()).filter(Boolean);
  const results: GeocodeResult[] = [];
  for (let i = 0; i < lines.length; i++) {
    const obj = JSON.parse(lines[i]) as { address?: string };
    if (!obj.address) continue;
    try {
      const r = await geocodeOne(obj.address);
      results.push(r);
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${lines.length}`);
    } catch (e) {
      console.warn(`  ${i}: ${(e as Error).message}`);
    }
    await sleep(100);
  }
  await writeFile(outFile, results.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  console.log(`✅ 저장: ${outFile} (${results.length}건)`);
}

if (process.argv[1]?.endsWith("/kakao-geocode.ts")) {
  main().catch((err) => { console.error("❌ 실패:", err); process.exit(1); });
}
