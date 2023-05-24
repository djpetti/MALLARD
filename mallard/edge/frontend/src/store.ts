import { configureStore } from "@reduxjs/toolkit";
import thumbnailGridReducer from "./thumbnail-grid-slice";
import uploadReducer from "./upload-slice";
import logger from "redux-logger";

export default configureStore({
  reducer: {
    imageView: thumbnailGridReducer,
    uploads: uploadReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(logger),
});
