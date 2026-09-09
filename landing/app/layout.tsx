import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Nexus Terminal-first AI coding agent",
  description: "Model-agnostic harness for software development. Bring your own key. Plan and build modes. Sessions that persist.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body className="bg-[#09090b] text-zinc-100 antialiased overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
