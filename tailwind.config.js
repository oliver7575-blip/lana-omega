/** @type {import('tailwindcss').Config} */
// Design tokens copied from Beta's admin dashboard (admin.soiree.mx).
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#0b1633', // page background
        surface: '#101d47', // cards and panels
        line: '#2c4785', // borders
        navy: '#e7e9f0', // main text (light on dark)
        clay: '#6aa2ff', // accent
        ink: '#1d3a78', // dark buttons
      },
      fontFamily: {
        body: ['var(--font-inter)', 'sans-serif'],
        display: ['var(--font-playfair)', 'serif'],
      },
    },
  },
  plugins: [],
}
