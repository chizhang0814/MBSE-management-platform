/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'system-ui', 'Helvetica Neue', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      fontWeight: {
        thin: '320',
        extralight: '330',
        light: '340',
        normal: '400',
        medium: '450',
        semibold: '480',
        bold: '540',
        extrabold: '700',
      },
      letterSpacing: {
        tightest: '-1.72px',
        tighter: '-0.96px',
        tight: '-0.26px',
        snug: '-0.14px',
        normal: '0',
        wide: '0.54px',
        wider: '0.6px',
      },
      borderRadius: {
        'pill': '50px',
      },
    },
  },
  plugins: [],
}
