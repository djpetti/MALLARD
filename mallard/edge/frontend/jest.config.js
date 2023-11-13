module.exports = {
  preset: "ts-jest/presets/js-with-babel",
  testEnvironmentOptions: {
    url: "http://localhost/",
  },
  testEnvironment: "jest-environment-jsdom",
  testRegex: "src/.*test/test_.*\\.(ts|tsx)$",
  moduleFileExtensions: ["ts", "js"],
  transformIgnorePatterns: [
    "node_modules/(?!(lit|@lit|lit-element|lit-html|@material|app-datepicker|nodemod|client-zip|url-join|to-readable-stream|lodash-es|jose)/)",
  ],
  collectCoverageFrom: [
    "src/**/{!(index|elements|element-test-utils|store|auth-callback),}.ts",
  ],
  setupFiles: ["<rootDir>/src/test/jest-set-up.js"],
  globals: {
    // These are normally set in HTML by the web server. For testing,
    // it needs to be set manually.
    API_BASE_URL: "http://mallard/testapi/v1/",
    AUTH_ENABLED: "true",
    AUTH_BASE_URL: "http://mallard/auth/",
    AUTH_CLIENT_ID: "testclient",
  },
};
