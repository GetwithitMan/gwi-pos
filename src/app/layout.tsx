import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { ErrorBoundary } from "@/lib/error-boundary";
import { KioskExitZone } from "@/components/KioskExitZone";
import { SystemReloadListener } from "@/components/SystemReloadListener";
import { LocationAlertListener } from "@/components/LocationAlertListener";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GWI POS",
  description: "Point of Sale System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <KioskExitZone />
        <SystemReloadListener />
        <LocationAlertListener />
        <ToastContainer />
      </body>
    </html>
  );
}
