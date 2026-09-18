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
  person_detected: "사람",
  fire: "화재",
  smoke: "연기",
  fall: "낙상",
  smoking: "흡연",
  zone_intrusion: "구역",
  loitering: "배회",
  camera_offline: "오프라인",
  camera_online: "온라인",
};

const AGE_LABELS: Record<string, string> = {
  young: "어린이 (0-25)",
  middle: "중년 (26-50)",
  senior: "노인 (51+)",
  unknown: "미확인",
};

const GENDER_LABELS: Record<string, string> = {
  male: "남자",
  female: "여자",
  unknown: "미확인",
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
      <div className="panel grid grid-cols-2 md:grid-cols-4">
        <Stat label={`${days}일 이벤트`} value={totalEvents} />
        <Stat label="감지기" value={quality.length} />
        <Stat
          label="최고 오탐률"
          value={formatPercent(worstFp)}
          tone={worstFp > 0.1 ? "danger" : "success"}
        />
        <Stat
          label="인구통계 샘플"
          value={demographics.reduce((s, d) => s + d.people, 0)}
        />
      </div>

      <Panel>
        <PanelHeader title="이벤트 추이" description={`최근 ${days}일`} />
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
          <PanelHeader title="시간대별 방문" description="인구통계 감지 기준" />
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
          <PanelHeader title="감지기 품질" description="오탐 비율" />
          <ul className="divide-y divide-surface-2">
            {quality.length === 0 ? (
              <li className="px-5 py-8 text-center text-xs text-content-muted">
                아직 데이터가 없습니다
              </li>
            ) : (
              quality.map((row) => (
                <li key={row.type} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>{TYPE_LABELS[row.type] ?? row.type}</span>
                  <span className="tabular-nums text-content-secondary">
                    {row.total} · 오탐 {formatPercent(row.falsePositiveRate)}
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
            title="인구통계"
            description="3개 연령대만 제공 — 정확한 나이는 표시되지 않습니다"
          />
          <ul className="divide-y divide-surface-2">
            {demographics.length === 0 ? (
              <li className="px-5 py-8 text-center text-xs text-content-muted">
                인구통계 감지기가 꺼져 있거나 샘플이 없습니다
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
                    {row.people} · 평균 {Math.round(row.avgDwellSeconds)}초
                  </span>
                </li>
              ))
            )}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="카메라별 부하" />
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
                <Bar dataKey="events" name="이벤트" fill="var(--color-high)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </div>
  );
}
