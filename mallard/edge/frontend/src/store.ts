import { configureStore } from "@reduxjs/toolkit";
import thumbnailGridReducer from "./thumbnail-grid-slice";
import uploadReducer from "./upload-slice";

export default configureStore({
  reducer: {
    thumbnailGrid: thumbnailGridReducer,
    uploads: uploadReducer,
  },
});
