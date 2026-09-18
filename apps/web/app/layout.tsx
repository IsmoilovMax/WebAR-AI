import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "AI 영상 분석",
    template: "%s | AI 영상 분석",
  },
  description:
    "Hikvision CCTV 카메라를 위한 실시간 AI 모니터링: 화재, 낙상, 흡연 및 인구통계.",
  applicationName: "AI 영상 분석",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#15161c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
