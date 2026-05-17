import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Noto Sans KR'", "'Apple SD Gothic Neo'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50:  "#EEF4FF",
          100: "#D9E6FD",
          200: "#B3CCFB",
          400: "#4D8AF0",
          500: "#1D5BD4",
          600: "#1751BF",
          700: "#1B4F9C",
          800: "#163E7A",
        },
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(0,0,0,0.07), 0 1px 2px -1px rgba(0,0,0,0.05)",
        popover: "0 4px 16px -2px rgba(0,0,0,0.12), 0 2px 6px -2px rgba(0,0,0,0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
