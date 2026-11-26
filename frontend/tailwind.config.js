/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./www/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        paper: 'rgb(var(--c-paper) / <alpha-value>)',
        linen: 'rgb(var(--c-linen) / <alpha-value>)',
        oat: {
          50: 'rgb(var(--c-oat-50) / <alpha-value>)',
          100: 'rgb(var(--c-oat-100) / <alpha-value>)',
          200: 'rgb(var(--c-oat-200) / <alpha-value>)',
          300: 'rgb(var(--c-oat-300) / <alpha-value>)'
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          700: 'rgb(var(--c-ink-700) / <alpha-value>)',
          500: 'rgb(var(--c-ink-500) / <alpha-value>)',
          400: 'rgb(var(--c-ink-400) / <alpha-value>)'
        },
        sage: {
          50: 'rgb(var(--c-sage-50) / <alpha-value>)',
          100: 'rgb(var(--c-sage-100) / <alpha-value>)',
          200: 'rgb(var(--c-sage-200) / <alpha-value>)',
          500: 'rgb(var(--c-sage-500) / <alpha-value>)',
          600: 'rgb(var(--c-sage-600) / <alpha-value>)',
          700: 'rgb(var(--c-sage-700) / <alpha-value>)'
        },
        clay: {
          50: 'rgb(var(--c-clay-50) / <alpha-value>)',
          100: 'rgb(var(--c-clay-100) / <alpha-value>)',
          200: 'rgb(var(--c-clay-200) / <alpha-value>)',
          500: 'rgb(var(--c-clay-500) / <alpha-value>)',
          600: 'rgb(var(--c-clay-600) / <alpha-value>)',
          700: 'rgb(var(--c-clay-700) / <alpha-value>)'
        },
        ochre: {
          50: 'rgb(var(--c-ochre-50) / <alpha-value>)',
          100: 'rgb(var(--c-ochre-100) / <alpha-value>)',
          200: 'rgb(var(--c-ochre-200) / <alpha-value>)',
          500: 'rgb(var(--c-ochre-500) / <alpha-value>)',
          600: 'rgb(var(--c-ochre-600) / <alpha-value>)',
          700: 'rgb(var(--c-ochre-700) / <alpha-value>)'
        },
        rosewood: {
          50: 'rgb(var(--c-rosewood-50) / <alpha-value>)',
          100: 'rgb(var(--c-rosewood-100) / <alpha-value>)',
          500: 'rgb(var(--c-rosewood-500) / <alpha-value>)',
          600: 'rgb(var(--c-rosewood-600) / <alpha-value>)'
        }
      },
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.3rem' }],
        sm: ['0.975rem', { lineHeight: '1.45rem' }],
        base: ['1.075rem', { lineHeight: '1.55rem' }],
        lg: ['1.2rem', { lineHeight: '1.7rem' }],
        '2xl': ['1.65rem', { lineHeight: '2.05rem' }]
      },
      boxShadow: {
        journal: '0 1px 2px rgba(var(--c-shadow), 0.05), 0 6px 18px rgba(var(--c-shadow), 0.045)',
        soft: '0 2px 10px rgba(var(--c-shadow), 0.09)'
      }
    }
  },
  plugins: []
};
