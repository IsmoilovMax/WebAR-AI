"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BETA_DETECTORS, DETECTOR_LABELS, DETECTORS, type Detector } from "@acs/types";
import { Badge, Button, Field, Input, Select } from "@/components/ui/primitives";
import { createCameraAction, probeCameraAction } from "@/app/(dashboard)/cameras/actions";

interface Site {
  id: string;
  name: string;
}

export function CameraForm({ sites }: { sites: Site[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [detectors, setDetectors] = useState<Detector[]>(["person"]);
  const [probeInfo, setProbeInfo] = useState<string | null>(null);

  function toggleDetector(detector: Detector) {
    setDetectors((prev) =>
      prev.includes(detector) ? prev.filter((d) => d !== detector) : [...prev, detector],
    );
  }

  function onProbe(form: HTMLFormElement) {
    startTransition(async () => {
      setError(null);
      setProbeInfo(null);
      const result = await probeCameraAction(new FormData(form));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const detail = result.detail as {
        model?: string;
        firmware?: string;
        channels?: { kind: string; width: number; height: number; codec: string }[];
      };
      const sub = detail.channels?.find((c) => c.kind === "sub");
      setProbeInfo(
        [
          detail.model && `Model: ${detail.model}`,
          detail.firmware && `Firmware: ${detail.firmware}`,
          sub && `Sub-stream: ${sub.width}x${sub.height} ${sub.codec}`,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setWarnings(result.warnings ?? []);
    });
  }

  function onSubmit(formData: FormData) {
    for (const detector of detectors) {
      formData.append("enabledDetectors", detector);
    }

    startTransition(async () => {
      setError(null);
      const result = await createCameraAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWarnings(result.warnings ?? []);
      router.push(result.cameraId ? `/cameras/${result.cameraId}` : "/cameras");
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="panel flex flex-col gap-4 p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nomi">
          <Input name="name" required placeholder="Kirish, 1-qavat" />
        </Field>
        <Field label="Obyekt">
          <Select name="siteId" defaultValue="">
            <option value="">—</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="IP / host" hint="Masalan 192.168.1.64">
          <Input name="host" required placeholder="192.168.1.64" />
        </Field>
        <Field label="Kanal">
          <Input name="channel" type="number" min={1} max={64} defaultValue={1} />
        </Field>
        <Field label="RTSP port">
          <Input name="rtspPort" type="number" defaultValue={554} />
        </Field>
        <Field label="ISAPI port">
          <Input name="isapiPort" type="number" defaultValue={80} />
        </Field>
        <Field label="Login">
          <Input name="username" required defaultValue="admin" autoComplete="username" />
        </Field>
        <Field label="Parol">
          <Input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </Field>
        <Field label="AI FPS" hint="5-8 aksariyat hollarda yetarli">
          <Input name="analyticsFps" type="number" min={1} max={30} defaultValue={6} />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-content-secondary">
          Detektorlar
        </legend>
        <div className="flex flex-wrap gap-2">
          {DETECTORS.map((detector) => {
            const active = detectors.includes(detector);
            const beta = BETA_DETECTORS.includes(detector);
            return (
              <button
                key={detector}
                type="button"
                onClick={() => toggleDetector(detector)}
                className={
                  active
                    ? "rounded-lg bg-brand/15 px-3 py-1.5 text-xs font-medium text-brand ring-1 ring-brand/40"
                    : "rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-content-secondary"
                }
              >
                {DETECTOR_LABELS[detector]}
                {beta ? " · beta" : ""}
              </button>
            );
          })}
        </div>
      </fieldset>

      {probeInfo ? (
        <p className="text-xs text-content-secondary">{probeInfo}</p>
      ) : null}

      {warnings.map((warning) => (
        <Badge key={warning} tone="warning" className="whitespace-normal text-left">
          {warning}
        </Badge>
      ))}

      {error ? <p className="text-sm text-critical">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={(event) => {
            const form = (event.target as HTMLElement).closest("form");
            if (form) onProbe(form);
          }}
        >
          ISAPI tekshirish
        </Button>
        <Button type="submit" variant="primary" disabled={pending || detectors.length === 0}>
          {pending ? "Saqlanmoqda..." : "Kamera qo'shish"}
        </Button>
      </div>
    </form>
  );
}
