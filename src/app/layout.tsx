import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Company Research" };

/** Demo mode (DEMO=1) shows fictional sample data, and every page says so. */
const demoMode = process.env.DEMO === "1";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {demoMode ? (
          <p role="note" className="demo-label">
            Fictional sample data: every Company, figure, Brief and Stance shown here is made up.
          </p>
        ) : null}
        <main>{children}</main>
      </body>
    </html>
  );
}
