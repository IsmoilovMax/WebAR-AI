"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel, PanelHeader, Stat } from "@/components/ui/primitives";
import { formatPercent } from "@/lib/utils";

interface TimeseriesPoint {
  bucket: string;
  type: string;
  count: number;
}

interface DetectorQuality {
  type: string;
  total: number;
  falsePositives: number;
  falsePositiveRate: number;
  avgConfidence: number;
}

interface DemographicsSlice {
  gender: string;
  ageBucket: string;
  people: number;
  avgDwellSeconds: number;
}

interface HourlyFootfall {
  hour: number;
  people: number;
}

interface CameraLoad {
  cameraId: string;
  cameraName: string;
  events: number;
}

const TYPE_LABELS: Record<string, string> = {
  person_detected: "Odam",
  fire: "Yong'in",
  smoke: "Tutun",
  fall: "Yiqilish",
  smoking: "Chekish",
  zone_intrusion: "Zona",
  loitering: "Uzoq turish",
  camera_offline: "Offline",
  camera_online: "Online",
};

const AGE_LABELS: Record<string, string> = {
  young: "Yosh (0-25)",
  middle: "O'rta (26-50)",
  senior: "Yuqori (51+)",
  unknown: "Noma'lum",
};

const GENDER_LABELS: Record<string, string> = {
  male: "Erkak",
  female: "Ayol",
  unknown: "Noma'lum",
};

export function AnalyticsDashboard({
  days,
  timeseries,
  quality,
  demographics,
  footfall,
  byCamera,
}: {
  days: number;
  timeseries: TimeseriesPoint[];
  quality: DetectorQuality[];
  demographics: DemographicsSlice[];
  footfall: HourlyFootfall[];
  byCamera: CameraLoad[];
}) {
  const byDay = new Map<string, number>();
  for (const point of timeseries) {
    const day = point.bucket.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + point.count);
  }
  const lineData = Array.from(byDay.entries()).map(([day, count]) => ({ day, count }));

  const totalEvents = quality.reduce((sum, row) => sum + row.total, 0);
  const worstFp = quality[0]?.falsePositiveRate ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`${days} kunda hodisalar`} value={totalEvents} />
        <Stat label="Detektorlar" value={quality.length} />
        <Stat
          label="Eng yuqori FP"
          value={formatPercent(worstFp)}
          tone={worstFp > 0.1 ? "danger" : "success"}
        />
        <Stat
          label="Demografiya namunalari"
          value={demographics.reduce((s, d) => s + d.people, 0)}
        />
      </div>

      <Panel>
        <PanelHeader title="Hodisalar tendensiyasi" description={`Oxirgi ${days} kun`} />
        <div className="h-64 px-2 py-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData}>
              <CartesianGrid stroke="var(--color-surface-2)" strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fill: "var(--color-content-muted)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--color-content-muted)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-surface-1)",
                  border: "1px solid var(--color-surface-2)",
                }}
              />
              <Line type="monotone" dataKey="count" stroke="var(--color-brand)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Soatlik tashrif"
            description="Demografiya sighting laridan"
          />
          <div className="h-64 px-2 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={footfall}>
                <CartesianGrid stroke="var(--color-surface-2)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={{ fill: "var(--color-content-muted)", fontSize: 11 }} />
                <YAxis tick={{ fill: "var(--color-content-muted)", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-1)",
                    border: "1px solid var(--color-surface-2)",
                  }}
                />
                <Bar dataKey="people" fill="var(--color-brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Detektor sifati" description="Yolg'on signal ulushi" />
          <ul className="divide-y divide-surface-2">
            {quality.length === 0 ? (
              <li className="px-5 py-8 text-center text-xs text-content-muted">
                Hali ma&apos;lumot yo&apos;q
              </li>
            ) : (
              quality.map((row) => (
                <li key={row.type} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>{TYPE_LABELS[row.type] ?? row.type}</span>
                  <span className="tabular-nums text-content-secondary">
                    {row.total} · FP {formatPercent(row.falsePositiveRate)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Demografiya"
            description="Faqat 3 ta yosh guruhi — aniq yosh berilmaydi"
          />
          <ul className="divide-y divide-surface-2">
            {demographics.length === 0 ? (
              <li className="px-5 py-8 text-center text-xs text-content-muted">
                Demografiya detektori yoqilmagan yoki hali namunalar yo&apos;q
              </li>
            ) : (
              demographics.map((row) => (
                <li
                  key={`${row.gender}-${row.ageBucket}`}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <span>
                    {GENDER_LABELS[row.gender]} · {AGE_LABELS[row.ageBucket]}
                  </span>
                  <span className="tabular-nums text-content-secondary">
                    {row.people} · o&apos;rt. {Math.round(row.avgDwellSeconds)}s
                  </span>
                </li>
              ))
            )}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="Kameralar bo'yicha yuklama" />
          <div className="h-64 px-2 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCamera} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid stroke="var(--color-surface-2)" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: "var(--color-content-muted)", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="cameraName"
                  width={80}
                  tick={{ fill: "var(--color-content-muted)", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-1)",
                    border: "1px solid var(--color-surface-2)",
                  }}
                />
                <Legend />
                <Bar dataKey="events" name="Hodisalar" fill="var(--color-high)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </div>
  );
}
