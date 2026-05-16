"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { CareerRow } from "@/lib/types";
import { CAREER_LABELS } from "@/lib/columnLabels";

const CATEGORIES: { key: keyof CareerRow; color: string }[] = [
  { key: "generalHigh",       color: "#94a3b8" },
  { key: "vocationalHigh",    color: "#a78bfa" },
  { key: "scienceHigh",       color: "#06b6d4" },
  { key: "foreignIntlHigh",   color: "#0ea5e9" },
  { key: "artsSportsHigh",    color: "#f59e0b" },
  { key: "meisterHigh",       color: "#84cc16" },
  { key: "privateAutonomous", color: "#ef4444" },
  { key: "publicAutonomous",  color: "#f97316" },
  { key: "other",             color: "#cbd5e1" },
  { key: "employed",          color: "#22c55e" },
  { key: "unemployed",        color: "#475569" },
];

export default function CareerChart({ row }: { row: CareerRow }) {
  const data = CATEGORIES.map((c) => ({
    name: CAREER_LABELS[c.key].label,
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
