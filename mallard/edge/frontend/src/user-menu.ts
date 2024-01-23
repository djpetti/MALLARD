import { css, html, LitElement, PropertyValues } from "lit";
import Avatar from "avatar-initials";
import { query, state } from "lit/decorators.js";
import { getUserInfo, getUserProfileUrl, logout } from "./api-client";
import { md5 } from "js-md5";
import { toRgb } from "colors-helper-tools/dist/src/utils";
import "@material/mwc-menu";
import "@material/mwc-icon";
import { Menu } from "@material/mwc-menu";

/**
 * Shows an icon with the avatar of the current user, and displays a menu
 * when clicked.
 */
export class UserMenu extends LitElement {
  static tagName = "user-menu";

  static styles = css`
    .avatar {
      position: relative;
      border-radius: 100%;
      width: 48px;
      height: 48px;
    }

    .menu {
      position: relative;
      z-index: 99;
    }

    #user_menu {
      /* Push this to the left so it is not cut off. */
      position: absolute;
      left: -150px;
    }
  `;

  /**
   * Internal avatar element.
   */
  private avatar?: Avatar;

  /**
   * Avatar image.
   */
  @query("#avatar")
  private avatarImage?: HTMLImageElement;

  /**
   * Drop-down menu,
   */
  @query("#user_menu")
  private userMenu?: Menu;

  /**
   * Background color of the avatar.
   */
  @state()
  private backgroundColor: string = "#ffffff";

  /**
   * @inheritDoc
   */
  protected override render() {
    if (getUserInfo() === null) {
      // No user info, so don't show anything.
      return html``;
    }

    return html`
      <div class="menu">
        <img
          src=""
          class="avatar"
          id="avatar"
          alt="avatar"
          @click="${() => this.userMenu?.show()}"
        />

        <!-- Dropdown menu -->
        <mwc-menu id="user_menu">
          <mwc-list-item
            graphic="icon"
            @click="${() => {
              window.location.href = getUserProfileUrl();
            }}"
          >
            <mwc-icon slot="graphic">manage_accounts</mwc-icon>
            <span>Account Settings</span>
          </mwc-list-item>
          <mwc-list-item graphic="icon" @click="${logout}">
            <mwc-icon slot="graphic">logout</mwc-icon>
            <span>Sign Out</span>
          </mwc-list-item>
        </mwc-menu>
      </div>
    `;
  }

  /**
   * @inheritDoc
   */
  protected override firstUpdated(properties: PropertyValues) {
    super.firstUpdated(properties);

    const userInfo = getUserInfo();
    if (userInfo !== null) {
      // Initialize the avatar.
      const initials = userInfo.email.substring(0, 2).toUpperCase();

      // Generate a background color.
      const backgroundColor = `#${md5.hex(userInfo.email).substring(0, 6)}`;
      const rgb = toRgb(backgroundColor);
      // Set text color to be readable on the background.
      const textColor =
        rgb.red + rgb.blue + rgb.green > 127 * 3 ? "#024B2FFF" : "#F8FCF7FF";

      this.avatar = Avatar.from(this.avatarImage as HTMLImageElement, {
        useGravatar: true,
        email: userInfo.email,
        initials: initials,
        fontFamily: "Roboto",
        color: textColor,
        background: backgroundColor,
      });
    }
  }
}
