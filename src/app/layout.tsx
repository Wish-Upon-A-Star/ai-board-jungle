import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Board",
  description: "RAG, MCP, Agent powered board application",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
