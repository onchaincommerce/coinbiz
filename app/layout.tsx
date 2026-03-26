import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coinbase Business API Demo",
  description:
    "Sandbox and live Coinbase Business hosted checkouts with a webhook server feed.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
