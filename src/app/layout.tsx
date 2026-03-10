import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { ErrorBoundary } from "@/lib/error-boundary";
import { KioskExitZone } from "@/components/KioskExitZone";
import { SystemReloadListener } from "@/components/SystemReloadListener";
import { LocationAlertListener } from "@/components/LocationAlertListener";
import { IdleTimerProvider } from "@/components/IdleTimerProvider";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { OfflineDisconnectBanner } from "@/components/OfflineDisconnectBanner";
import { FailoverBanner } from "@/components/FailoverBanner";
import { CellularModeBanner } from "@/components/CellularModeBanner";
import { OutageBanner } from "@/components/OutageBanner";
import { ManagerAlertListener } from "@/components/ManagerAlertListener";
import { StockChangeListener } from "@/components/StockChangeListener";
import { ManagerPinProvider } from "@/components/providers/ManagerPinProvider";

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
  manifest: "/manifest.json",
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
          <ManagerPinProvider>
            {children}
          </ManagerPinProvider>
        </ErrorBoundary>
        <KioskExitZone />
        <SystemReloadListener />
        <LocationAlertListener />
        <ManagerAlertListener />
        <StockChangeListener />
        <IdleTimerProvider />
        <ServiceWorkerRegistration />
        <OfflineDisconnectBanner />
        <FailoverBanner />
        <OutageBanner />
        <CellularModeBanner />
        <ToastContainer />
      </body>
    </html>
  );
}
