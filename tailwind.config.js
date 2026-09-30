/** @type {import('tailwindcss').Config} */
// Design tokens copied from Beta's admin dashboard (admin.soiree.mx).
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#0a0e1a', // page background
        surface: '#141a2e', // cards and panels
        line: '#232a40', // borders
        navy: '#e7e9f0', // main text (light on dark)
        clay: '#e0806f', // accent
        ink: '#1b2340', // dark buttons
      },
      fontFamily: {
        body: ['var(--font-inter)', 'sans-serif'],
        display: ['var(--font-playfair)', 'serif'],
      },
    },
  },
  plugins: [],
}
