import type { Metadata } from "next";
import Link from "next/link";
import { DETECTOR_LABELS } from "@acs/types";
import { CameraForm } from "@/components/cameras/CameraForm";
import {
  Badge,
  EmptyState,
  Panel,
  PanelHeader,
  StatusDot,
} from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/guard";
import { listCameras } from "@/lib/data/cameras";
import { getOrganization, listSites } from "@/lib/data/org";
import { hasPermission } from "@acs/types";
import { relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "장치" };

export default async function CamerasPage() {
  const session = await requirePermission("camera:read");
  const canWrite = hasPermission(session.role, "camera:write");

  const [cameras, sites, org] = await Promise.all([
    listCameras(session.orgId),
    listSites(session.orgId),
    getOrganization(session.orgId),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">장치</h1>
          <p className="mt-1 text-xs text-content-muted">
            {org
              ? `${org.cameraCount} / ${org.cameraLimit} · ${org.plan} 플랜`
              : null}
          </p>
        </div>
      </div>

      {canWrite ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-content-secondary">
            새 카메라
          </h2>
          <CameraForm sites={sites} />
        </section>
      ) : null}

      <Panel>
        <PanelHeader
          title="목록"
          description="각 카메라는 go2rtc 및 AI 워커에 자동으로 연결됩니다."
        />
        {cameras.length === 0 ? (
          <EmptyState
            title="카메라가 없습니다"
            description="ISAPI로 확인한 후 Hikvision 카메라를 추가하세요."
          />
        ) : (
          <ul className="divide-y divide-surface-2">
            {cameras.map((camera) => (
              <li key={camera.id}>
                <Link
                  href={`/cameras/${camera.id}`}
                  className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-surface-2/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{camera.name}</p>
                      <StatusDot status={camera.status} label={camera.status} />
                    </div>
                    <p className="mt-1 text-xs text-content-muted">
                      {camera.host}:{camera.rtspPort} · 채널 {camera.channel}
                      {camera.siteName ? ` · ${camera.siteName}` : ""}
                      {camera.lastSeenAt
                        ? ` · ${relativeTime(camera.lastSeenAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {camera.enabledDetectors.map((detector) => (
                      <Badge key={detector} tone="brand">
                        {DETECTOR_LABELS[detector]}
                      </Badge>
                    ))}
                    {!camera.enabled ? <Badge tone="neutral">비활성</Badge> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
