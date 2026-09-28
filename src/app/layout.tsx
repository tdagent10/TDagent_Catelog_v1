import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://tdagent.tejendra1.com.np";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "TDagent",
  description: "Retail shop catalog — browse products and categories.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TDagent",
  },
  // Legacy iOS (< 17) only honors the Apple-prefixed capability flag.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  openGraph: {
    type: "website",
    siteName: "TDagent",
    title: "TDagent",
    description: "Retail shop catalog — browse products and categories.",
    url: "/",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "TDagent — retail shop catalog",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TDagent",
    description: "Retail shop catalog — browse products and categories.",
    images: ["/og.png"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
