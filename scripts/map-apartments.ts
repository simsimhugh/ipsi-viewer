/**
 * apartments × schools 매핑 → apartment_school_map 적재.
 *
 * 세 가지 mode:
 *   --mode pip      : school_districts 폴리곤 in (가장 정확). scripts/poc-pip.ts 재사용.
 *   --mode radius   : 학교 좌표 기준 반경 내 (Node 측 in-memory Haversine, 느림).
 *       추가 옵션: --km <number>  (기본 1.0)
 *   --mode sql      : Supabase RPC rpc_map_apartments_radius로 DB에서 한 번에 매핑.
 *       추가 옵션: --km <number>  (기본 1.0). 사전에 supabase/schema.sql 적용 필요.
 *
 * 환경변수:
 *   SUPABASE_URL              — Supabase URL
 *   SUPABASE_SERVICE_ROLE_KEY — service_role secret (RLS bypass)
 *
 * 사용:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     tsx scripts/map-apartments.ts --mode sql --km 1
 */
import { createClient } from "@supabase/supabase-js";
import { pointInPolygon } from "./poc-pip.js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface SchoolRow {
  shl_idf_cd: string;
  school_name: string;
  lat: number | null;
  lng: number | null;
}
interface AptRow {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
}
interface DistrictRow {
  shl_idf_cd: string | null;
  geom: GeoJSON.Geometry;
}
interface MapRow {
  apt_id: number;
  shl_idf_cd: string;
  distance_m: number | null;
  in_district: boolean;
  source: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Haversine — 미터 단위 거리 (둘 다 lat,lng). */
function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** GeoJSON Polygon / MultiPolygon → ray-cast in. */
function pointInGeom(p: { lat: number; lng: number }, geom: GeoJSON.Geometry): boolean {
  if (geom.type === "Polygon") {
    const outer = geom.coordinates[0].map(([lng, lat]) => ({ lng, lat }));
    return pointInPolygon(p, outer);
  }
  if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      const outer = poly[0].map(([lng, lat]) => ({ lng, lat }));
      if (pointInPolygon(p, outer)) return true;
    }
  }
  return false;
}

async function fetchAll<T>(sb: ReturnType<typeof createClient>, table: string, columns = "*"): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
  }
  return all;
}

async function modeRadius(sb: ReturnType<typeof createClient>, km: number): Promise<MapRow[]> {
  const [schools, apts] = await Promise.all([
    fetchAll<SchoolRow>(sb, "schools", "shl_idf_cd,school_name,lat,lng"),
    fetchAll<AptRow>(sb, "apartments", "id,name,lat,lng"),
  ]);
  const mids = schools.filter((s) => s.lat != null && s.lng != null);
  console.log(`  학교(좌표 보유): ${mids.length}, 아파트(좌표 보유): ${apts.filter(a => a.lat != null && a.lng != null).length}`);

  const radiusM = km * 1000;
  const out: MapRow[] = [];
  for (const a of apts) {
    if (a.lat == null || a.lng == null) continue;
    for (const s of mids) {
      const d = distMeters({ lat: a.lat, lng: a.lng }, { lat: s.lat!, lng: s.lng! });
      if (d <= radiusM) {
        out.push({
          apt_id: a.id,
          shl_idf_cd: s.shl_idf_cd,
          distance_m: Math.round(d),
          in_district: false,
          source: `radius:${km}km`,
        });
      }
    }
  }
  return out;
}

async function modePip(sb: ReturnType<typeof createClient>): Promise<MapRow[]> {
  const [apts, districts] = await Promise.all([
    fetchAll<AptRow>(sb, "apartments", "id,name,lat,lng"),
    fetchAll<DistrictRow>(sb, "school_districts", "shl_idf_cd,geom"),
  ]);
  if (districts.length === 0) {
    console.warn("[pip] school_districts 비어있음 — SHP 적재 필요");
    return [];
  }
  console.log(`  아파트: ${apts.length}, 학구 폴리곤: ${districts.length}`);

  const out: MapRow[] = [];
  for (const a of apts) {
    if (a.lat == null || a.lng == null) continue;
    for (const d of districts) {
      if (!d.shl_idf_cd) continue;
      if (pointInGeom({ lat: a.lat, lng: a.lng }, d.geom)) {
        out.push({ apt_id: a.id, shl_idf_cd: d.shl_idf_cd, distance_m: null, in_district: true, source: "pip" });
      }
    }
  }
  return out;
}

async function batchUpsert(sb: ReturnType<typeof createClient>, rows: MapRow[], chunkSize = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from("apartment_school_map").upsert(chunk);
    if (error) throw new Error(`apartment_school_map upsert: ${error.message}`);
    console.log(`  upsert ${Math.min(i + chunk.length, rows.length)}/${rows.length}`);
  }
}

async function modeSql(sb: ReturnType<typeof createClient>, km: number): Promise<number> {
  // rpc_map_apartments_radius — bounding box pre-filter + Haversine + upsert.
  // 사전 적용 필요: supabase/schema.sql 하단의 rpc_map_apartments_radius 함수.
  const startedAt = Date.now();
  const { data, error } = await sb.rpc("rpc_map_apartments_radius", { p_km: km });
  if (error) throw new Error(`rpc_map_apartments_radius: ${error.message}`);
  const elapsed = (Date.now() - startedAt) / 1000;
  const inserted = typeof data === "number" ? data : Number(data);
  console.log(`  RPC 실행 완료: inserted/updated=${inserted}, elapsed=${Math.round(elapsed)}s`);
  return inserted;
}

async function main() {
  if (!URL || !KEY) {
    console.error("[map-apartments] SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요 — graceful exit.");
    process.exit(0);
  }
  const mode = arg("mode") ?? "sql";
  const km   = Number(arg("km") ?? "1");

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  console.log(`[map-apartments] mode=${mode}${mode === "radius" || mode === "sql" ? ` km=${km}` : ""}`);

  if (mode === "sql") {
    await modeSql(sb, km);
    console.log("OK 완료");
    return;
  }

  let rows: MapRow[];
  if (mode === "pip") rows = await modePip(sb);
  else if (mode === "radius") rows = await modeRadius(sb, km);
  else { console.error(`unknown mode: ${mode} (pip|radius|sql)`); process.exit(1); }

  if (rows.length === 0) {
    console.log("매핑 결과 0건 — 입력 데이터 부족 (apartments 또는 school_districts 미적재).");
    process.exit(0);
  }
  console.log(`매핑 결과 ${rows.length}건 — upsert 시작`);
  await batchUpsert(sb, rows);
  console.log("OK 완료");
}

if (process.argv[1]?.endsWith("/map-apartments.ts")) {
  main().catch((err) => { console.error("❌ 실패:", err); process.exit(1); });
}
