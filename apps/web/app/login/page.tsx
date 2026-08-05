import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Kirish" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getSession()) redirect("/live");

  const { next } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold">AI Video Analitika</h1>
          <p className="mt-1 text-xs text-content-muted">
            Hisobingizga kiring
          </p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
