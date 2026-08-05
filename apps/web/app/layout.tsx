import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AI Video Analitika",
    template: "%s | AI Video Analitika",
  },
  description:
    "Hikvision CCTV kameralari uchun real vaqtdagi AI monitoring: yong'in, yiqilish, chekish va demografiya.",
  applicationName: "AI Video Analitika",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#141821",
  width: "device-width",
  initialScale: 1,
  // Operator planshetda ishlaganda kadrni yaqinlashtira olishi kerak.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uz" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
