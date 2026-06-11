import { themeStyleText, THEME_INIT_SCRIPT } from "../components/themes";

// Netlify sets URL to the site's primary domain during builds
const siteUrl = process.env.URL || "http://localhost:3001";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: "Soot — paper talks",
  description:
    "A voice hidden in a picture. Record a message, send the image, and Soot reads it back out loud.",
  openGraph: {
    title: "Soot — paper talks",
    description:
      "Someone sent you a talking picture. Save the image from your message, pick it here, and it will speak.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Soot — paper talks",
    description:
      "A voice hidden in a picture. Save the image, pick it here, and it will speak.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* set the theme attribute before first paint — prevents the flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: themeStyleText() }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@400;500;600&family=Space+Mono&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
