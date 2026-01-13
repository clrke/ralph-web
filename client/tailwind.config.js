/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'stage-1': '#334155',
        'stage-2': '#475569',
        'stage-3': '#1e3a5f',
        'stage-4': '#374151',
        'stage-5': '#1f2937',
      },
    },
  },
  plugins: [],
};
