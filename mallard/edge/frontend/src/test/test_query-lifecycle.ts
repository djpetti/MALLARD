import { Action } from "redux";
import { faker } from "@faker-js/faker";
import {
  DEFAULT_ORDERINGS,
  getMetadata,
  getPreviewVideoUrl,
  getStreamableVideoUrl,
  queryImages,
} from "../api-client";
import { ConnectedThumbnailGrid } from "../thumbnail-grid";
import {
  clearImageView,
  createArtifactEntityId,
  thunkAddArtifacts,
  thunkContinueQuery,
  thunkLoadMetadata,
  thunkStartNewQuery,
} from "../thumbnail-grid-slice";
import { MallardStore, setupStore } from "../store";
import { CursorQueryResponse, ImageViewState, RequestState } from "../types";
import {
  fakeImageMetadata,
  fakeState,
  fakeTypedObjectRef,
} from "./element-test-utils";

jest.mock("../api-client", () => ({
  ...jest.requireActual("../api-client"),
  queryImages: jest.fn(),
  getMetadata: jest.fn(),
  getPreviewVideoUrl: jest.fn(),
  getStreamableVideoUrl: jest.fn(),
}));
// Wire the component to each test's real store instead of the application singleton.
jest.mock("../connected-element", () => ({
  connectRedux: jest.fn((_, elementClass) => elementClass),
}));

const mockQuery = queryImages as jest.MockedFn<typeof queryImages>;
const mockMetadata = getMetadata as jest.MockedFn<typeof getMetadata>;
const mockPreview = getPreviewVideoUrl as jest.MockedFn<
  typeof getPreviewVideoUrl
>;
const mockStreamable = getStreamableVideoUrl as jest.MockedFn<
  typeof getStreamableVideoUrl
>;

/**
 * Creates a backend response whose completion order the test controls.
 * @return {Object} The response promise and its completion callbacks.
 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/**
 * Waits for an observable result without depending on microtask scheduling.
 * @param {MallardStore} store The real Redux store under test.
 * @param {Function} predicate The state observable that signals completion.
 * @return {Promise<void>} Resolves when the expected state is visible.
 */
function waitForView(
  store: MallardStore,
  predicate: (state: ImageViewState) => boolean
): Promise<void> {
  if (predicate(store.getState().imageView)) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(() => {
      if (predicate(store.getState().imageView)) {
        unsubscribe();
        resolve();
      }
    });
  });
}

beforeEach(() => {
  faker.seed(1337);
  mockQuery.mockReset().mockResolvedValue({ imageIds: [], nextCursor: null });
  mockMetadata
    .mockReset()
    .mockImplementation(async (ids) => ids.map(() => fakeImageMetadata()));
  mockPreview.mockReset().mockResolvedValue(null);
  mockStreamable.mockReset().mockResolvedValue(null);
});

