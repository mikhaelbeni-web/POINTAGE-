import "./globals.css";

export const metadata = {
  title: "Pointage RLB",
  description: "Badgeuse et suivi des heures",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </head>
      <body>{children}</body>
    </html>
  );
}
