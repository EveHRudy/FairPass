/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#16163A',
        paper: '#EEF1F7',
        mute: '#5B5E7E',
        brand: { DEFAULT: '#4E3CF0', dark: '#3A2BC4', soft: '#E7E4FD' },
        cap: { DEFAULT: '#8A5200', soft: '#FFF1D6', line: '#F5A524' },
        ok: { DEFAULT: '#1F7A5C', soft: '#DDF3EA' },
        bad: { DEFAULT: '#B3303B', soft: '#FBE4E6' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
