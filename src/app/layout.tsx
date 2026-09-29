import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter_Tight, Silkscreen } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { AuthProvider } from "@/components/auth-context";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProviders } from "@/components/wallet-providers";

const interTight = Inter_Tight({
  variable: "--font-inter",
  subsets: ["latin"],
});

const silkscreen = Silkscreen({
  variable: "--font-silkscreen",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title: {
    default: "Mnemo AI — memory that survives the session",
    template: "%s · Mnemo AI",
  },
  description:
    "A decentralized AI chatbot whose memory lives on Walrus, keyed to your Sui address. Projects, constraints, decisions and preferences — recalled in every future session.",
  keywords: [
    "Mnemo",
    "Walrus",
    "Walrus Memory",
    "Sui",
    "zkLogin",
    "decentralized AI chatbot",
    "AI memory",
  ],
  openGraph: {
    title: "Mnemo AI — memory that survives the session",
    description:
      "Decentralized personal memory for AI chat, anchored to Walrus and keyed to your Sui address.",
    siteName: "Mnemo AI",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#030F1C" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${silkscreen.variable} ${geistMono.variable} h-full antialiased`}
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
                  <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-4 py-8 sm:flex-row sm:justify-between">
                    <div className="flex items-center gap-3">
                      <Link
                        href="/"
                        className="lockup-plate inline-flex px-3 py-2"
                      >
                        <Image
                          src="/brand/walrus-lockup.png"
                          alt="Walrus"
                          width={132}
                          height={36}
                          className="h-7 w-auto"
                          priority={false}
                        />
                      </Link>
                      <span className="text-[11px] leading-tight text-muted-foreground">
                        Mnemo AI — personal continuity,
                        <br className="hidden sm:block" /> portable memory
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5">
                        <span
                          className="size-1.5 rounded-full bg-[var(--sui-blue)]"
                          aria-hidden
                        />
                        Sui Mainnet
                      </span>
                      <a
                        href="https://docs.wal.app/walrus-memory/"
                        target="_blank"
                        rel="noreferrer"
                        className="transition-colors hover:text-foreground"
                      >
                        Walrus Memory
                      </a>
                      <a
                        href="https://sui.io"
                        target="_blank"
                        rel="noreferrer"
                        className="transition-colors hover:text-foreground"
                      >
                        Built on Sui
                      </a>
                    </div>
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
