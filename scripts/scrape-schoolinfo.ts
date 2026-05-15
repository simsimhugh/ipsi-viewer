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

  // Ubuntu 26.04는 Playwright 공식 미지원 — 시스템 Chrome을 직접 사용.
  // docs/05-implementation-plan.md "환경 제약" 섹션 참고.
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome-stable",
  });
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
  await page.waitForTimeout(5_000); // lazy-load 메뉴 대기

  // 페이지 타이틀과 보이는 메뉴 항목 dump (구조 파악용)
  const title = await page.title();
  console.log(`    title: ${title}`);

  // [DEBUG-1] 페이지 전체 텍스트에 "졸업" "진로" "진학" 검색
  const bodyText = await page.locator("body").innerText();
  for (const kw of ["졸업", "진로", "진학", "공시", "항목"]) {
    const i = bodyText.indexOf(kw);
    if (i >= 0) {
      console.log(`    [DEBUG] "${kw}" 발견 @${i}: ${bodyText.slice(Math.max(0, i - 30), i + 40).replace(/\s+/g, " ")}`);
    } else {
      console.log(`    [DEBUG] "${kw}" 없음`);
    }
  }

  // [DEBUG-2] iframe enumerate
  const frames = page.frames();
  console.log(`    [DEBUG] frames: ${frames.length}`);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    console.log(`      frame[${i}] url=${f.url().slice(0, 80)}`);
  }

  // [DEBUG-3] 클릭 가능한 요소(링크·버튼·li[onclick]) 한 페이지에 몇 개 있는지 + 텍스트 dump
  const clickables = await page.evaluate(() => {
    const out: Array<{ tag: string; text: string; href: string; onclick: string }> = [];
    document.querySelectorAll("a[href], button, li[onclick], div[onclick], span[onclick]").forEach((el) => {
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (!text) return;
      out.push({
        tag: el.tagName,
        text,
        href: (el as HTMLAnchorElement).href || "",
        onclick: (el.getAttribute("onclick") || "").slice(0, 80),
      });
    });
    return out;
  });
  console.log(`    [DEBUG] clickable: ${clickables.length}`);
  await writeFile("data/samples/sungbok-clickables.json", JSON.stringify(clickables, null, 2), "utf-8");
  console.log("    → data/samples/sungbok-clickables.json");
  // 그 중 "졸업/진로/진학/공시" 포함 항목만
  const relevant = clickables.filter((c) => /(졸업|진로|진학|공시|항목별)/.test(c.text));
  console.log(`    [DEBUG] relevant clickables: ${relevant.length}`);
  for (const r of relevant) console.log(`      ${r.tag} "${r.text}" href=${r.href.slice(0, 60)} onclick=${r.onclick}`);

  // [1.5] 카테고리 탭 4개를 모두 클릭해 lazy-load된 항목 노출
  console.log("\n[1.5] 카테고리 탭 4개 클릭");
  for (const tab of ["교육활동", "교육여건", "학생현황", "학업성취사항"]) {
    const t = page.locator(`a:has-text("${tab}")`).first();
    if ((await t.count()) > 0) {
      await t.click().catch(() => {});
      await page.waitForTimeout(800);
      console.log(`    클릭: ${tab}`);
    } else {
      console.log(`    못찾음: ${tab}`);
    }
  }
  await page.waitForTimeout(2_000);

  // [1.6] 탭 클릭 후 다시 진로/졸업/진학 키워드 검색
  const bodyText2 = await page.locator("body").innerText();
  for (const kw of ["졸업", "진로", "진학"]) {
    const i = bodyText2.indexOf(kw);
    if (i >= 0) {
      console.log(`    [AFTER-TABS] "${kw}" @${i}: ${bodyText2.slice(Math.max(0, i - 20), i + 60).replace(/\s+/g, " ")}`);
    } else {
      console.log(`    [AFTER-TABS] "${kw}" 없음`);
    }
  }

  // [1.7] 진로 관련 onclick/text 가진 모든 요소 dump
  const relevant2 = await page.evaluate(() => {
    const out: Array<{ text: string; onclick: string }> = [];
    document.querySelectorAll("a, button, li, span").forEach((el) => {
      const text = (el.textContent || "").trim().replace(/\s+/g, " ");
      const onclick = el.getAttribute("onclick") || "";
      if (/(졸업|진로|진학)/.test(text + onclick) && text.length < 80) {
        out.push({ text: text.slice(0, 60), onclick: onclick.slice(0, 200) });
      }
    });
    return out;
  });
  console.log(`    [AFTER-TABS] 진로 관련 요소: ${relevant2.length}`);
  for (const r of relevant2) console.log(`      "${r.text}" :: ${r.onclick}`);
  await writeFile("data/samples/sungbok-after-tabs.json", JSON.stringify(relevant2, null, 2), "utf-8");

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
