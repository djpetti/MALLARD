module.exports = {
  preset: "ts-jest",
  testEnvironment: 'jest-environment-jsdom-sixteen',
  testRegex: 'src/.*test/test_.*\\.(ts|tsx)$',
  moduleFileExtensions: ['ts', 'js'],
  setupFiles: ["./bundled/mallard-edge.js"]
};
