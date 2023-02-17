import { TopNavBar } from "../top-nav-bar";
import { getShadowRoot } from "./element-test-utils";
import each from "jest-each";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

describe("top-nav-bar", () => {
  /** Internal top-nav-bar to use for testing. */
  let navBarElement: TopNavBar;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(TopNavBar.tagName, TopNavBar);
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    navBarElement = window.document.createElement(
      TopNavBar.tagName
    ) as TopNavBar;
    document.body.appendChild(navBarElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(TopNavBar.tagName)[0].remove();
  });

  it("renders the title correctly", async () => {
    // Arrange.
    // Set the title.
    const fakeTitle = faker.lorem.sentence();

    // Act.
    navBarElement.title = fakeTitle;
    await navBarElement.updateComplete;

    // Assert.
    const root = getShadowRoot(TopNavBar.tagName);
    const topBar = root.querySelector("#app_bar");
    expect(topBar).not.toBe(null);

    // It should have rendered the title.
    const titleDiv = topBar?.querySelector("span");
    expect(titleDiv).not.toBe(null);
    expect(titleDiv?.textContent).toEqual(fakeTitle);
  });

  each([
    ["shows", true],
    ["hides", false],
  ]).it(
    "%s the back button when requested",
    async (_: string, showBack: boolean) => {
      // Act.
      navBarElement.showBack = showBack;
      await navBarElement.updateComplete;

      // Assert.
      const root = getShadowRoot(TopNavBar.tagName);

      // Check the status of the back button.
      const backButton = root.querySelector("#back_button");
      expect(backButton).not.toBe(null);

      if (!showBack) {
        // This button should be hidden.
        expect(backButton?.classList).toContain("hidden");
      } else {
        // This button should be showing.
        expect(backButton?.classList).not.toContain("hidden");
      }
    }
  );

  it("goes back when the back button is clicked", async () => {
    // Arrange.
    // Wait for it to render.
    await navBarElement.updateComplete;

    // Monitor the history object, so we can detect the callback.
    const backSpy = jest.spyOn(history, "back");
    backSpy.mockClear();

    // Act.
    const root = getShadowRoot(TopNavBar.tagName);

    // Make it look like the button was clicked.
    const backButton = root.querySelector("#back_button") as HTMLElement;
    backButton.dispatchEvent(new Event("click"));

    // Assert.
    // It should have gone back.
    expect(backSpy).toBeCalledTimes(1);
  });
});
