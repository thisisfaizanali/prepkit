import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible_Next({ subsets: ["latin"], weight: ["400", "600", "800"], variable: "--font-atkinson" });

export const metadata: Metadata = { title: "prepkit", description: "Interview prep kits built from a job description." };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={atkinson.variable}>
      <body className="min-h-screen bg-paper text-graphite antialiased">{children}</body>
    </html>
  );
}
