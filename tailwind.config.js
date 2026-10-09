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
      /**
       * Gilroy is the typeface the site is set in (`@font-face` in
       * `app/assets/css/main.css`). Naming it as `sans` is what makes it the whole
       * site's default: Tailwind's preflight puts `fontFamily.sans` on `html`, so
       * every block inherits it, and `font-sans` names it wherever it is asked for
       * explicitly. The generic families after it are the fallback a browser paints
       * with while the `.woff2` files are still on their way.
       */
      fontFamily: {
        sans: ['Gilroy', 'system-ui', 'sans-serif']
      },
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