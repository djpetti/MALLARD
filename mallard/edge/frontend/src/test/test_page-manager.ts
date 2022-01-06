import { PageManager } from "../page-manager";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

// Mock JQuery stuff.
const jQuery = jest.requireActual("jquery");
const mockLoad = jest.fn();
jQuery.fn.load = mockLoad;

describe("page-manager", () => {
  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    jest.clearAllMocks();
  });

  it("can initialize the singleton", () => {
    // Act.
    // Try getting the singleton instance twice.
    const instance1 = PageManager.getInstance();
    const instance2 = PageManager.getInstance();

    // Assert.
    // They should be the same.
    expect(instance1).toBe(instance2);
  });

  it("can load a new page", () => {
    // Arrange.
    // We will have to test navigating to a sub-page, because `pushState`
    // won't let us go to an arbitrary URL.
    const newUrl = `/${faker.internet.domainWord()}`;

    const pushStateSpy = jest.spyOn(window.history, "pushState");
    pushStateSpy.mockClear();

    // Act.
    PageManager.getInstance().loadPage(newUrl);

    // Assert.
    // It should have loaded the proper page fragment.
    expect(mockLoad).toBeCalledTimes(1);
    expect(mockLoad.mock.calls[0][0]).toContain(newUrl);

    // It should have set the new page.
    expect(pushStateSpy).toBeCalledTimes(1);
    expect(pushStateSpy).toBeCalledWith(
      expect.anything(),
      expect.any(String),
      newUrl
    );
  });

  it("correctly handles the back button", () => {
    // Arrange.
    // Push a non-trivial URL.
    const baseUrl = `/${faker.internet.domainWord()}`;
    window.history.pushState({}, "", baseUrl);

    const pushStateSpy = jest.spyOn(window.history, "pushState");
    pushStateSpy.mockClear();

    // Make sure that the page manager is initialized in order to
    // register the event handler.
    PageManager.getInstance();

    // Act.
    // Make it look like the back button was pressed.
    window.dispatchEvent(new Event("popstate"));

    // Assert.
    // It should have loaded the proper page fragment.
    expect(mockLoad).toBeCalledTimes(1);
    expect(mockLoad.mock.calls[0][0]).toContain(baseUrl);

    // It should not have set the new page.
    expect(pushStateSpy).toBeCalledTimes(0);
  });
});
