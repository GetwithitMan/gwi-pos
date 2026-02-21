const config = {
  plugins: {
    "@tailwindcss/postcss": { optimize: true },
    // Transpile oklch() → rgb() for older browsers (Chrome < 111)
    "@csstools/postcss-oklab-function": { preserve: false },
  },
};

export default config;
