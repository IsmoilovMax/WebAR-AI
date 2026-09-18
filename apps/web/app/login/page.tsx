import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

  export const metadata: Metadata = { title: "로그인" };

  export default async function LoginPage({
    searchParams,
  }: {
    searchParams: Promise<{ next?: string }>;
  }) {
    if (await getSession()) redirect("/live");

    const { next } = await searchParams;

    return (
      <main className="grid min-h-dvh place-items-center bg-surface-0 px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="mb-3 flex justify-center">
              <span className="grid size-10 place-items-center rounded-md bg-brand/15 text-brand">
                <svg viewBox="0 0 20 20" fill="currentColor" className="size-5" aria-hidden>
                  <path d="M4 5h9l3 3v7H4z" opacity={0.55} />
                  <circle cx="9" cy="10" r="2.5" />
                </svg>
              </span>
            </div>
            <h1 className="text-lg font-semibold">AI 영상 분석</h1>
            <p className="mt-1 text-xs text-content-muted">계정에 로그인하세요</p>
          </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