describe("query child lifetimes", () => {
  it.each([false, true])(
    "ignores metadata after clearing the view (preserveQuery=%s)",
    async (preserveQuery) => {
      const store = setupStore(fakeState());
      await store.dispatch(thunkStartNewQuery({ query: [{}] }));
      const artifact = fakeTypedObjectRef();
      const id = createArtifactEntityId(artifact.id);
      await store.dispatch(thunkAddArtifacts([artifact]));
      const response = deferred<Awaited<ReturnType<typeof getMetadata>>>();
      mockMetadata.mockReturnValueOnce(response.promise);
      const pending = store.dispatch(thunkLoadMetadata([id]));

      store.dispatch(clearImageView({ preserveQuery }));
      response.resolve([fakeImageMetadata()]);
      await pending;
      expect(store.getState().imageView.ids).toEqual([]);
      expect(store.getState().imageView.currentQueryState).toBe(
        RequestState.IDLE
      );
      expect(store.getState().imageView.metadataLoadingState).toBe(
        RequestState.IDLE
      );
    }
  );

  it.each(
    [false, true].flatMap((clearFirst) =>
      [false, true].flatMap((freshFirst) =>
        [false, true].map((rejectOld) => ({
          clearFirst,
          freshFirst,
          rejectOld,
        }))
      )
    )
  )(
    "protects replacement metadata for the same artifact: %j",
    async ({ clearFirst, freshFirst, rejectOld }) => {
      const store = setupStore(fakeState());
      await store.dispatch(thunkStartNewQuery({ query: [{}] }));
      const artifact = fakeTypedObjectRef();
      const id = createArtifactEntityId(artifact.id);
      await store.dispatch(thunkAddArtifacts([artifact]));
      const stale = deferred<Awaited<ReturnType<typeof getMetadata>>>();
      mockMetadata.mockReturnValueOnce(stale.promise);
      const pending = store.dispatch(thunkLoadMetadata([id]));
      if (clearFirst) store.dispatch(clearImageView({ preserveQuery: true }));

      const fresh = deferred<Awaited<ReturnType<typeof getMetadata>>>();
      const metadata = fakeImageMetadata();
      mockMetadata.mockReturnValueOnce(fresh.promise);
      mockQuery.mockResolvedValueOnce({
        imageIds: [artifact],
        nextCursor: null,
      });
      await store.dispatch(
        thunkStartNewQuery({ query: [{ name: faker.system.fileName() }] })
      );
      if (freshFirst) {
        fresh.resolve([metadata]);
        await waitForView(
          store,
          (state) => state.metadataLoadingState === RequestState.SUCCEEDED
        );
      }
      const before = store.getState().imageView;
      if (rejectOld) stale.reject(new Error("Obsolete metadata failure"));
      else stale.resolve([fakeImageMetadata()]);
      await pending;
      const after = store.getState().imageView;
      // Old completion must not overwrite an overlapping entity or release a new spinner.
      expect(after.entities[id].metadata).toEqual(before.entities[id].metadata);
      expect(after.entities[id].metadataStatus).toBe(
        before.entities[id].metadataStatus
      );
      expect(after.metadataLoadingState).toBe(before.metadataLoadingState);
      if (!freshFirst) {
        fresh.resolve([metadata]);
        await waitForView(
          store,
          (state) => state.metadataLoadingState === RequestState.SUCCEEDED
        );
      }
      expect(store.getState().imageView.entities[id].metadata).toEqual(
        metadata
      );
    }
  );

  it.each(["clear", "query", "clear then query"])(
    "ignores obsolete preview and stream URLs after %s",
    async (transition) => {
      const store = setupStore(fakeState());
      await store.dispatch(thunkStartNewQuery({ query: [{}] }));
      const artifact = fakeTypedObjectRef();
      const id = createArtifactEntityId(artifact.id);
      const stale = deferred<string | null>();
      mockPreview.mockReturnValueOnce(stale.promise);
      const pending = store.dispatch(thunkAddArtifacts([artifact]));
      if (transition !== "query")
        store.dispatch(clearImageView({ preserveQuery: true }));
      const preview = faker.internet.url();
      const streamable = faker.internet.url();
      if (transition !== "clear") {
        mockPreview.mockResolvedValueOnce(preview);
        mockStreamable.mockResolvedValueOnce(streamable);
        mockQuery.mockResolvedValueOnce({
          imageIds: [artifact],
          nextCursor: null,
        });
        await store.dispatch(
          thunkStartNewQuery({ query: [{ name: faker.system.fileName() }] })
        );
        await waitForView(
          store,
          (state) => state.entities[id]?.streamableUrl === streamable
        );
      }
      mockStreamable.mockResolvedValueOnce(faker.internet.url());
      stale.resolve(faker.internet.url());
      await pending;
      if (transition === "clear") {
        expect(store.getState().imageView.ids).toEqual([]);
        expect(store.getState().imageView.metadataLoadingState).toBe(
          RequestState.IDLE
        );
      } else {
        expect(store.getState().imageView.entities[id].previewUrl).toBe(
          preview
        );
        expect(store.getState().imageView.entities[id].streamableUrl).toBe(
          streamable
        );
      }
    }
  );

  it("keeps children valid after query fulfillment and continuation", async () => {
    const store = setupStore(fakeState());
    mockQuery.mockResolvedValueOnce({
      imageIds: [],
      nextCursor: faker.datatype.uuid(),
    });
    await store.dispatch(thunkStartNewQuery({ query: [{}] }));
    const artifact = fakeTypedObjectRef();
    const id = createArtifactEntityId(artifact.id);
    const preview = deferred<string | null>();
    const metadata = deferred<Awaited<ReturnType<typeof getMetadata>>>();
    mockPreview.mockReturnValueOnce(preview.promise);
    mockMetadata.mockReturnValueOnce(metadata.promise);
    const pendingPreview = store.dispatch(thunkAddArtifacts([artifact]));
    const pendingMetadata = store.dispatch(thunkLoadMetadata([id]));
    await store.dispatch(thunkContinueQuery());
    const expectedMetadata = fakeImageMetadata();
    const expectedPreview = faker.internet.url();
    preview.resolve(expectedPreview);
    metadata.resolve([expectedMetadata]);
    await Promise.all([pendingPreview, pendingMetadata]);
    expect(store.getState().imageView.entities[id].metadata).toEqual(
      expectedMetadata
    );
    expect(store.getState().imageView.entities[id].previewUrl).toBe(
      expectedPreview
    );
    expect(store.getState().imageView.metadataLoadingState).toBe(
      RequestState.SUCCEEDED
    );
  });
});

