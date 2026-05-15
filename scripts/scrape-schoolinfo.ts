/**
 * #5 학교알리미 진학현황 Playwright 스크래퍼 PoC
 *
 * 성복중학교(SHL_IDF_CD=16eebf60-3c71-415a-bd10-1a1ad55b0094) 단일 학교 대상
 * "졸업생의 진로 현황" 테이블 추출.
 *
 * 페이지 진입 → 공시기준년(2025) 선택 → "학생현황" 탭 클릭 →
 * "졸업생의 진로 현황" 링크(loadGongSi) 클릭 → 로드된 테이블 캡처.
 *
 * Ubuntu 26.04는 Playwright 공식 미지원이라 시스템 google-chrome-stable을 직접 사용한다.
 * 사전: sudo apt-get install -y google-chrome-stable
 */
import { chromium, type Frame } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const SUNGBOK_SHL_IDF = "16eebf60-3c71-415a-bd10-1a1ad55b0094";
const ENTRY_URL = `https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${SUNGBOK_SHL_IDF}`;
const YEAR = process.env.YEAR ?? "2025";

async function dumpFrames(frames: readonly Frame[]) {
  for (let i = 0; i < frames.length; i++) {
    console.log(`    frame[${i}] url=${frames[i].url().slice(0, 120)}`);
  }
}

