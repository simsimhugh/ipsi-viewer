/**
 * Point-in-Polygon PoC — 아파트 단지 좌표 → 배정 중학교 매핑.
 *
 * 실제 학구도 SHP / 카카오 좌표가 아직 없어서 가짜 데이터로 알고리즘 검증.
 * SHP 받자마자 convert-districts.ts로 GeoJSON 변환 후 이 함수 그대로 재사용.
 *
 * 알고리즘: ray casting (의존성 없이 ~10줄). 학구 ~700개 × 아파트 ~10000동 = 7M 비교 < 1초.
 *
 * 추후 최적화 후보: bounding box pre-filter, R-tree, KD-tree (필요할 때).
 */

export interface LngLat { lng: number; lat: number; }
export interface SchoolZone {
  schoolName: string;
  SHL_IDF_CD?: string;
  coords: LngLat[]; // 단순 폴리곤 (첫=끝)
}
export interface Apartment {
  name: string;
  point: LngLat;
}

/** ray casting (좌→우 horizontal). 폴리곤 경계 위는 미정의(통상 안 쓰임). */
export function pointInPolygon(p: LngLat, polygon: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect = ((yi > p.lat) !== (yj > p.lat)) &&
      (p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 단지 좌표가 속한 학구 검색. 없으면 null. */
export function findSchool(p: LngLat, zones: SchoolZone[]): SchoolZone | null {
  for (const z of zones) if (pointInPolygon(p, z.coords)) return z;
  return null;
}

// ── PoC 검증 데이터 ─────────────────────────────────────────────────────
// 용인 수지구 부근 가짜 좌표. 두 학구가 lng=127.09에서 인접.
const SCHOOL_ZONES: SchoolZone[] = [
  {
    schoolName: "성복중학교",
    coords: [
      { lng: 127.07, lat: 37.31 },
      { lng: 127.09, lat: 37.31 },
      { lng: 127.09, lat: 37.33 },
      { lng: 127.07, lat: 37.33 },
    ],
  },
  {
    schoolName: "성서중학교",
    coords: [
      { lng: 127.09, lat: 37.31 },
      { lng: 127.11, lat: 37.31 },
      { lng: 127.11, lat: 37.33 },
      { lng: 127.09, lat: 37.33 },
    ],
  },
];

const APARTMENTS: Apartment[] = [
  { name: "성복자이",       point: { lng: 127.075, lat: 37.319 } }, // 성복중
  { name: "성복힐스테이트", point: { lng: 127.080, lat: 37.320 } }, // 성복중
  { name: "성복센트럴",     point: { lng: 127.095, lat: 37.320 } }, // 성서중
  { name: "수지구청앞",     point: { lng: 127.105, lat: 37.321 } }, // 성서중
  { name: "수지구밖",       point: { lng: 127.115, lat: 37.320 } }, // null
];

function main() {
  console.log("[PIP PoC] 가짜 학구 2개 × 아파트 5개");
  let ok = 0, miss = 0;
  for (const apt of APARTMENTS) {
    const z = findSchool(apt.point, SCHOOL_ZONES);
    if (z) ok++; else miss++;
    console.log(`  ${apt.name.padEnd(20)} → ${z?.schoolName ?? "(범위 밖)"}`);
  }
  console.log(`\n매칭=${ok}, 범위밖=${miss}`);
  // 기대: 4 매칭 (성복자이/성복힐스테이트/성복센트럴/수지구청앞) + 1 범위밖 (수지구밖)
  const expected = { matched: 4, outside: 1 };
  if (ok === expected.matched && miss === expected.outside) {
    console.log("✓ 알고리즘 검증 PASS");
  } else {
    console.error(`✗ 검증 FAIL — 기대 ${expected.matched}/${expected.outside}, 실측 ${ok}/${miss}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("/poc-pip.ts")) main();
