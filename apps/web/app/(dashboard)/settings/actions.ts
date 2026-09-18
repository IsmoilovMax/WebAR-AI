"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  alertRuleInputSchema,
  ROLES,
  type Organization,
  type Role,
} from "@acs/types";
import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import {
  createAlertRule,
  deleteAlertRule,
  setAlertRuleEnabled,
} from "@/lib/data/alerts";
import {
  activateModel,
  createEdgeNode,
  updatePlan,
} from "@/lib/data/org";
import { inviteUser, removeMember, updateMemberRole } from "@/lib/data/users";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function createAlertRuleAction(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission("alert:write");

  const channel = String(formData.get("channel") ?? "telegram");
  let target;
  if (channel === "telegram") {
    target = { kind: "telegram" as const, chatId: String(formData.get("chatId") ?? "") };
  } else if (channel === "webhook") {
    target = {
      kind: "webhook" as const,
      url: String(formData.get("webhookUrl") ?? ""),
      secret: String(formData.get("webhookSecret") ?? "") || undefined,
    };
  } else {
    target = {
      kind: "email" as const,
      to: String(formData.get("emailTo") ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    };
  }

  const parsed = alertRuleInputSchema.safeParse({
    name: formData.get("name"),
    eventTypes: formData.getAll("eventTypes").map(String),
    minSeverity: formData.get("minSeverity") ?? "medium",
    cameraIds: [],
    target,
    activeFrom: formData.get("activeFrom") || null,
    activeTo: formData.get("activeTo") || null,
    cooldownSeconds: Number(formData.get("cooldownSeconds") ?? 300),
    enabled: true,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다" };
  }

  const rule = await createAlertRule(session.orgId, parsed.data);
  await recordAudit(session, "alert.create", "alert_rule", rule.id);
  revalidatePath("/settings");
  return { ok: true };
}

export async function toggleAlertRuleAction(
  ruleId: string,
  enabled: boolean,
): Promise<ActionResult> {
  const session = await requirePermission("alert:write");
  await setAlertRuleEnabled(session.orgId, ruleId, enabled);
  await recordAudit(session, "alert.toggle", "alert_rule", ruleId, { enabled });
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteAlertRuleAction(ruleId: string): Promise<ActionResult> {
  const session = await requirePermission("alert:write");
  await deleteAlertRule(session.orgId, ruleId);
  await recordAudit(session, "alert.delete", "alert_rule", ruleId);
  revalidatePath("/settings");
  return { ok: true };
}

export async function inviteUserAction(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission("user:write");
  const role = String(formData.get("role") ?? "viewer") as Role;
  if (!ROLES.includes(role)) return { ok: false, error: "역할이 올바르지 않습니다" };

  try {
    const user = await inviteUser({
      orgId: session.orgId,
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? ""),
      role,
      password: String(formData.get("password") ?? ""),
      actor: session,
    });
    await recordAudit(session, "user.invite", "user", user.id, { role });
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "사용자를 초대할 수 없습니다",
    };
  }
}

export async function updateRoleAction(
  membershipId: string,
  role: Role,
): Promise<ActionResult> {
  const session = await requirePermission("user:write");
  await updateMemberRole(session.orgId, membershipId, role);
  await recordAudit(session, "user.role", "membership", membershipId, { role });
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeMemberAction(membershipId: string): Promise<ActionResult> {
  const session = await requirePermission("user:write");
  await removeMember(session.orgId, membershipId);
  await recordAudit(session, "user.remove", "membership", membershipId);
  revalidatePath("/settings");
  return { ok: true };
}

export async function changePlanAction(plan: Organization["plan"]): Promise<ActionResult> {
  const session = await requirePermission("billing:write");
  await updatePlan(session.orgId, plan);
  await recordAudit(session, "billing.plan", "organization", session.orgId, { plan });
  revalidatePath("/settings");
  return { ok: true, message: `${plan} 플랜으로 변경되었습니다` };
}

export async function activateModelAction(modelId: string): Promise<ActionResult> {
  const session = await requirePermission("alert:write");
  const ok = await activateModel(session.orgId, modelId);
  if (!ok) return { ok: false, error: "모델을 찾을 수 없습니다" };
  await recordAudit(session, "model.activate", "model_version", modelId);
  revalidatePath("/settings");
  return { ok: true };
}

export async function provisionEdgeNodeAction(
  formData: FormData,
): Promise<ActionResult & { apiKey?: string }> {
  const session = await requirePermission("billing:write");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "이름이 필요합니다" };

  // API kalit faqat bir marta ko'rsatiladi.
  const apiKey = `acs_edge_${randomBytes(24).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

  const node = await createEdgeNode({
    orgId: session.orgId,
    name,
    siteId: (formData.get("siteId") as string) || null,
    apiKeyHash,
  });

  await recordAudit(session, "edge.provision", "edge_node", node.id);
  revalidatePath("/settings");
  return {
    ok: true,
    message: "엣지 노드가 생성되었습니다. API 키를 저장하세요 — 다시 표시되지 않습니다.",
    apiKey,
  };
}
