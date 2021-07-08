// Allow use of MWC elements.
import "@material/mwc-button";
import "@material/mwc-dialog";
import "@material/mwc-icon";
import "@material/mwc-icon-button";
import "@material/mwc-top-app-bar-fixed";
import "@material/mwc-fab";
import "@material/mwc-list";
import "@material/mwc-circular-progress";
import "./thumbnail-grid";
import store from "./store";
import { thunkStartQuery } from "./thumbnail-grid-slice";
import { registerComponents } from "./elements";
import "../css/mallard.scss";
import {dialogClosed, dialogOpened} from "./upload-slice";
import {Dialog} from "@material/mwc-dialog";

window.onload = function () {
  registerComponents();

  const uploadModal: Dialog | null = document.querySelector("#upload_modal");

  // Register the FAB callback.
  const addButton = document.querySelector("#add_data");
  addButton?.addEventListener("click", () => {
    store.dispatch(dialogOpened(null));
    uploadModal?.show();
  });

  // Register the callback for the file upload dialog buttons.
  const doneButton = document.querySelector("#done_button");
  doneButton?.addEventListener("click", () => {
    store.dispatch(dialogClosed(null));
    uploadModal?.close();
  });

  store.dispatch(thunkStartQuery({}));
};
