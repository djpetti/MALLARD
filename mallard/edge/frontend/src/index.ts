// Allow use of MWC elements.
import "@material/mwc-button";
import "@material/mwc-dialog";
import "@material/mwc-icon";
import "@material/mwc-icon-button";
import "@material/mwc-top-app-bar-fixed";
import "@material/mwc-fab";
import "@material/mwc-list";
import "@material/mwc-circular-progress";
import "@material/mwc-textarea";
import "@material/mwc-textfield";
import "@material/mwc-radio";
import "@material/mwc-formfield";
import "@material/mwc-linear-progress";
import "./thumbnail-grid";
import { registerComponents } from "./elements";
import "../css/mallard.scss";

window.onload = function () {
  registerComponents();
};
