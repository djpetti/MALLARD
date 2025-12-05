// Allow use of MWC elements.
import "@material/web/all";
import { registerComponents } from "./elements";
import "../css/mallard.scss";
// Register vidstack components
import "vidstack/player";
import "vidstack/player/layouts/default";
import "vidstack/player/ui";

window.onload = function () {
  registerComponents();
};
