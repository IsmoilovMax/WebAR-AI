import type { NextRequest } from "next/server";
import { apiSessionOrServiceToken } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/audit";
import { getCamera, getCameraById } from "@/lib/data/cameras";
import { liveStreamName } from "@/lib/services/go2rtc";
import { serverEnv } from "@/lib/env";

/**
 * WHEP signalizatsiya proksisi.
 *
 * Brauzer SDP offer yuboradi, biz uni go2rtc ga uzatamiz va answer ni
 * qaytaramiz. Faqat signalizatsiya shu yerdan o'tadi; video oqimning o'zi
 * brauzer va go2rtc o'rtasida to'g'ridan-to'g'ri ketadi.
 *
 * Auth: cookie sessiya (ACS dashboard) YOKI
 * `Authorization: Bearer <ACS_SERVICE_TOKEN>` (tashqi Node BFF).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ cameraId: string }> },
) {
  const auth = await apiSessionOrServiceToken(request, "camera:read");
  if ("response" in auth) return auth.response;

  const { cameraId } = await context.params;

  const camera =
    auth.kind === "service"
      ? await getCameraById(cameraId)
      : await getCamera(auth.session.orgId, cameraId);

  if (!camera) {
    return Response.json({ error: "Kamera topilmadi" }, { status: 404 });
  }

  const offer = await request.text();
  if (!offer.startsWith("v=")) {
    return Response.json({ error: "SDP offer noto'g'ri" }, { status: 400 });
  }

  const target = new URL("/api/webrtc", serverEnv().GO2RTC_URL);
  target.searchParams.set("src", liveStreamName(cameraId));

  let answer: Response;
  try {
    answer = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return Response.json(
      { error: "Video gateway (go2rtc) javob bermayapti" },
      { status: 502 },
    );
  }

  if (!answer.ok) {
    const detail = (await answer.text()).trim().slice(0, 200);
    const status = answer.status === 404 ? 404 : 502;
    return Response.json(
      {
        error:
          answer.status === 404
            ? "Oqim go2rtc da topilmadi"
            : `Video gateway xatosi (go2rtc ${answer.status})`,
        detail: detail || undefined,
      },
      { status },
    );
  }

  if (auth.kind === "session") {
    await recordAudit(auth.session, "stream.view", "camera", cameraId, {
      cameraName: camera.name,
    });
  }

  return new Response(await answer.text(), {
    status: 201,
    headers: { "Content-Type": "application/sdp" },
  });
}
