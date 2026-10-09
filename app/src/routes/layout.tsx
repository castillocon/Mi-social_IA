import type { Child } from "hono/jsx";

export function Layout({ title, children }: { title: string; children: Child }) {
  return (
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · Mi@Social_ia</title>
        <style>{`
          body { font-family: system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 1.5rem 1rem; line-height: 1.55; color: #2b1d14; background: #fffaf5; }
          h1, h2 { color: #4a2c1a; }
          a { color: #8a4b21; }
          table { border-collapse: collapse; width: 100%; }
          th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid #ead8c7; }
          .muted { color: #7a6656; font-size: .9rem; }
        `}</style>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
