/**
 * #6 학구도 SHP → GeoJSON 변환
 *
 * 학구도안내서비스(schoolzone.emac.kr) 또는 공공데이터포털에서
 * "중학교학교군" SHP 파일을 받아 data/raw/ 에 둔 뒤 실행.
 *
 * 필요 파일 (같은 이름의 4개 세트):
 *   data/raw/middle_zones.shp
 *   data/raw/middle_zones.shx
 *   data/raw/middle_zones.dbf
 *   data/raw/middle_zones.prj   (좌표계 정보)
 *
 * 출력: data/districts.geojson (FeatureCollection, EPSG:4326 가정)
 * 주의: 원본이 한국 직각좌표계(예: EPSG:5179)면 좌표 변환이 별도로 필요.
 *       이 PoC는 prj 파일 내용을 출력해 좌표계 확인까지만 한다.
 */
import { readFile, writeFile, access } from "node:fs/promises";
import { open } from "shapefile";

const SHP_BASE = "data/raw/middle_zones";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // 필요 파일 체크
  const required = [".shp", ".shx", ".dbf"];
  for (const ext of required) {
    if (!(await exists(`${SHP_BASE}${ext}`))) {
      console.error(`❌ 누락: ${SHP_BASE}${ext}`);
      console.error("\n다운로드 가이드:");
      console.error("  1. https://schoolzone.emac.kr/publicData/dataInfo.do 접속");
      console.error("  2. '중학교 학교군' 또는 '중학교 학구도' SHP 다운로드 (로그인 필요할 수 있음)");
      console.error(`  3. 압축 해제 후 .shp/.shx/.dbf/.prj 파일을 ${SHP_BASE}.* 로 이름 변경`);
      console.error("  4. 다시 실행: npm run convert:districts\n");
      process.exit(1);
    }
  }

  // .prj 좌표계 정보 출력
  if (await exists(`${SHP_BASE}.prj`)) {
    const prj = await readFile(`${SHP_BASE}.prj`, "utf-8");
    console.log(`[좌표계 prj 내용]\n${prj.trim()}\n`);
    if (!/WGS_1984|GCS_WGS|GEOGCS\["GCS_WGS_1984/.test(prj)) {
      console.warn("⚠️  원본이 WGS84가 아닐 가능성 — 변환 단계가 별도로 필요합니다.");
      console.warn("    (EPSG:5179, EPSG:5181, 또는 TM 중부원점 등)");
    }
  } else {
    console.warn("⚠️  .prj 파일 없음 — 좌표계 불명. 결과 검증 필수.");
  }

  // SHP 읽기
  const source = await open(`${SHP_BASE}.shp`, `${SHP_BASE}.dbf`, { encoding: "euc-kr" });
  const features: GeoJSON.Feature[] = [];
  while (true) {
    const result = await source.read();
    if (result.done) break;
    features.push(result.value as GeoJSON.Feature);
  }

  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  await writeFile("data/districts.geojson", JSON.stringify(fc), "utf-8");
  console.log(`✅ 저장: data/districts.geojson (${features.length} features)`);

  // 첫 feature의 속성 키 출력 — 매핑용
  if (features.length > 0) {
    const props = features[0].properties ?? {};
    console.log("\n[샘플 properties]:");
    for (const [k, v] of Object.entries(props)) {
      console.log(`  ${k}: ${typeof v === "string" ? v.slice(0, 40) : v}`);
    }
  }
}

main().catch((err) => {
  console.error("❌ 실패:", err);
  process.exit(1);
});
