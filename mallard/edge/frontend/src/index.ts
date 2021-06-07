// Allow use of MWC elements.
import "@material/mwc-icon-button";
import "@material/mwc-top-app-bar-fixed";
import "@material/mwc-fab";
import "./thumbnail-grid";
import store from "./store";
import { thunkStartQuery } from "./thumbnail-grid-slice";
import { registerComponents } from "./elements";

// Page that allows us to upload new data.
const UPLOAD_PAGE_URI = "/upload";

window.onload = function () {
  registerComponents();

  // Register FAB callbacks.
  const addButton = document.querySelector("#add_data");
  if (addButton != null) {
    addButton.addEventListener("click", () => {
      window.location.assign(UPLOAD_PAGE_URI);
    });
  }
  // Register navigation button callbacks.
  const backButton = document.querySelector("#back_button");
  if (backButton != null) {
    backButton.addEventListener("click", () => {
      window.history.back();
    });
  }

  store.dispatch(thunkStartQuery({}));
};
