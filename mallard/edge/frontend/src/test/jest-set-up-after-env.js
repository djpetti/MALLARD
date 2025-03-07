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
// Workaround for https://github.com/mui/mui-x/issues/12983
Object.defineProperty(window, "IntersectionObserver", {
  value: jest.fn().mockImplementation(() => ({
    observe: () => null,
    unobserve: () => null,
    disconnect: () => null,
  })),
});
global.HTMLElement.prototype.attachInternals = () => ({
  setFormValue: () => {},
  setValidity: () => {},
});
global.HTMLElement.prototype.animate = () => ({
  finished: { catch: jest.fn() },
});

// Workaround for https://github.com/jsdom/jsdom/issues/2527
window.PointerEvent = MouseEvent;

// Workaround for https://github.com/jsdom/jsdom/issues/3294
HTMLDialogElement.prototype.show = jest.fn();
HTMLDialogElement.prototype.showModal = jest.fn();
HTMLDialogElement.prototype.close = jest.fn();
