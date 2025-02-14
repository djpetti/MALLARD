import { combineReducers, configureStore } from "@reduxjs/toolkit";
import thumbnailGridReducer from "./thumbnail-grid-slice";
import uploadReducer from "./upload-slice";
import logger from "redux-logger";

const rootReducer = combineReducers({
  imageView: thumbnailGridReducer,
  uploads: uploadReducer,
});

/**
 * Sets up a new Redux store.
 * @param {Partial<RootState>} preloadedState Initial state to use
 * @return {MallardStore} The store it created.
 */
export function setupStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(logger),
    preloadedState: preloadedState,
  });
}

export type RootState = ReturnType<typeof rootReducer>;
export type MallardStore = ReturnType<typeof setupStore>;
export type MallardDispatch = MallardStore["dispatch"];

export default setupStore();
