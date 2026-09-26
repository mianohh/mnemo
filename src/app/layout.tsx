import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-context";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProviders } from "@/components/wallet-providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mnemo AI — Personal Continuity Agent",
  description:
    "A chatbot with decentralized, portable memory. Built on Walrus Memory.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <WalletProviders>
            <AuthProvider>
              <TooltipProvider delay={200}>
                <SiteHeader />
                <main className="flex-1">{children}</main>
                <footer className="border-t border-border/70 bg-background/85">
                  <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3.5 text-[11px] text-muted-foreground">
                    <span>Mnemo AI — personal continuity, portable memory</span>
                    <a
                      href="https://github.com/MystenLabs/MemWal"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                    >
                      Built on Walrus Memory
                    </a>
                  </div>
                </footer>
                <Toaster position="bottom-right" />
              </TooltipProvider>
            </AuthProvider>
          </WalletProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
