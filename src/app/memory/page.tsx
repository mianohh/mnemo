import type { Metadata } from "next";
import { MemoryDashboard } from "@/components/memory/memory-dashboard";

export const metadata: Metadata = {
  title: "Memory Network — Mnemo AI",
};

export default function MemoryPage() {
  return <MemoryDashboard />;
}
