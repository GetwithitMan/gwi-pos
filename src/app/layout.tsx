import type { Metadata } from "next";
import "./globals.css";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { ErrorBoundary } from "@/lib/error-boundary";
import { KioskExitZone } from "@/components/KioskExitZone";
import { SystemReloadListener } from "@/components/SystemReloadListener";
import { UpdateRefreshListener } from "@/components/UpdateRefreshListener";
import { LocationAlertListener } from "@/components/LocationAlertListener";
import { IdleTimerProvider } from "@/components/IdleTimerProvider";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { FailoverBanner } from "@/components/FailoverBanner";
import { CellularModeBanner } from "@/components/CellularModeBanner";
import { OutageBanner } from "@/components/OutageBanner";
import { ManagerAlertListener } from "@/components/ManagerAlertListener";
import { StockChangeListener } from "@/components/StockChangeListener";
import { ManagerPinProvider } from "@/components/providers/ManagerPinProvider";

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
      <body className="antialiased">
        <ErrorBoundary>
          <ManagerPinProvider>
            {children}
          </ManagerPinProvider>
        </ErrorBoundary>
        <KioskExitZone />
        <SystemReloadListener />
        <UpdateRefreshListener />
        <LocationAlertListener />
        <ManagerAlertListener />
        <StockChangeListener />
        <IdleTimerProvider />
        <ServiceWorkerRegistration />
        <FailoverBanner />
        <OutageBanner />
        <CellularModeBanner />
        <ToastContainer />
      </body>
    </html>
  );
}
