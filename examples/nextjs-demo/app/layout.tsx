import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Payslice EWA — SDK Demo",
  description: "Reference Next.js integration for @payslice/sdk",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
