// Mock out api-client.
import { getUserInfo, getUserProfileUrl, logout } from "../api-client";
import { faker } from "@faker-js/faker";
import { UserMenu } from "../user-menu";
import { fakeUserInfo, getShadowRoot } from "./element-test-utils";
import Avatar from "avatar-initials";
import { Menu } from "@material/mwc-menu";
import { ListItem } from "@material/mwc-list/mwc-list-item";

jest.mock("../api-client");
const mockGetUserInfo = getUserInfo as jest.MockedFn<typeof getUserInfo>;
const mockGetUserProfileUrl = getUserProfileUrl as jest.MockedFn<
  typeof getUserProfileUrl
>;
const mockLogout = logout as jest.MockedFn<typeof logout>;

// Mock out the avatar library.
jest.mock("avatar-initials");
const mockAvatar = Avatar as jest.MockedClass<typeof Avatar>;

describe("user-menu", () => {
  /** Internal user-menu to use for testing. */
  let menuElement: UserMenu;

  /** Fake user info to use for testing. */
  const userInfo = fakeUserInfo();
  /** Fake user profile URL. */
  const profileUrl = faker.internet.url();

  beforeAll(() => {
    // Allow it to change the window location.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: faker.internet.url() },
    });

    // Manually register the custom element.
    customElements.define(UserMenu.tagName, UserMenu);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Set the faker seed.
    faker.seed(1337);

    // Reset the current URL.
    window.location.href = faker.internet.url();

    // Make it look like we have some fake user info.
    mockGetUserInfo.mockReturnValue(userInfo);
    // Make it look like we can get a profile URL.
    mockGetUserProfileUrl.mockReturnValue(profileUrl);

    // Add the element under test.
    menuElement = window.document.createElement(UserMenu.tagName) as UserMenu;
    document.body.appendChild(menuElement);
  });

  afterEach(() => {
    for (const element of document.body.getElementsByTagName(
      UserMenu.tagName
    )) {
      element.remove();
    }
  });

  it("correctly renders when no user is logged in", async () => {
    // Arrange.
    // Remove the default element.
    document.body.getElementsByTagName(UserMenu.tagName)[0].remove();
    // Make it look like no user is logged in.
    mockGetUserInfo.mockReturnValue(null);

    // Act.
    const emptyMenu = window.document.createElement(
      UserMenu.tagName
    ) as UserMenu;
    document.body.appendChild(emptyMenu);

    // Assert.
    // The menu should render nothing.
    const root = getShadowRoot(UserMenu.tagName);
    expect(root.querySelector("#avatar")).toBeNull();
  });

  it("correctly renders when closed", async () => {
    // Act.
    await menuElement.updateComplete;

    // Assert.
    // It should have rendered the avatar.
    const root = getShadowRoot(UserMenu.tagName);
    expect(root.querySelector("#avatar")).not.toBeNull();

    // It should have added a menu too, but that should be closed.
    const menu = root.querySelector("#user_menu") as Menu | null;
    expect(menu).not.toBeNull();
    expect(menu?.open).toBeFalsy();

    // It should have set the avatar image.
    expect(mockGetUserInfo).toBeCalled();
    expect(mockAvatar.from).toBeCalledTimes(1);
    expect(mockAvatar.from).toBeCalledWith(expect.anything(), {
      useGravatar: true,
      email: userInfo.email,
      initials: expect.any(String),
      fontFamily: expect.any(String),
      color: expect.any(String),
      background: expect.any(String),
    });
  });

  it("opens the menu when clicked", async () => {
    // Act.
    // Simulate a click on the avatar.
    const root = getShadowRoot(UserMenu.tagName);
    const avatar = root.querySelector("#avatar") as HTMLImageElement;
    avatar.click();

    await menuElement.updateComplete;

    // Assert.
    // It should have opened the menu.
    const menu = root.querySelector("#user_menu") as Menu;
    expect(menu.open).toBeTruthy();
  });

  it("goes to the user profile when the item is clicked", async () => {
    // Act.
    await menuElement.updateComplete;

    // Simulate a click on the menu item.
    const root = getShadowRoot(UserMenu.tagName);
    const menu = root.querySelector("#user_menu") as Menu;
    const menuItem = menu.children[0] as ListItem;
    menuItem.click();

    // Assert.
    // It should have redirected to the account page.
    expect(mockGetUserProfileUrl).toBeCalled();
    expect(window.location.href).toEqual(profileUrl);
  });

  it("logs out when the logout item is clicked", async () => {
    // Act.
    await menuElement.updateComplete;

    // Simulate a click on the menu item.
    const root = getShadowRoot(UserMenu.tagName);
    const menu = root.querySelector("#user_menu") as Menu;
    const menuItem = menu.children[1] as ListItem;
    menuItem.click();

    // Assert.
    // It should have logged out.
    expect(mockLogout).toBeCalled();
  });
});
