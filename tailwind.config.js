/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cosmic: {
          midnight: '#0B1024',
          galaxy: '#171638',
          purple: '#553B8F',
          nebula: '#8562C5',
          blue: '#547FE8',
          cyan: '#70C9DC',
          lavender: '#C7B8ED',
          card: '#20294A',
          border: '#48547B',
        },
        edu: {
          teal: '#174E50',
          sage: '#A8BDA6',
          mint: '#D8E8DC',
          beige: '#F2EBDD',
          gold: '#E5C47A',
          offwhite: '#F8F7F2',
          textPrimary: '#26334A',
          textSecondary: '#7B8794',
          textMuted: '#9AA39C',
          border: '#E6E8E2',
          card: '#FFFFFF',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
