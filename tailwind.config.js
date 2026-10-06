/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,vue,ts}",
    // The quality ladder the collection numbers are coloured by lives in `shared/`, which the
    // page imports: the `text-*` classes in it only reach the stylesheet if this glob scans it.
    "./shared/**/*.{js,ts}"
  ],
  theme: {
    extend: {
      colors: {
        wow: {
          dark: '#080a0f',
          card: 'rgba(12, 16, 24, 0.85)',
          gold: '#f8b700',
          goldLight: '#ffe395',
          border: 'rgba(212, 175, 55, 0.3)',
        }
      }
    }
  },
  plugins: [],
}