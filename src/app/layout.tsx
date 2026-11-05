import type { Metadata } from "next";
import { Prompt } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
const prompt = Prompt({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
  variable: "--font-prompt",
});

export const metadata: Metadata = { title: "UNiGO | Unio Charan 3", description: "ตำแหน่งรถรับส่ง Unio Charan 3 และเวลาอัปเดตล่าสุด", icons: { icon: "/unigo-logo.png", apple: "/unigo-logo.png" }, robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th" className={prompt.variable}><body>{children}</body></html>;
}
