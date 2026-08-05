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

export const metadata: Metadata = { title: "Kameralar" };

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
          <h1 className="text-lg font-semibold">Kameralar</h1>
          <p className="mt-1 text-xs text-content-muted">
            {org
              ? `${org.cameraCount} / ${org.cameraLimit} · ${org.plan} tarif`
              : null}
          </p>
        </div>
      </div>

      {canWrite ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-content-secondary">
            Yangi kamera
          </h2>
          <CameraForm sites={sites} />
        </section>
      ) : null}

      <Panel>
        <PanelHeader
          title="Ro'yxat"
          description="Har bir kamera go2rtc va AI worker ga avtomatik ulanadi."
        />
        {cameras.length === 0 ? (
          <EmptyState
            title="Hali kamera yo'q"
            description="ISAPI orqali tekshirib, Hikvision kamerangizni qo'shing."
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
                      {camera.host}:{camera.rtspPort} · kanal {camera.channel}
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
                    {!camera.enabled ? <Badge tone="neutral">O&apos;chiq</Badge> : null}
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
