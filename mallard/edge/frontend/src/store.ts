import { configureStore, getDefaultMiddleware } from "@reduxjs/toolkit";
import thumbnailGridReducer from "./thumbnail-grid-slice";
import uploadReducer from "./upload-slice";
import logger from "redux-logger";

export default configureStore({
  reducer: {
    imageView: thumbnailGridReducer,
    uploads: uploadReducer,
  },
  middleware: [logger, ...getDefaultMiddleware()],
});
