// Allow use of MWC elements.
import "@material/web/all";
import "@material/mwc-icon";
import "@material/mwc-icon-button";
import "@material/mwc-top-app-bar-fixed";
import "@material/mwc-list";
import "@material/mwc-textfield";
import "@material/mwc-linear-progress";
import { registerComponents } from "./elements";
import "../css/mallard.scss";

window.onload = function () {
  registerComponents();
};
