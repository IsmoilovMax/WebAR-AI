"use client";

import { useState, useTransition } from "react";
import {
  EVENT_TYPES,
  ROLE_LABELS,
  ROLES,
  type AlertRule,
  type Organization,
  type Role,
} from "@acs/types";
import {
  Badge,
  Button,
  Field,
  Input,
  Panel,
  PanelHeader,
  Select,
  Stat,
} from "@/components/ui/primitives";
import {
  activateModelAction,
  changePlanAction,
  createAlertRuleAction,
  deleteAlertRuleAction,
  inviteUserAction,
  provisionEdgeNodeAction,
  removeMemberAction,
  toggleAlertRuleAction,
  updateRoleAction,
} from "@/app/(dashboard)/settings/actions";
import { RelativeTime } from "@/components/ui/RelativeTime";

interface AlertDelivery {
  id: string;
  ruleName: string;
  cameraName: string;
  eventType: string;
  status: "sent" | "failed" | "suppressed";
  error: string | null;
  createdAt: string;
}

interface FeedbackSummary {
  detector: string;
  pending: number;
  uploaded: number;
  falsePositives: number;
}

interface AuditEntry {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  userName: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface EdgeNode {
  id: string;
  name: string;
  gpuName: string | null;
  lastSeenAt: string | null;
  cameraCount: number;
  agentVersion: string | null;
}

interface OrgUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  membershipId: string;
}

const PLAN_PRICES_USD: Record<Organization["plan"], number> = {
  trial: 0,
  starter: 49,
  business: 199,
  enterprise: 0,
};

const EVENT_LABELS: Record<string, string> = {
  person_detected: "Odam",
  fire: "Yong'in",
  smoke: "Tutun",
  fall: "Yiqilish",
  smoking: "Chekish",
  zone_intrusion: "Zona",
  loitering: "Uzoq turish",
  camera_offline: "Kamera offline",
  camera_online: "Kamera online",
};

