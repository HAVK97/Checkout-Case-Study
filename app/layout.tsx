import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chargeback Review",
  description: "Upload dispute cases and merchant evidence for analyst review",
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
