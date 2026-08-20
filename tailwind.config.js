/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#1565FF", dark: "#0F4BCC", light: "#3D7FFF" },
        surface: { DEFAULT: "#0F1117", card: "#1A1D27", border: "#2A2E3E" },
      },
    },
  },
  plugins: [],
};
