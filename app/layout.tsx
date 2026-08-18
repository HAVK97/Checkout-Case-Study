import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Representment Workup",
  description: "Analyst-ready chargeback representment workups",
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
