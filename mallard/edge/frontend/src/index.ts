// Allow use of MWC elements.
import "@material/mwc-button";
import "@material/mwc-dialog";
import "@material/mwc-icon";
import "@material/mwc-icon-button";
import "@material/mwc-top-app-bar-fixed";
import "@material/mwc-fab";
import "./thumbnail-grid";
import store from "./store";
import { thunkStartQuery } from "./thumbnail-grid-slice";
import { registerComponents } from "./elements";
import { Dialog } from "@material/mwc-dialog";
import "../css/mallard.scss";

window.onload = function () {
  registerComponents();

  // Register FAB callbacks.
  const addButton = document.querySelector("#add_data");
  if (addButton != null) {
    addButton.addEventListener("click", () => {
      const uploadModal = document.querySelector("#upload_modal") as Dialog;
      uploadModal.show();
    });
  }

  store.dispatch(thunkStartQuery({}));
};
