/**
 * #5 학교알리미 진학현황 Playwright 스크래퍼 PoC
 *
 * 성복중학교 단일 학교 대상 졸업생 진로 현황 데이터 추출.
 * SHL_IDF_CD=16eebf60-3c71-415a-bd10-1a1ad55b0094
 *
 * 학교알리미 페이지는 JS 렌더링이라 Playwright(chromium) 필요.
 * 첫 실행: npx playwright install chromium
 *
 * 출력: data/samples/sungbok-career.json
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const SUNGBOK_SHL_IDF = "16eebf60-3c71-415a-bd10-1a1ad55b0094";
const SCHOOL_INFO_URL = `https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${SUNGBOK_SHL_IDF}`;

async function main() {
  await mkdir("data/samples", { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; school-admission-viewer-poc) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    locale: "ko-KR",
  });
  const page = await ctx.newPage();

  // 네트워크 요청 캡처 — AJAX 엔드포인트 발견용
  const xhrLog: Array<{ url: string; method: string; status?: number }> = [];
  page.on("response", async (res) => {
    const req = res.request();
    if (req.resourceType() === "xhr" || req.resourceType() === "fetch") {
      xhrLog.push({ url: req.url(), method: req.method(), status: res.status() });
    }
  });

  console.log(`[1] 페이지 진입: ${SCHOOL_INFO_URL}`);
  await page.goto(SCHOOL_INFO_URL, { waitUntil: "networkidle", timeout: 30_000 });

  // 페이지 타이틀과 보이는 메뉴 항목 dump (구조 파악용)
  const title = await page.title();
  console.log(`    title: ${title}`);

  // 좌측/상단 메뉴에서 "졸업생" 또는 "진로" 텍스트를 가진 클릭 가능 요소 찾기
  const candidates = await page
    .locator('a, button, li, span:has-text("졸업생"), span:has-text("진로"), span:has-text("진학")')
    .all();

  console.log(`[2] 진로/진학 관련 후보 ${candidates.length}건`);
  const visibleLabels: string[] = [];
  for (const el of candidates) {
    try {
      const text = (await el.textContent())?.trim();
      if (!text) continue;
      if (/(졸업생|진로|진학)/.test(text) && text.length < 50) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) visibleLabels.push(text);
      }
    } catch {}
  }
  const uniqLabels = [...new Set(visibleLabels)];
  console.log("    표시 라벨:", uniqLabels);

  // 졸업생 진로 현황 항목 클릭 시도 (텍스트 매칭)
  console.log("[3] '졸업생의 진로 현황' 클릭 시도");
  let clicked = false;
  for (const text of [
    "졸업생의 진로 현황",
    "졸업생의 진로현황",
    "졸업생 진로 현황",
    "졸업생 진로현황",
  ]) {
    const target = page.getByText(text, { exact: false }).first();
    if (await target.count()) {
      try {
        await target.click({ timeout: 5000 });
        clicked = true;
        console.log(`    클릭: "${text}"`);
        break;
      } catch (e) {
        console.log(`    실패: "${text}" — ${(e as Error).message}`);
      }
    }
  }

  if (clicked) {
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    // 데이터 영역(table) HTML 캡처
    const tables = await page.locator("table").all();
    console.log(`[4] 페이지 내 table ${tables.length}개`);
    const tableHtml: string[] = [];
    for (let i = 0; i < tables.length; i++) {
      const html = await tables[i].innerHTML().catch(() => "");
      tableHtml.push(html);
    }
    await writeFile("data/samples/sungbok-career-tables.html", tableHtml.join("\n\n<!-- ===== -->\n\n"), "utf-8");
    console.log("    → data/samples/sungbok-career-tables.html");

    // 스크린샷도 남김
    await page.screenshot({ path: "data/samples/sungbok-career.png", fullPage: true });
    console.log("    → data/samples/sungbok-career.png");
  } else {
    console.log("[4] 진로현황 항목 클릭 못함 — 페이지 구조 dump");
    await page.screenshot({ path: "data/samples/sungbok-landing.png", fullPage: true });
    const html = await page.content();
    await writeFile("data/samples/sungbok-landing.html", html, "utf-8");
    console.log("    → data/samples/sungbok-landing.{html,png}");
  }

  // XHR 로그 저장
  await writeFile("data/samples/sungbok-xhr.json", JSON.stringify(xhrLog, null, 2), "utf-8");
  console.log(`[5] XHR ${xhrLog.length}건 → data/samples/sungbok-xhr.json`);

  await browser.close();
}

main().catch(async (err) => {
  console.error("❌ 실패:", err);
  process.exit(1);
});
