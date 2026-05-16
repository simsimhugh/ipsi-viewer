"use client";

import { useEffect } from "react";

/**
 * production 전용 보호 layer.
 * - 글씨 선택·복사·우클릭·드래그·모바일 long-press 차단
 * - DevTools 진입 키 (F12, Ctrl+Shift+I/J/C, Ctrl+U) 차단
 * 결심한 사용자는 우회 가능. 일반 사용자의 무심한 카피·캡쳐 의도 방지가 목적.
 */
export default function ProtectionLayer() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    document.body.classList.add("protected");

    const stop = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase();
      if (k === "F12") { e.preventDefault(); return; }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && (k === "I" || k === "J" || k === "C")) { e.preventDefault(); return; }
      if (ctrl && k === "U") { e.preventDefault(); return; }
      if (ctrl && (k === "C" || k === "X" || k === "S" || k === "P" || k === "A")) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
      }
    };

    document.addEventListener("copy", stop);
    document.addEventListener("cut", stop);
    document.addEventListener("contextmenu", stop);
    document.addEventListener("dragstart", stop);
    document.addEventListener("selectstart", (e) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
    });
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.classList.remove("protected");
      document.removeEventListener("copy", stop);
      document.removeEventListener("cut", stop);
      document.removeEventListener("contextmenu", stop);
      document.removeEventListener("dragstart", stop);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return null;
}
