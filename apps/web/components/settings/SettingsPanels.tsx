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
  person_detected: "사람",
  fire: "화재",
  smoke: "연기",
  fall: "낙상",
  smoking: "흡연",
  zone_intrusion: "구역",
  loitering: "배회",
  camera_offline: "카메라 오프라인",
  camera_online: "카메라 온라인",
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
          <h3 className="text-sm font-semibold">새 알림 규칙</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="이름">
              <Input name="name" required placeholder="화재 - Telegram" />
            </Field>
            <Field label="최소 심각도">
              <Select name="minSeverity" defaultValue="medium">
                <option value="info">정보</option>
                <option value="low">낮음</option>
                <option value="medium">보통</option>
                <option value="high">높음</option>
                <option value="critical">긴급</option>
              </Select>
            </Field>
            <Field label="채널">
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
            <Field label="쿨다운 (초)">
              <Input name="cooldownSeconds" type="number" defaultValue={300} />
            </Field>
          </div>

          {channel === "telegram" ? (
            <Field label="Telegram 채팅 ID">
              <Input name="chatId" required placeholder="-100..." />
            </Field>
          ) : null}
          {channel === "webhook" ? (
            <>
              <Field label="Webhook URL">
                <Input name="webhookUrl" required type="url" />
              </Field>
              <Field label="시크릿 (선택)">
                <Input name="webhookSecret" />
              </Field>
            </>
          ) : null}
          {channel === "email" ? (
            <Field label="이메일 (쉼표 구분)">
              <Input name="emailTo" required placeholder="ops@example.com" />
            </Field>
          ) : null}

          <fieldset>
            <legend className="mb-2 text-xs text-content-secondary">이벤트 유형</legend>
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
            추가
          </Button>
        </form>
      ) : null}

      <Panel>
        <PanelHeader title="규칙" />
        <ul className="divide-y divide-surface-2">
          {rules.length === 0 ? (
            <li className="px-5 py-8 text-center text-xs text-content-muted">
              규칙이 없습니다
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
                      {rule.enabled ? "끄기" : "켜기"}
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
                      삭제
                    </Button>
                  </div>
                ) : (
                  <Badge tone={rule.enabled ? "success" : "neutral"}>
                    {rule.enabled ? "활성" : "비활성"}
                  </Badge>
                )}
              </li>
            ))
          )}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title="최근 전송" />
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
          <Field label="이름">
            <Input name="name" required />
          </Field>
          <Field label="이메일">
            <Input name="email" type="email" required />
          </Field>
          <Field label="임시 비밀번호">
            <Input name="password" type="password" required minLength={8} />
          </Field>
          <Field label="역할">
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
            사용자 추가
          </Button>
        </form>
      ) : null}

      <Panel>
        <PanelHeader title="구성원" />
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
                    제거
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
      <div className="panel grid grid-cols-2 md:grid-cols-4">
        <Stat label="현재 플랜" value={org.plan} />
        <Stat label="카메라" value={`${org.cameraCount} / ${org.cameraLimit}`} />
        <Stat
          label="월간 (USD)"
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
                  {plan === "trial" && "4대 카메라, 14일 체험"}
                  {plan === "starter" && "8대 카메라, 기본 감지기"}
                  {plan === "business" && "32대 카메라, 전체 감지기, 알림"}
                  {plan === "enterprise" && "256대 카메라, 엣지 박스, SLA"}
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
                {org.plan === plan ? "현재" : "선택"}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {message ? <p className="text-xs text-content-secondary">{message}</p> : null}
      <p className="text-xs text-content-muted">
        현재는 내부 플랜 전환만 지원합니다. Stripe 연동 후 결제 창이 여기에 표시됩니다.
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
          title="액티브 러닝 대기열"
          description="오탐/정탐 프레임이 Roboflow로 업로드됩니다"
        />
        <ul className="divide-y divide-surface-2">
          {feedback.length === 0 ? (
            <li className="px-5 py-8 text-center text-xs text-content-muted">
              샘플이 없습니다. 이벤트를 "오탐"으로 표시하세요.
            </li>
          ) : (
            feedback.map((row) => (
              <li key={row.detector} className="flex justify-between px-5 py-3 text-sm">
                <span>{row.detector}</span>
                <span className="text-content-secondary">
                  대기 {row.pending} · 업로드 {row.uploaded} · FP {row.falsePositives}
                </span>
              </li>
            ))
          )}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title="모델 레지스트리" />
        <ul className="divide-y divide-surface-2">
          {models.length === 0 ? (
            <li className="px-5 py-8 text-center text-xs text-content-muted">
              모델 버전이 없습니다. Roboflow에서 export하여 <code>model_versions</code> 테이블에 기록하세요.
            </li>
          ) : (
            models.map((model) => (
              <li key={model.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {model.detector} · {model.version}
                  </p>
                  <p className="text-xs text-content-muted">
                    {model.roboflow_project ?? "로컬"} ·{" "}
                    {new Date(model.created_at).toLocaleDateString("ko-KR")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {model.is_active ? <Badge tone="success">활성</Badge> : null}
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
                      활성화
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
          <h3 className="text-sm font-semibold">엣지 박스 프로비저닝</h3>
          <Field label="노드 이름">
            <Input name="name" required placeholder="매장-12 GPU 박스" />
          </Field>
          <Field label="사이트">
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
              <p className="font-medium text-medium">API 키 (한 번만 표시):</p>
              <code className="mt-1 block break-all text-content-primary">{apiKey}</code>
            </div>
          ) : null}
          <Button type="submit" variant="primary" disabled={pending}>
            노드 생성
          </Button>
        </form>
      ) : null}

      <Panel>
        <PanelHeader title="엣지 노드" />
        <ul className="divide-y divide-surface-2">
          {nodes.length === 0 ? (
            <li className="px-5 py-8 text-center text-xs text-content-muted">
              엣지 노드가 없습니다. 하이브리드 모드에서는 사이트마다 GPU 박스가 연결됩니다.
            </li>
          ) : (
            nodes.map((node) => (
              <li key={node.id} className="flex justify-between px-5 py-3 text-sm">
                <div>
                  <p className="font-medium">{node.name}</p>
                  <p className="text-xs text-content-muted">
                    {node.gpuName ?? "GPU 미확인"} · {node.cameraCount}대 카메라
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
        title="감사 로그"
        description="누가 영상을 보거나 설정을 변경했는지"
      />
      <ul className="divide-y divide-surface-2">
        {entries.length === 0 ? (
          <li className="px-5 py-8 text-center text-xs text-content-muted">
            기록이 없습니다
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
                {entry.userName || entry.userEmail || "시스템"}
                {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
              </p>
            </li>
          ))
        )}
      </ul>
    </Panel>
  );
}
