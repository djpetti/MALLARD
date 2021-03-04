import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ImageEntity, RootState, ThumbnailStatus } from "./types";
import {
  thumbnailGridSelectors,
  thunkLoadThumbnail,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ArtifactThumbnail } from "./artifact-thumbnail";

interface ImageChangedEvent extends Event {
  detail: string;
}

/**
 * Extension of `ArtifactThumbnail` that connects to Redux.
 */
export class ConnectedArtifactThumbnail extends connect(
  store,
  ArtifactThumbnail
) {
  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    if (this.imageId == null) {
      // No specific thumbnail has been set.
      return {};
    }

    // This should never be undefined, because that means our image ID is invalid.
    const imageEntity: ImageEntity = thumbnailGridSelectors.selectById(
      state,
      this.imageId
    ) as ImageEntity;
    if (imageEntity.status != ThumbnailStatus.VISIBLE) {
      // The thumbnail image is has not been loaded yet.
      return {};
    }

    return {
      imageUrl: imageEntity.imageUrl,
    };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    return {
      // The fancy casting here is a hack to deal with the fact that thunkLoadThumbnail
      // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
      // However, it still works just fine with an AsyncThunkAction.
      "image-changed": (event: Event) =>
        (thunkLoadThumbnail(
          (event as ImageChangedEvent).detail
        ) as unknown) as Action,
    };
  }
}
