// Allow use of MWC elements.
import "@material/mwc-top-app-bar-fixed";
import "./thumbnail-grid";
import store from "./store";
import { thunkStartQuery } from "./thumbnail-grid-slice";
import { registerComponents } from "./elements";

window.onload = function () {
  registerComponents();

  store.dispatch(thunkStartQuery({}));
};
