// Allow use of MWC elements.
import "@material/mwc-top-app-bar-fixed";
import "./artifact-thumbnail";
import "./thumbnail-grid-section";
import store from "./store";
import { thunkStartQuery } from "./thumbnail-grid-slice";

window.onload = function () {
  store.dispatch(thunkStartQuery({}));
};
