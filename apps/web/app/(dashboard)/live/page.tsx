import type { Metadata } from "next";
import { LiveGrid } from "@/components/live/LiveGrid";
import { requirePermission } from "@/lib/auth/guard";
import { listCameras } from "@/lib/data/cameras";

export const metadata: Metadata = { title: "라이브" };

export default async function LivePage() {
  const session = await requirePermission("camera:read");
  const cameras = await listCameras(session.orgId);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-4 text-lg font-semibold">라이브</h1>
      <LiveGrid cameras={cameras.filter((camera) => camera.enabled)} />
    </div>
  );
}