async function main() {
  await mkdir("data/samples", { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome-stable",
  });
  const ctx = await browser.newContext({
    locale: "ko-KR",
    userAgent:
      "Mozilla/5.0 (Linux; school-admission-viewer-poc) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  // 진로 현황 응답 캡처 (Pneipp_b06_*가 핵심)
  const xhrLog: Array<{ url: string; method: string; status: number; bytes: number; bodyFile?: string }> = [];
  let careerBodyIdx = 0;
  page.on("response", async (res) => {
    const req = res.request();
    if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch" && req.resourceType() !== "document") {
      return;
    }
    const url = req.url();
    const entry = { url, method: req.method(), status: res.status(), bytes: 0 } as (typeof xhrLog)[number];
    try {
      const body = await res.text();
      entry.bytes = body.length;
      if (/Pneipp_b06|loadGongSi|JG040|JG130|졸업|진로/.test(url) || (req.method() === "POST" && body.length > 0)) {
        const file = `data/samples/career-resp-${String(careerBodyIdx).padStart(2, "0")}.html`;
        await writeFile(file, body, "utf-8");
        entry.bodyFile = file;
        careerBodyIdx++;
      }
    } catch {
      /* 일부 응답은 body 추출 실패 */
    }
    xhrLog.push(entry);
  });

  console.log(`[1] 페이지 진입: ${ENTRY_URL}`);
  await page.goto(ENTRY_URL, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1_500);

  console.log(`[2] 공시기준년 = ${YEAR} (select + goSearForm submit)`);
  // 페이지 진입 시점의 default 연도 확인
  const defaultYear = await page.evaluate(() => (document.getElementById("gsYear") as HTMLSelectElement)?.value);
  console.log(`    default gsYear = ${defaultYear}`);

  if (defaultYear !== YEAR) {
    // select 값을 바꾸고, 옆의 "선택" 버튼이 호출하는 goSearForm('gsYear')을 직접 발화 → form submit → 페이지 reload
    await page.selectOption("#gsYear", YEAR);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 }).catch(() => {}),
      page.evaluate(() => (window as unknown as { goSearForm: (s: string) => void }).goSearForm("gsYear")),
    ]);
    await page.waitForTimeout(1_500);
    const afterReloadYear = await page.evaluate(() => (document.getElementById("gsYear") as HTMLSelectElement)?.value);
    console.log(`    reload 후 gsYear = ${afterReloadYear}`);
  } else {
    console.log(`    이미 ${YEAR} — reload 생략`);
  }

  console.log("[3] '학생현황' 탭 클릭");
  // 사용자 제보: <a data-tab-id="anynameyouwant3"> 학생현황
  const studentTab = page.locator('a[data-tab-id="anynameyouwant3"]').first();
  if (await studentTab.count()) {
    console.log(`    data-tab-id 매칭 found, click`);
    await studentTab.click();
  } else {
    console.warn("    data-tab-id 매칭 실패 — 텍스트로 fallback");
    await page.locator('a:has-text("학생현황")').first().click();
  }
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(3_000);

  // [DEBUG] 학생현황 탭 클릭 후 DOM 상태
  const debugAfterStudentTab = await page.evaluate(() => {
    const active = document.querySelector('a.pws_tab_active');
    const allTabs = Array.from(document.querySelectorAll('a[data-tab-id]')).map((el) => ({
      id: el.getAttribute('data-tab-id'),
      text: (el.textContent || '').trim(),
      classes: el.className,
      ariaCurrent: el.getAttribute('aria-current'),
    }));
    const careerLinks = Array.from(document.querySelectorAll('a[onclick*="Pneipp_b06"], a[onclick*="진로"]'))
      .map((el) => ({
        text: (el.textContent || '').trim().slice(0, 50),
        onclick: (el.getAttribute('onclick') || '').slice(0, 200),
      }));
    const bodyHas졸업 = document.body.innerText.includes('졸업');
    const bodyHas진로 = document.body.innerText.includes('진로');
    return { active: active?.textContent?.trim(), allTabs, careerLinks, bodyHas졸업, bodyHas진로 };
  });
  console.log(`    [DEBUG] active tab: ${debugAfterStudentTab.active}`);
  console.log(`    [DEBUG] tabs:`, JSON.stringify(debugAfterStudentTab.allTabs));
  console.log(`    [DEBUG] body에 "졸업"=${debugAfterStudentTab.bodyHas졸업}, "진로"=${debugAfterStudentTab.bodyHas진로}`);
  console.log(`    [DEBUG] career link 후보: ${debugAfterStudentTab.careerLinks.length}건`);
  for (const c of debugAfterStudentTab.careerLinks) {
    console.log(`      "${c.text}" :: ${c.onclick}`);
  }

  console.log("[4] '졸업생의 진로 현황' 링크 클릭");
  // 가장 명확한 선택자: onclick에 Pneipp_b06_s0p.do + 졸업생의 진로 현황
  const link = page
    .locator('a[onclick*="Pneipp_b06_s0p.do"][onclick*="졸업생의 진로 현황"]')
    .first();
  if ((await link.count()) === 0) {
    console.warn("    onclick 매칭 실패 — 텍스트로 fallback");
    const byText = page.getByText("졸업생의 진로 현황", { exact: false }).first();
    if ((await byText.count()) === 0) {
      console.error("    텍스트 매칭도 실패 — 페이지/XHR dump 후 종료");
      await writeFile("data/samples/sungbok-after-student-tab.html", await page.content(), "utf-8");
      await page.screenshot({ path: "data/samples/sungbok-after-student-tab.png", fullPage: true });
      await writeFile("data/samples/sungbok-career-xhr.json", JSON.stringify(xhrLog, null, 2), "utf-8");
      console.error(`    XHR 캡처 ${xhrLog.length}건 저장`);
      await browser.close();
      process.exit(2);
    }
    await byText.click({ timeout: 10_000 });
  } else {
    await link.click();
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2_500);

  console.log("[5] 결과 캡처");
  // loadGongSi가 결과를 #gongsiInfo div에 채워 넣음
  const gongsiInfoHtml = await page.locator("#gongsiInfo").innerHTML().catch(() => "");
  console.log(`    #gongsiInfo bytes=${gongsiInfoHtml.length}`);
  await writeFile("data/samples/sungbok-gongsi-info.html", gongsiInfoHtml, "utf-8");

  const frames = page.frames();
  console.log(`    frames=${frames.length}`);
  await dumpFrames(frames);

  // #gongsiInfo 안의 table을 우선적으로 추출
  const tableDumps: string[] = [];
  const gongsiTableCount = await page.locator("#gongsiInfo table").count().catch(() => 0);
  for (let j = 0; j < gongsiTableCount; j++) {
    const html = await page.locator("#gongsiInfo table").nth(j).innerHTML().catch(() => "");
    if (!html) continue;
    tableDumps.push(`<!-- #gongsiInfo table[${j}] -->\n<table>${html}</table>`);
  }
  console.log(`    #gongsiInfo tables=${gongsiTableCount}`);

  // 그 외 frame의 table들 (fallback)
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f === page.mainFrame()) continue;
    const count = await f.locator("table").count().catch(() => 0);
    for (let j = 0; j < count; j++) {
      const html = await f.locator("table").nth(j).innerHTML().catch(() => "");
      if (!html) continue;
      tableDumps.push(`<!-- frame[${i}] table[${j}] url=${f.url()} -->\n<table>${html}</table>`);
    }
  }
  console.log(`    total table dumps=${tableDumps.length}`);
  await writeFile(
    "data/samples/sungbok-career-tables.html",
    tableDumps.join("\n\n"),
    "utf-8",
  );

  // 전체 HTML 보존 (다음 파싱 단계용)
  await writeFile("data/samples/sungbok-career-full.html", await page.content(), "utf-8");
  await page.screenshot({ path: "data/samples/sungbok-career.png", fullPage: true });

  await writeFile("data/samples/sungbok-career-xhr.json", JSON.stringify(xhrLog, null, 2), "utf-8");
  console.log(`[6] XHR ${xhrLog.length}건 → sungbok-career-xhr.json`);
  console.log("    저장된 응답 body: data/samples/career-resp-*.html");
  console.log("    스크린샷: data/samples/sungbok-career.png");

  await browser.close();
}

main().catch((err) => {
  console.error("실패:", err);
  process.exit(1);
});
