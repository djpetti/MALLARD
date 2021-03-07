module.exports = {
  preset: "ts-jest/presets/js-with-babel",
  testEnvironment: 'jest-environment-jsdom-sixteen',
  testRegex: 'src/.*test/test_.*\\.(ts|tsx)$',
  moduleFileExtensions: ['ts', 'js'],
  transformIgnorePatterns: [
      "node_modules/(?!(lit-element|lit-html|@material)/)"
  ],
  collectCoverageFrom: [
      "src/**/{!(index|elements|element-test-utils),}.ts",
  ]
};
