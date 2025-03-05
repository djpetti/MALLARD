// See
// https://github.com/material-components/material-web/issues/5716
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});
global.HTMLElement.prototype.attachInternals = () => ({
  setFormValue: () => {},
  setValidity: () => {},
});
global.HTMLElement.prototype.animate = () => {};

// Workaround for https://github.com/jsdom/jsdom/issues/2527
window.PointerEvent = MouseEvent;
