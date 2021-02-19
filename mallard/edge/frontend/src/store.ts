import { configureStore } from "@reduxjs/toolkit";
import thumbnailGridReducer from "./thumbnail-grid-slice";

export default configureStore({
  reducer: {
    thumbnailGrid: thumbnailGridReducer,
  },
});
