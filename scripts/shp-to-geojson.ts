/**
 * SHP → GeoJSON 변환 (학구도 폴리곤).
 *
 * 이미 있는 scripts/convert-districts.ts와 같은 역할이지만,
 * 부동산 트랙의 명시적 entry point. 사용자가 SHP 받으면 동작.
 *
 * 입력:
 *   data/raw/middle_zones.{shp,shx,dbf,prj}
 * 출력:
 *   data/districts.geojson  (FeatureCollection, EPSG:4326 가정)
 *
 * 좌표계가 EPSG:5179 등 WGS84 아닐 경우 reproject 단계 별도 필요.
 *
 * TODO: SHP 자료 도착 후
 *   1. data/raw/*.shp 등 4종 파일 배치
 *   2. npm run shp:to-geojson
 *   3. (optional) import-districts.ts 작성 → Supabase school_districts 적재
 */
import { readFile, writeFile, access } from "node:fs/promises";
import { open } from "shapefile";

const SHP_BASE = process.env.SHP_BASE ?? "data/raw/middle_zones";
const OUT_PATH = process.env.SHP_OUT  ?? "data/districts.geojson";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const required = [".shp", ".shx", ".dbf"];
  const missing: string[] = [];
  for (const ext of required) {
    if (!(await exists(`${SHP_BASE}${ext}`))) missing.push(`${SHP_BASE}${ext}`);
  }
  if (missing.length) {
    console.error("[shp-to-geojson] SHP 파일 미발견 — graceful exit.");
    console.error("  필요 파일 (4종 세트):");
    for (const ext of [...required, ".prj"]) console.error(`    ${SHP_BASE}${ext}`);
    console.error("");
    console.error("  다운로드: https://schoolzone.emac.kr/publicData/dataInfo.do");
    console.error("  '중학교 학교군' 또는 '중학교 학구도' SHP 압축 해제 후 위 경로에 배치.");
    process.exit(0);
  }

  if (await exists(`${SHP_BASE}.prj`)) {
    const prj = await readFile(`${SHP_BASE}.prj`, "utf-8");
    console.log(`[좌표계 prj]\n${prj.trim()}\n`);
    if (!/WGS_1984|GCS_WGS|GEOGCS\["GCS_WGS_1984/.test(prj)) {
      console.warn("⚠️  WGS84 아닐 가능성 — reproject 단계 필요 (예: EPSG:5179 → 4326).");
    }
  } else {
    console.warn("⚠️  .prj 없음 — 좌표계 불명. 결과 검증 필수.");
  }

  const source = await open(`${SHP_BASE}.shp`, `${SHP_BASE}.dbf`, { encoding: "euc-kr" });
  const features: GeoJSON.Feature[] = [];
  while (true) {
    const result = await source.read();
    if (result.done) break;
    features.push(result.value as GeoJSON.Feature);
  }

  const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
  await writeFile(OUT_PATH, JSON.stringify(fc), "utf-8");
  console.log(`✅ 저장: ${OUT_PATH} (${features.length} features)`);

  if (features.length > 0) {
    const props = features[0].properties ?? {};
    console.log("\n[샘플 properties — shl_idf_cd 매핑 키 찾기 용]:");
    for (const [k, v] of Object.entries(props)) {
      console.log(`  ${k}: ${typeof v === "string" ? v.slice(0, 40) : v}`);
    }
  }
}

if (process.argv[1]?.endsWith("/shp-to-geojson.ts")) {
  main().catch((err) => { console.error("❌ 실패:", err); process.exit(1); });
}