describe("grid retries through the busy gate", () => {
  let resizeCallbacks: ResizeObserverCallback[];

  beforeEach(() => {
    resizeCallbacks = [];
  });

  beforeAll(() => {
    customElements.define(
      ConnectedThumbnailGrid.tagName,
      ConnectedThumbnailGrid
    );
    global.ResizeObserver = jest.fn((callback: ResizeObserverCallback) => {
      resizeCallbacks.push(callback);
      return {
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      };
    });
  });

  it.each(
    [false, true].flatMap((continuation) =>
      ["scroll", "resize"].map((trigger) => ({ continuation, trigger }))
    )
  )(
    "retries a failed request through $trigger (continuation=$continuation)",
    async ({ continuation, trigger }) => {
      const store = setupStore(fakeState());
      const query = [{ name: faker.system.fileName() }];
      const cursor = faker.datatype.uuid();
      const request = {
        query,
        orderings: DEFAULT_ORDERINGS,
        resultsPerPage: 3,
      };
      if (continuation) {
        mockQuery.mockResolvedValueOnce({ imageIds: [], nextCursor: cursor });
        await store.dispatch(thunkStartNewQuery(request));
      }
      const grid = document.createElement(
        ConnectedThumbnailGrid.tagName
      ) as ConnectedThumbnailGrid;
      // Suppress initial loading only until this test's store is connected.
      grid.hasMorePages = false;
      document.body.appendChild(grid);
      await grid.updateComplete;
      const unsubscribe = store.subscribe(() =>
        grid.stateChanged(store.getState())
      );
      grid.addEventListener(
        ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME,
        (event) => {
          store.dispatch(grid.mapEvents()[event.type](event) as Action);
        }
      );
      grid.stateChanged(store.getState());
      try {
        mockQuery.mockRejectedValueOnce(new Error("Temporary query failure"));
        if (continuation) await store.dispatch(thunkContinueQuery());
        else await store.dispatch(thunkStartNewQuery(request));
        await grid.updateComplete;
        expect(grid.loadingState).toBe(RequestState.FAILED);
        const callsBeforeRetry = mockQuery.mock.calls.length;
        // Failure updates must not cause an uncontrolled automatic retry loop.
        expect(callsBeforeRetry).toBe(continuation ? 2 : 1);
        Object.defineProperty(grid, "clientHeight", { value: 600 });
        const retry = deferred<CursorQueryResponse>();
        mockQuery.mockReturnValueOnce(retry.promise);
        const completed = waitForView(
          store,
          (state) => state.currentQueryState === RequestState.SUCCEEDED
        );
        const triggerRetry = () => {
          if (trigger === "scroll") grid.dispatchEvent(new Event("scroll"));
          else
            resizeCallbacks[resizeCallbacks.length - 1](
              [],
              {} as ResizeObserver
            );
        };
        triggerRetry();
        expect(mockQuery).toHaveBeenCalledTimes(callsBeforeRetry + 1);
        expect(mockQuery.mock.calls[callsBeforeRetry]).toEqual(
          continuation
            ? [query, DEFAULT_ORDERINGS, 3, cursor]
            : [query, DEFAULT_ORDERINGS, 3]
        );
        expect(grid.loadingState).toBe(RequestState.LOADING);
        triggerRetry();
        expect(mockQuery).toHaveBeenCalledTimes(callsBeforeRetry + 1);
        retry.resolve({ imageIds: [], nextCursor: null });
        await completed;
        await grid.updateComplete;
        expect(grid.loadingState).toBe(RequestState.SUCCEEDED);
        expect(store.getState().imageView.nextCursor).toBeNull();
      } finally {
        unsubscribe();
        grid.remove();
      }
    }
  );
});
