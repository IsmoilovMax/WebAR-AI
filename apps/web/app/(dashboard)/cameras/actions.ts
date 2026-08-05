"use server";

import { revalidatePath } from "next/cache";
import { cameraInputSchema, DETECTORS, type Detector } from "@acs/types";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import {
  CameraLimitError,
  DuplicateCameraError,
  createCamera,
  deleteCamera,
  getCameraPassword,
  replaceZones,
  updateCamera,
} from "@/lib/data/cameras";
import { notifyWorkerReload } from "@/lib/services/ai-worker";
import { probeCamera } from "@/lib/services/hikvision";
import { registerStreams, unregisterStreams } from "@/lib/services/go2rtc";

const zoneInputSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["include", "exclude", "no_smoking", "restricted"]),
  polygon: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3),
  detectors: z.array(z.enum(DETECTORS)).default([]),
});

export type ActionResult =
  | { ok: true; cameraId?: string; warnings?: string[] }
  | { ok: false; error: string };

function parseSiteId(value: FormDataEntryValue | null): string | null {
  if (value == null || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatInputError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Ma'lumot noto'g'ri";
  if (issue.path[0] === "siteId") {
    return "Obyekt noto'g'ri. Bo'sh qoldiring yoki ro'yxatdan tanlang.";
  }
  return issue.message;
}

export async function probeCameraAction(formData: FormData): Promise<ActionResult & { detail?: unknown }> {
  await requirePermission("camera:write");

  const host = String(formData.get("host") ?? "");
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const isapiPort = Number(formData.get("isapiPort") ?? 80);

  try {
    const result = await probeCamera({ host, port: isapiPort, username, password });
    return { ok: true, warnings: result.warnings, detail: result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Kamerani tekshirib bo'lmadi",
    };
  }
}

export async function createCameraAction(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission("camera:write");

  const detectors = formData.getAll("enabledDetectors").map(String) as Detector[];
  const parsed = cameraInputSchema.safeParse({
    siteId: parseSiteId(formData.get("siteId")),
    name: formData.get("name"),
    host: formData.get("host"),
    rtspPort: Number(formData.get("rtspPort") ?? 554),
    isapiPort: Number(formData.get("isapiPort") ?? 80),
    channel: Number(formData.get("channel") ?? 1),
    username: formData.get("username"),
    password: formData.get("password"),
    enabledDetectors: detectors.length ? detectors : ["person"],
    analyticsFps: Number(formData.get("analyticsFps") ?? 6),
    enabled: formData.get("enabled") !== "false",
  });

  if (!parsed.success) {
    return { ok: false, error: formatInputError(parsed.error) };
  }

  try {
    // Avval ISAPI tekshiruvi - noto'g'ri credentials bilan DB ga yozmaslik.
    const probe = await probeCamera({
      host: parsed.data.host,
      port: parsed.data.isapiPort,
      username: parsed.data.username,
      password: parsed.data.password,
    });

    const camera = await createCamera(session.orgId, parsed.data);

    await registerStreams({
      camera,
      password: parsed.data.password,
    });
    await notifyWorkerReload();

    await recordAudit(session, "camera.create", "camera", camera.id, {
      host: camera.host,
      channel: camera.channel,
      model: probe.model,
    });

    revalidatePath("/cameras");
    revalidatePath("/live");
    return { ok: true, cameraId: camera.id, warnings: probe.warnings };
  } catch (error) {
    if (error instanceof CameraLimitError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof DuplicateCameraError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Kamerani qo'shib bo'lmadi",
    };
  }
}

export async function updateCameraAction(
  cameraId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requirePermission("camera:write");

  const detectors = formData.getAll("enabledDetectors").map(String) as Detector[];
  const password = String(formData.get("password") ?? "");

  const input = {
    name: String(formData.get("name") ?? ""),
    host: String(formData.get("host") ?? ""),
    rtspPort: Number(formData.get("rtspPort") ?? 554),
    isapiPort: Number(formData.get("isapiPort") ?? 80),
    channel: Number(formData.get("channel") ?? 1),
    username: String(formData.get("username") ?? ""),
    enabledDetectors: detectors,
    analyticsFps: Number(formData.get("analyticsFps") ?? 6),
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
    ...(password ? { password } : {}),
  };

  const camera = await updateCamera(session.orgId, cameraId, input);
  if (!camera) return { ok: false, error: "Kamera topilmadi" };

  const secret = password || (await getCameraPassword(session.orgId, cameraId));
  if (secret) {
    await registerStreams({ camera, password: secret });
  }
  await notifyWorkerReload();

  await recordAudit(session, "camera.update", "camera", cameraId, {
    enabled: camera.enabled,
    detectors: camera.enabledDetectors,
  });

  revalidatePath("/cameras");
  revalidatePath("/live");
  return { ok: true, cameraId };
}

export async function deleteCameraAction(cameraId: string): Promise<ActionResult> {
  const session = await requirePermission("camera:write");
  const ok = await deleteCamera(session.orgId, cameraId);
  if (!ok) return { ok: false, error: "Kamera topilmadi" };

  await unregisterStreams(cameraId);
  await notifyWorkerReload();
  await recordAudit(session, "camera.delete", "camera", cameraId);

  revalidatePath("/cameras");
  revalidatePath("/live");
  return { ok: true };
}

export async function saveZonesAction(
  cameraId: string,
  zonesJson: string,
): Promise<ActionResult> {
  const session = await requirePermission("camera:write");

  const parsed = z.array(zoneInputSchema).safeParse(JSON.parse(zonesJson));
  if (!parsed.success) {
    return { ok: false, error: "Zona ma'lumoti noto'g'ri" };
  }

  await replaceZones(session.orgId, cameraId, parsed.data);
  await notifyWorkerReload();
  await recordAudit(session, "zones.replace", "camera", cameraId, {
    count: parsed.data.length,
  });

  revalidatePath(`/cameras/${cameraId}`);
  return { ok: true };
}
