module.exports = {
  preset: "ts-jest/presets/js-with-babel",
  testEnvironmentOptions: {
    url: "http://localhost/",
  },
  testEnvironment: "jest-environment-jsdom",
  testRegex: "src/.*test/test_.*\\.(ts|tsx)$",
  moduleFileExtensions: ["ts", "js"],
  transformIgnorePatterns: [
    "node_modules/(?!(lit|@lit|lit-element|lit-html|@material|app-datepicker|nodemod|client-zip|url-join|to-readable-stream|lodash-es)/)",
  ],
  collectCoverageFrom: [
    "src/**/{!(index|elements|element-test-utils|store),}.ts",
  ],
  globals: {
    // This is normally set in HTML by the web server. For testing,
    // it needs to be set manually.
    API_BASE_URL: "http://mallard/testapi/v1/",
  },
};
