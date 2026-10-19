import type { Metadata } from "next";
import { Nunito, Titan_One } from "next/font/google";

import "../index.css";
import Header from "@/components/header";
import Providers from "@/components/providers";

// Tipografías de marca (Sofi 2026-10-19): Nunito (cuerpo) + Titan One (display).
const bodyFont = Nunito({
	variable: "--font-nunito",
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
});

const displayFont = Titan_One({
	variable: "--font-titan-one",
	subsets: ["latin"],
	weight: ["400"],
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
			<body
				className={`${bodyFont.variable} ${displayFont.variable} antialiased`}
			>
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
