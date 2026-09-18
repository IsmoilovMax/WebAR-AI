"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { queryOne } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

const schema = z.object({
  email: z.string().email("이메일 형식이 올바르지 않습니다"),
  password: z.string().min(1, "비밀번호를 입력하세요"),
  next: z.string().startsWith("/").optional(),
});

export interface LoginState {
  error?: string;
}

interface UserRow {
  id: string;
  password_hash: string;
  org_id: string | null;
}

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { email, password, next } = parsed.data;

  const user = await queryOne<UserRow>(
    `SELECT u.id::text, u.password_hash,
            (SELECT m.org_id::text FROM memberships m WHERE m.user_id = u.id ORDER BY m.created_at LIMIT 1) AS org_id
     FROM users u
     WHERE lower(u.email) = lower($1) AND u.is_active`,
    [email],
  );

  // Foydalanuvchi topilmasa ham parol tekshiruvi bajariladi: aks holda
  // javob vaqtidan qaysi email ro'yxatda borligini aniqlash mumkin.
  const hash = user?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA";
  const valid = await verifyPassword(password, hash);

  if (!user || !valid) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다" };
  }

  if (!user.org_id) {
    return { error: "사용자에게 연결된 조직이 없습니다" };
  }

  await createSession(user.id, user.org_id);
  await queryOne("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);

  redirect(next ?? "/live");
}
