import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
export const metadata: Metadata = { title: "Gogo | รถรับส่งของเรา", description: "เลือกดูตำแหน่งรถรับส่งคอนโด พร้อมเวลาอัปเดตล่าสุด", robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
