import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DETECTOR_LABELS, hasPermission } from "@acs/types";
import { ZoneEditor } from "@/components/cameras/ZoneEditor";
import { WebRtcPlayer } from "@/components/live/WebRtcPlayer";
import {
  Badge,
  Button,
  Panel,
  PanelHeader,
  StatusDot,
} from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/guard";
import { getCamera, listZones } from "@/lib/data/cameras";
import { deleteCameraAction } from "../actions";

export const metadata: Metadata = { title: "Kamera" };

export default async function CameraDetailPage({
  params,
}: {
  params: Promise<{ cameraId: string }>;
}) {
  const session = await requirePermission("camera:read");
  const { cameraId } = await params;
  const camera = await getCamera(session.orgId, cameraId);
  if (!camera) notFound();

  const zones = await listZones(session.orgId, cameraId);
  const canWrite = hasPermission(session.role, "camera:write");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/cameras" className="text-xs text-content-muted hover:text-brand">
            ← Kameralar
          </Link>
          <h1 className="mt-1 text-lg font-semibold">{camera.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-content-muted">
            <StatusDot status={camera.status} label={camera.status} />
            <span>
              {camera.host} · kanal {camera.channel}
            </span>
          </div>
        </div>

        {canWrite ? (
          <form
            action={async () => {
              "use server";
              await deleteCameraAction(cameraId);
              redirect("/cameras");
            }}
          >
            <Button type="submit" variant="danger">
              O&apos;chirish
            </Button>
          </form>
        ) : null}
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader title="Jonli ko'rinish" />
        <div className="aspect-video bg-black">
          <WebRtcPlayer cameraId={camera.id} cameraName={camera.name} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Detektorlar" />
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {camera.enabledDetectors.map((detector) => (
            <Badge key={detector} tone="brand">
              {DETECTOR_LABELS[detector]}
            </Badge>
          ))}
        </div>
      </Panel>

      {canWrite ? <ZoneEditor cameraId={camera.id} initialZones={zones} /> : null}
    </div>
  );
}
