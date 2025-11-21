// Allow use of MWC elements.
import "@material/web/all";
import { registerComponents } from "./elements";
import "../css/mallard.scss";

window.onload = function () {
  registerComponents();
};
