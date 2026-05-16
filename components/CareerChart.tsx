"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { CareerRow } from "@/lib/types";

const CATEGORIES: { key: keyof CareerRow; label: string; color: string }[] = [
  { key: "generalHigh",      label: "일반고",       color: "#94a3b8" },
  { key: "vocationalHigh",   label: "특성화고",     color: "#a78bfa" },
  { key: "scienceHigh",      label: "과학고",       color: "#06b6d4" },
  { key: "foreignIntlHigh",  label: "외고/국제고",  color: "#0ea5e9" },
  { key: "artsSportsHigh",   label: "예체고",       color: "#f59e0b" },
  { key: "meisterHigh",      label: "마이스터고",   color: "#84cc16" },
  { key: "privateAutonomous",label: "자율형사립고", color: "#ef4444" },
  { key: "publicAutonomous", label: "자율형공립고", color: "#f97316" },
  { key: "other",            label: "기타",         color: "#cbd5e1" },
  { key: "employed",         label: "취업",         color: "#22c55e" },
  { key: "unemployed",       label: "무직/미상",    color: "#475569" },
];

export default function CareerChart({ row }: { row: CareerRow }) {
  const data = CATEGORIES.map((c) => ({
    name: c.label,
    value: row[c.key] ?? 0,
    color: c.color,
  })).filter((d) => d.value > 0);

  return (
    <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v: number) => [`${v}명`, ""]}
            labelStyle={{ fontSize: 12 }}
            contentStyle={{ fontSize: 12 }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
