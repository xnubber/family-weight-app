/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./www/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        paper: '#F6F4EE',
        linen: '#FCFBF8',
        oat: {
          50: '#F8F6F0',
          100: '#F1EEE6',
          200: '#E5E0D5',
          300: '#D4CEC0'
        },
        ink: {
          DEFAULT: '#2F342F',
          700: '#494C45',
          500: '#727068',
          400: '#9A968C'
        },
        sage: {
          50: '#EEF3EF',
          100: '#DFE9E2',
          200: '#C7D8CD',
          500: '#6D8D79',
          600: '#587864',
          700: '#456150'
        },
        clay: {
          50: '#F8F0EA',
          100: '#F0E0D5',
          200: '#E2C8B6',
          500: '#C6825F',
          600: '#B06E4C',
          700: '#8F563A'
        },
        ochre: {
          50: '#F7F2E5',
          100: '#EFE5CC',
          200: '#DFCFA9',
          500: '#B88D4E',
          600: '#9E763C',
          700: '#7D5C2D'
        },
        rosewood: {
          50: '#F8EFEF',
          100: '#F0DDDD',
          500: '#BA6D63',
          600: '#A3584E'
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
        journal: '0 1px 2px rgba(47, 52, 47, 0.04), 0 6px 18px rgba(47, 52, 47, 0.035)',
        soft: '0 2px 10px rgba(47, 52, 47, 0.06)'
      }
    }
  },
  plugins: []
};
