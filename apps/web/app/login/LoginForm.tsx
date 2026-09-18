"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Panel } from "@/components/ui/primitives";
import { login, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending} className="w-full">
      {pending ? "확인 중..." : "로그인"}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <Panel className="p-5">
      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <Field label="이메일">
          <Input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            placeholder="admin@demo.local"
          />
        </Field>

        <Field label="비밀번호">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>

        {state.error ? (
          <p role="alert" className="rounded-md bg-critical/10 px-3 py-2 text-xs text-critical">
            {state.error}
          </p>
        ) : null}

        <SubmitButton />
      </form>
    </Panel>
  );
}
