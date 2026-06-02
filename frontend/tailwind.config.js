/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Paleta fintech sobria, dark mode
        bg: {
          base: '#0d1117',     // fondo principal
          card: '#161b22',     // tarjetas
          hover: '#1f2630',    // hover
          border: '#262d36',
        },
        accent: '#3b82f6',     // azul sobrio
        gain: '#22c55e',       // verde rentabilidad +
        loss: '#ef4444',       // rojo rentabilidad -
        muted: '#8b949e',      // texto secundario
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
