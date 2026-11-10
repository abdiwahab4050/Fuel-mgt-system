// Generated from the inline config that index.html used with the Tailwind CDN.
// Rebuild CSS after changing classes or this file:  npm run build:css
const base = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            outline: '#71787b',
            'outline-variant': '#c0c8cb',
            background: '#f8f9ff',
            surface: '#f8f9ff',
            'surface-container-low': '#eff4ff',
            'surface-container': '#e5eeff',
            'surface-container-highest': '#d3e4fe',
            'surface-dim': '#cbdbf5',
            primary: '#3a6470',
            'primary-container': '#add8e6',
            'on-primary-container': '#355f6b',
            'on-surface': '#0b1c30',
            'on-surface-variant': '#41484a',
            'on-primary': '#ffffff'
          },
          fontFamily: { body: ['Inter', 'sans-serif'] }
        }
      }
    };

module.exports = {
  ...base,
  content: ["./index.html"],
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')],
};
