import { css, html, LitElement, PropertyValues } from "lit";
import Avatar from "avatar-initials";
import { query, state } from "lit/decorators.js";
import { getUserInfo, getUserProfileUrl, logout } from "./api-client";
import { md5 } from "js-md5";
import "@material/web/all";
import { toRgb } from "colors-helper-tools";
import { MdMenu } from "@material/web/all";

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
  private userMenu?: MdMenu;

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
        <md-menu id="user_menu" anchor="avatar">
          <md-menu-item
            @click="${() => {
              window.location.href = getUserProfileUrl();
            }}"
          >
            <md-icon slot="start">manage_accounts</md-icon>
            <div slot="headline">Account Settings</div>
          </md-menu-item>
          <md-menu-item @click="${logout}">
            <md-icon slot="start">logout</md-icon>
            <div slot="headline">Sign Out</div>
          </md-menu-item>
        </md-menu>
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
