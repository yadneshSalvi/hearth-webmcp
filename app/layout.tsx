import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hearth.yadneshsalvi.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Hearth Studio — design a home with your agent", template: "%s · Hearth Studio" },
  description:
    "A warm 3D interior-design studio that humans and AI agents share. Your agent sees the rooms, places furniture, checks clearances, shops the catalog and prepares checkout — through WebMCP tools registered on the page.",
  applicationName: "Hearth Studio",
  keywords: ["WebMCP", "interior design", "3D", "Shopify", "agent", "ChatGPT", "Chrome"],
  openGraph: {
    title: "Hearth Studio — design a home with your agent",
    description: "Human + agent shared interior-design studio built on WebMCP.",
    url: SITE_URL,
    siteName: "Hearth Studio",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Hearth Studio" }],
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#F7F3EC",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const originTrialToken = process.env.ORIGIN_TRIAL_TOKEN;
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} h-full`}>
      <head>
        {originTrialToken ? <meta httpEquiv="origin-trial" content={originTrialToken} /> : null}
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
