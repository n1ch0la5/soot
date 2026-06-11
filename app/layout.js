export const metadata = {
  title: "Soot — paper that talks",
  description:
    "A voice hidden in a picture. Record a message, send the image, and Soot reads it back out loud.",
  openGraph: {
    title: "Soot — paper that talks",
    description:
      "Someone sent you a talking picture. Save the image from your message, pick it here, and it will speak.",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
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
      <body style={{ margin: 0, background: "#1E1813" }}>{children}</body>
    </html>
  );
}