export function AlertsPanel({
  rules,
  deliveries,
  canWrite,
}: {
  rules: AlertRule[];
  deliveries: AlertDelivery[];
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState("telegram");

  function onCreate(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await createAlertRuleAction(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <form action={onCreate} className="panel flex flex-col gap-3 p-5">
          <h3 className="text-sm font-semibold">Yangi alert qoidasi</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nomi">
              <Input name="name" required placeholder="Yong'in - Telegram" />
            </Field>
            <Field label="Minimal daraja">
              <Select name="minSeverity" defaultValue="medium">
                <option value="info">Ma'lumot</option>
                <option value="low">Past</option>
                <option value="medium">O'rta</option>
                <option value="high">Yuqori</option>
                <option value="critical">Kritik</option>
              </Select>
            </Field>
            <Field label="Kanal">
              <Select
                name="channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="telegram">Telegram</option>
                <option value="webhook">Webhook</option>
                <option value="email">Email</option>
              </Select>
            </Field>
            <Field label="Cooldownoldown (soniya)">
              <Input name="cooldownSeconds" type="number" defaultValue={300} />
            </Field>
          </div>

          {channel === "telegram" ? (
            <Field label="Telegram chat ID">
              <Input name="chatId" required placeholder="-100..." />
            </Field>
          ) : null}
          {channel === "webhook" ? (
            <>
              <Field label="Webhook URL">
                <Input name="webhookUrl" required type="url" />
              </Field>
              <Field label="Secret (ixtiyoriy)">
                <Input name="webhookSecret" />
              </Field>
            </>
          ) : null}
          {channel === "email" ? (
            <Field label="Email (vergul bilan)">
              <Input name="emailTo" required placeholder="ops@example.com" />
            </Field>
          ) : null}

          <fieldset>
            <legend className="mb-2 text-xs text-content-secondary">Hodisa turlari</legend>
            <div className="flex flex-wrap gap-2">
              {EVENT_TYPES.filter((t) => !t.startsWith("camera_")).map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-xs"
                >
                  <input type="checkbox" name="eventTypes" value={type} defaultChecked={type === "fire" || type === "fall"} />
                  {EVENT_LABELS[type]}
                </label>
              ))}
            </div>
          </fieldset>

          {error ? <p className="text-xs text-critical">{error}</p> : null}
          <Button type="submit" variant="primary" disabled={pending}>
            Qo&apos;shish
          </Button>
        </form>
      ) : null}

      <Panel>
        <PanelHeader title="Qoidalar" />
        <ul className="divide-y divide-surface-2">
          {rules.length === 0 ? (
            <li className="px-5 py-8 text-center text-xs text-content-muted">
              Hali qoida yo&apos;q
            </li>
          ) : (
            rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{rule.name}</p>
                  <p className="text-xs text-content-muted">
                    {rule.target.kind} · {rule.eventTypes.map((t) => EVENT_LABELS[t] ?? t).join(", ")}
                  </p>
                </div>
                {canWrite ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        startTransition(() => {
                          void toggleAlertRuleAction(rule.id, !rule.enabled);
                        })
                      }
                    >
                      {rule.enabled ? "O'chirish" : "Yoqish"}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() =>
                        startTransition(() => {
                          void deleteAlertRuleAction(rule.id);
                        })
                      }
                    >
                      O&apos;chirish
                    </Button>
                  </div>
                ) : (
                  <Badge tone={rule.enabled ? "success" : "neutral"}>
                    {rule.enabled ? "Faol" : "O'chiq"}
                  </Badge>
                )}
              </li>
            ))
          )}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title="So'nggi yuborishlar" />
        <ul className="divide-y divide-surface-2">
          {deliveries.slice(0, 20).map((item) => (
            <li key={item.id} className="flex justify-between gap-2 px-5 py-3 text-xs">
              <span>
                {item.ruleName} · {item.cameraName} · {EVENT_LABELS[item.eventType]}
              </span>
              <Badge
                tone={
                  item.status === "sent"
                    ? "success"
                    : item.status === "failed"
                      ? "danger"
                      : "warning"
                }
              >
                {item.status}
              </Badge>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function UsersPanel({
  users,
  canWrite,
}: {
  users: OrgUser[];
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <form
          className="panel grid gap-3 p-5 md:grid-cols-2"
          action={(formData) => {
            startTransition(async () => {
              setError(null);
              const result = await inviteUserAction(formData);
              if (!result.ok) setError(result.error);
            });
          }}
        >
          <Field label="Ism">
            <Input name="name" required />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" required />
          </Field>
          <Field label="Vaqtinchalik parol">
            <Input name="password" type="password" required minLength={8} />
          </Field>
          <Field label="Rol">
            <Select name="role" defaultValue="operator">
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          {error ? <p className="text-xs text-critical md:col-span-2">{error}</p> : null}
          <Button type="submit" variant="primary" disabled={pending} className="md:col-span-2">
            Foydalanuvchi qo&apos;shish
          </Button>
        </form>
      ) : null}

      <Panel>
        <PanelHeader title="A'zolar" />
        <ul className="divide-y divide-surface-2">
          {users.map((user) => (
            <li key={user.membershipId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div>
                <p className="text-sm font-medium">{user.name || user.email}</p>
                <p className="text-xs text-content-muted">{user.email}</p>
              </div>
              {canWrite ? (
                <div className="flex gap-2">
                  <Select
                    defaultValue={user.role}
                    className="w-auto"
                    onChange={(e) =>
                      startTransition(() => {
                        void updateRoleAction(user.membershipId, e.target.value as Role);
                      })
                    }
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() =>
                      startTransition(() => {
                        void removeMemberAction(user.membershipId);
                      })
                    }
                  >
                    Olib tashlash
                  </Button>
                </div>
              ) : (
                <Badge>{ROLE_LABELS[user.role]}</Badge>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function BillingPanel({
  org,
  canWrite,
}: {
  org: Organization & { cameraCount: number };
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const plans: Organization["plan"][] = ["trial", "starter", "business", "enterprise"];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Joriy tarif" value={org.plan} />
        <Stat label="Kameralar" value={`${org.cameraCount} / ${org.cameraLimit}`} />
        <Stat
          label="Oylik (USD)"
          value={PLAN_PRICES_USD[org.plan] === 0 ? "—" : `$${PLAN_PRICES_USD[org.plan]}`}
        />
        <Stat label="Slug" value={org.slug} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {plans.map((plan) => (
          <div key={plan} className="panel p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold capitalize">{plan}</p>
                <p className="mt-1 text-xs text-content-muted">
                  {plan === "trial" && "4 kamera, 14 kun sinov"}
                  {plan === "starter" && "8 kamera, asosiy detektorlar"}
                  {plan === "business" && "32 kamera, barcha detektorlar, alertlar"}
                  {plan === "enterprise" && "256 kamera, edge box, SLA"}
                </p>
              </div>
              <p className="text-lg font-semibold">
                {PLAN_PRICES_USD[plan] === 0 ? "Custom" : `$${PLAN_PRICES_USD[plan]}`}
              </p>
            </div>
            {canWrite ? (
              <Button
                type="button"
                className="mt-4 w-full"
                variant={org.plan === plan ? "secondary" : "primary"}
                disabled={pending || org.plan === plan}
                onClick={() =>
                  startTransition(async () => {
                    const result = await changePlanAction(plan);
                    setMessage(result.ok ? result.message ?? "OK" : result.error);
                  })
                }
              >
                {org.plan === plan ? "Joriy" : "Tanlash"}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {message ? <p className="text-xs text-content-secondary">{message}</p> : null}
      <p className="text-xs text-content-muted">
        Billing hozircha ichki tarif almashtirish. Stripe integratsiyasi keyingi
        bosqichda ulanganda shu yerda to&apos;lov oynasi ochiladi.
      </p>
    </div>
  );
}

export function ModelsPanel({
  models,
  feedback,
  canWrite,
}: {
  models: {
    id: string;
    detector: string;
    version: string;
    roboflow_project: string | null;
    is_active: boolean;
    metrics: Record<string, unknown>;
    created_at: Date;
  }[];
  feedback: FeedbackSummary[];
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Active learning navbati"
          description="False positive / true positive kadrlar Roboflow ga yuklanadi"
        />
        <ul className="divide-y divide-surface-2">
          {feedback.length === 0 ? (
            <li className="px-5 py-8 text-center text-xs text-content-muted">
              Hali namuna yo&apos;q. Hodisani &quot;yolg&apos;on signal&quot; deb belgilang.
            </li>
          ) : (
            feedback.map((row) => (
              <li key={row.detector} className="flex justify-between px-5 py-3 text-sm">
                <span>{row.detector}</span>
                <span className="text-content-secondary">
                  navbat {row.pending} · yuklangan {row.uploaded} · FP {row.falsePositives}
                </span>
              </li>
            ))
          )}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title="Model registry" />
        <ul className="divide-y divide-surface-2">
          {models.length === 0 ? (
            <li className="px-5 py-8 text-center text-xs text-content-muted">
              Model versiyalari yo&apos;q. Roboflow dan export qilib{" "}
              <code>model_versions</code> jadvaliga yozing.
            </li>
          ) : (
            models.map((model) => (
              <li key={model.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {model.detector} · {model.version}
                  </p>
                  <p className="text-xs text-content-muted">
                    {model.roboflow_project ?? "lokal"} ·{" "}
                    {new Date(model.created_at).toLocaleDateString("uz-UZ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {model.is_active ? <Badge tone="success">Faol</Badge> : null}
                  {canWrite && !model.is_active ? (
                    <Button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(() => {
                          void activateModelAction(model.id);
                        })
                      }
                    >
                      Faollashtirish
                    </Button>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </Panel>
    </div>
  );
}

export function EdgePanel({
  nodes,
  sites,
  canWrite,
}: {
  nodes: EdgeNode[];
  sites: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <form
          className="panel flex flex-col gap-3 p-5"
          action={(formData) => {
            startTransition(async () => {
              setError(null);
              setApiKey(null);
              const result = await provisionEdgeNodeAction(formData);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setApiKey(result.apiKey ?? null);
            });
          }}
        >
          <h3 className="text-sm font-semibold">Edge box provisioning</h3>
          <Field label="Tugun nomi">
            <Input name="name" required placeholder="Do'kon-12 GPU box" />
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
          {error ? <p className="text-xs text-critical">{error}</p> : null}
          {apiKey ? (
            <div className="rounded-lg bg-surface-2 p-3 text-xs">
              <p className="font-medium text-medium">API kalit (bir marta):</p>
              <code className="mt-1 block break-all text-content-primary">{apiKey}</code>
            </div>
          ) : null}
          <Button type="submit" variant="primary" disabled={pending}>
            Tugun yaratish
          </Button>
        </form>
      ) : null}

      <Panel>
        <PanelHeader title="Edge tugunlar" />
        <ul className="divide-y divide-surface-2">
          {nodes.length === 0 ? (
            <li className="px-5 py-8 text-center text-xs text-content-muted">
              Hali edge tugun yo&apos;q. Gibrid rejimda har bir obyektga GPU box
              biriktiriladi.
            </li>
          ) : (
            nodes.map((node) => (
              <li key={node.id} className="flex justify-between px-5 py-3 text-sm">
                <div>
                  <p className="font-medium">{node.name}</p>
                  <p className="text-xs text-content-muted">
                    {node.gpuName ?? "GPU noma'lum"} · {node.cameraCount} kamera
                    {node.lastSeenAt ? (
                      <>
                        {" · "}
                        <RelativeTime value={node.lastSeenAt} />
                      </>
                    ) : (
                      " · offline"
                    )}
                  </p>
                </div>
                <Badge tone={node.lastSeenAt ? "success" : "warning"}>
                  {node.agentVersion ?? "pending"}
                </Badge>
              </li>
            ))
          )}
        </ul>
      </Panel>
    </div>
  );
}

export function AuditPanel({ entries }: { entries: AuditEntry[] }) {
  return (
    <Panel>
      <PanelHeader
        title="Audit jurnal"
        description="Kim qaysi videoni ko'rdi / sozlamani o'zgartirdi"
      />
      <ul className="divide-y divide-surface-2">
        {entries.length === 0 ? (
          <li className="px-5 py-8 text-center text-xs text-content-muted">
            Hali yozuv yo&apos;q
          </li>
        ) : (
          entries.map((entry) => (
            <li key={entry.id} className="px-5 py-3 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium text-content-primary">
                  {entry.action} · {entry.resource}
                  {entry.resourceId ? ` #${entry.resourceId.slice(0, 8)}` : ""}
                </span>
                <RelativeTime value={entry.createdAt} className="text-content-muted" />
              </div>
              <p className="mt-1 text-content-muted">
                {entry.userName || entry.userEmail || "tizim"}
                {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
              </p>
            </li>
          ))
        )}
      </ul>
    </Panel>
  );
}
