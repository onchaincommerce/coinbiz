import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@coinbase/cds-icons/fonts/web/icon-font.css";
import "./globals.css";

const inter = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "CoinBiz — Payments for Every Interface",
  description:
    "Explore hosted and embedded Coinbase Business checkouts, direct transfers, and an HTTP-native x402 protocol simulation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
