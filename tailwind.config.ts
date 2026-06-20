import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Swiss / International Typographic palette — shared with SABO WHOLESALE.
        ink: "#111111",        // near-black — primary text & rules
        graphite: "#3a3a3a",   // secondary text
        mist: "#8a8a8a",       // muted / captions / folios
        line: "#e2e2e2",       // hairline borders (neutral gray, close to canvas)
        canvas: "#f1f1f1",     // app background (light gray)
        paper: "#ffffff",      // card / panel surface
        bone: "#ececec",       // alt / module fill / hover (neutral)
        matcha: "#5b6b4f",     // restrained sage accent
        matchaDeep: "#384430", // accent on dark / hover
        sold: "#9a9a9a",       // sold-out / disabled
        alert: "#a8443a",      // inquiry / error (refined terracotta)
      },
      fontFamily: {
        sans: ["var(--font-inter)", "var(--font-noto-sans-jp)", "Helvetica Neue", "Arial", "sans-serif"],
        jp: ["var(--font-noto-sans-jp)", "system-ui", "sans-serif"],
        display: ["var(--font-inter)", "var(--font-noto-sans-jp)", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter2: "-0.02em",
        brand: "0.18em",
        folio: "0.24em",
      },
      spacing: {
        bl: "8px",
        "bl-2": "16px",
        "bl-3": "24px",
        "bl-4": "32px",
        "bl-6": "48px",
        "bl-8": "64px",
        "bl-12": "96px",
        "bl-16": "128px",
      },
      maxWidth: {
        content: "1280px",
      },
      lineHeight: {
        bl3: "24px",
        bl4: "32px",
        bl5: "40px",
      },
    },
  },
  plugins: [],
};

export default config;
