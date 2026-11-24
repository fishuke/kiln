import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "My app",
  description: "Built with Kiln Studio",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        {children}
        {/* Kiln Studio's bridge (public/kiln-bridge.js): links elements marked data-kiln-fragment to the Context. Dev server only. */}
        {process.env.NODE_ENV !== "production" && <script src="/kiln-bridge.js" async />}
      </body>
    </html>
  );
}
