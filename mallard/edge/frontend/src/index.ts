// Allow use of MWC elements.
import "@material/mwc-top-app-bar-fixed";
import "./thumbnail-grid";
import store from "./store";
import { thunkStartQuery } from "./thumbnail-grid-slice";

window.onload = function () {
  store.dispatch(thunkStartQuery({}));
};
