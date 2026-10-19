import type { Metadata } from "next";
import { Nunito } from "next/font/google";

import "../index.css";
import Header from "@/components/header";
import Providers from "@/components/providers";

// Display font: pendiente de elección de Sofi (Baloo 2 descartada el
// 2026-10-19). Cuando elija, se agrega acá + en globals.css (--font-display).
const bodyFont = Nunito({
	variable: "--font-nunito",
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
	title: "memu",
	description: "memu",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className={`${bodyFont.variable} antialiased`}>
				<Providers>
					<div className="grid h-svh grid-rows-[auto_1fr]">
						<Header />
						{children}
					</div>
				</Providers>
			</body>
		</html>
	);
}
