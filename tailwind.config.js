/** @type {import('tailwindcss').Config} */
// Design tokens copied from Beta's admin dashboard (admin.soiree.mx).
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Theme colours live in app/globals.css (dark by default, [data-theme=light] for the off-white look).
        paper: 'rgb(var(--paper) / <alpha-value>)', // page background
        surface: 'rgb(var(--surface) / <alpha-value>)', // cards and panels
        line: 'rgb(var(--line) / <alpha-value>)', // borders
        navy: 'rgb(var(--navy) / <alpha-value>)', // main text
        clay: 'rgb(var(--clay) / <alpha-value>)', // accent
        ink: 'rgb(var(--ink) / <alpha-value>)', // dark buttons
      },
      fontFamily: {
        body: ['var(--font-inter)', 'sans-serif'],
        display: ['var(--font-playfair)', 'serif'],
      },
    },
  },
  plugins: [],
}
