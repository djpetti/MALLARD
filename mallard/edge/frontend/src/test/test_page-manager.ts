import { PageManager } from "../page-manager";
import each from "jest-each";
import { faker } from "@faker-js/faker";

// Mock JQuery stuff.
const jQuery = jest.requireActual("jquery");
const mockLoad = jest.fn();
jQuery.fn.load = mockLoad;

describe("page-manager", () => {
  interface FakeNavBar extends HTMLElement {
    showBack: boolean;
  }

  /** The top nav bar to use when testing. */
  let navBarElement: FakeNavBar;

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    jest.clearAllMocks();

    // Create the fake top nav bar, which PageManager expects to exist.
    const navBar = window.document.createElement("div") as HTMLElement;
    navBar.id = "main_app_bar";
    // PageManager depends on the nav bar having the showBack property.
    Object.defineProperty(navBar, "showBack", { value: false, writable: true });
    document.body.appendChild(navBar);
    // We added the needed properties manually, so this is okay.
    navBarElement = navBar as unknown as FakeNavBar;
  });

  afterEach(() => {
    document.body.querySelector("#main_app_bar")?.remove();
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

  each([
    ["shows the back button", true],
    ["shows the back button (default)", undefined],
    ["hides the back button", false],
  ]).it("can load a new page that %s", (_: string, showBack: boolean) => {
    // Arrange.
    // We will have to test navigating to a sub-page, because `pushState`
    // won't let us go to an arbitrary URL.
    const newUrl = `/${faker.internet.domainWord()}`;

    const pushStateSpy = jest.spyOn(window.history, "pushState");
    pushStateSpy.mockClear();

    // Act.
    PageManager.getInstance().loadPage(newUrl, showBack);

    // Assert.
    if (showBack === undefined) {
      // The default for this parameter is true, so it should operate like it was
      // set to true.
      showBack = true;
    }

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

    // It should be showing the back button if requested.
    expect(navBarElement.showBack).toEqual(showBack);
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
