// Allow use of MWC elements.
import "@material/web/all";
import "@material/mwc-top-app-bar-fixed";
import { registerComponents } from "./elements";
import "../css/mallard.scss";

window.onload = function () {
  registerComponents();
};
