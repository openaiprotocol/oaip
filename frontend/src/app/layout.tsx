import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OIAP PVM Verifier",
  description:
    "On-chain Groth16 ZK proof verification for Polkadot Hub — cross-VM EVM-to-Polkavm via pallet-revive.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
