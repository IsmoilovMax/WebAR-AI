"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import type { DetectionZone, ZoneKind } from "@acs/types";
import { ZONE_KINDS } from "@acs/types";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { saveZonesAction } from "@/app/(dashboard)/cameras/actions";

const ZONE_LABELS: Record<ZoneKind, string> = {
  include: "포함 구역",
  exclude: "제외 구역",
  no_smoking: "금연 구역",
  restricted: "제한 구역",
};

const COLORS: Record<ZoneKind, string> = {
  include: "#7c4dff",
  exclude: "#64748b",
  no_smoking: "#ff9800",
  restricted: "#ef5350",
};

interface DraftZone {
  name: string;
  kind: ZoneKind;
  polygon: [number, number][];
  detectors: string[];
}

export function ZoneEditor({
  cameraId,
  initialZones,
}: {
  cameraId: string;
  initialZones: DetectionZone[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zones, setZones] = useState<DraftZone[]>(
    initialZones.map((z) => ({
      name: z.name,
      kind: z.kind,
      polygon: z.polygon,
      detectors: z.detectors,
    })),
  );
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [name, setName] = useState("구역 1");
  const [kind, setKind] = useState<ZoneKind>("restricted");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toNorm = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return [
      Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    ];
  }, []);

  function onClick(event: React.MouseEvent<SVGSVGElement>) {
    const point = toNorm(event.clientX, event.clientY);
    if (!point) return;
    setDraft((prev) => [...prev, point]);
  }

  function finishZone() {
    if (draft.length < 3) {
      setError("최소 3개의 점이 필요합니다");
      return;
    }
    setZones((prev) => [
      ...prev,
      { name: name || `구역 ${prev.length + 1}`, kind, polygon: draft, detectors: [] },
    ]);
    setDraft([]);
    setName(`구역 ${zones.length + 2}`);
    setError(null);
  }

  function removeZone(index: number) {
    setZones((prev) => prev.filter((_, i) => i !== index));
  }

  function save() {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await saveZonesAction(cameraId, JSON.stringify(zones));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage("구역이 저장되었습니다");
    });
  }

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-surface-2 px-5 py-4">
        <h2 className="text-sm font-semibold">감지 구역</h2>
        <p className="mt-1 text-xs text-content-muted">
          화면을 클릭하여 폴리곤을 그립니다. 좌표는 0..1로 저장되어 해상도가
          바뀌어도 위치가 유지됩니다.
        </p>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_280px]">
        <div className="relative aspect-video overflow-hidden rounded bg-surface-0 ring-1 ring-surface-2">
          <div className="absolute inset-0 grid place-items-center text-xs text-content-muted">
            라이브 화면은 /live에서 확인하세요. 여기서는 구역 도형을 그립니다.
          </div>
          <svg
            ref={svgRef}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full cursor-crosshair"
            onClick={onClick}
          >
            {zones.map((zone, index) => (
              <polygon
                key={`${zone.name}-${index}`}
                points={zone.polygon.map(([x, y]) => `${x},${y}`).join(" ")}
                fill={COLORS[zone.kind]}
                fillOpacity={0.25}
                stroke={COLORS[zone.kind]}
                strokeWidth={0.004}
              />
            ))}
            {draft.length > 0 ? (
              <polyline
                points={draft.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke="#7c4dff"
                strokeWidth={0.004}
              />
            ) : null}
            {draft.map(([x, y], index) => (
              <circle key={index} cx={x} cy={y} r={0.01} fill="#7c4dff" />
            ))}
          </svg>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="구역 이름">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="유형">
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as ZoneKind)}
            >
              {ZONE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {ZONE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={finishZone} disabled={draft.length < 3}>
              구역 완료
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft([])}>
              취소
            </Button>
          </div>

          <ul className="flex flex-col gap-2 text-sm">
            {zones.map((zone, index) => (
              <li
                key={`${zone.name}-${index}`}
                className="flex items-center justify-between rounded bg-surface-2 px-3 py-2"
              >
                <span>
                  <span
                    className="mr-2 inline-block size-2 rounded-full"
                    style={{ background: COLORS[zone.kind] }}
                  />
                  {zone.name}
                  <span className="ml-2 text-xs text-content-muted">
                    {ZONE_LABELS[zone.kind]}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs text-critical"
                  onClick={() => removeZone(index)}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>

          {error ? <p className="text-xs text-critical">{error}</p> : null}
          {message ? <p className="text-xs text-low">{message}</p> : null}

          <Button type="button" variant="primary" disabled={pending} onClick={save}>
            {pending ? "저장 중..." : "구역 저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}
