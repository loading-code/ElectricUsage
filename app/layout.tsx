import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Electricity Usage Explorer",
  description:
    "Explore controlled, peak and off-peak electricity usage in half-hour intervals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-NZ">
      <body>{children}</body>
    </html>
  );
}
