import { Configuration, ImagesApi } from "typescript-axios/dist";
import { ImageQuery, QueryResult } from "./types";

/** Singleton API client used by the entire application. */
const api = new ImagesApi(new Configuration(), "http://localhost:8000");

/**
 * Performs a query for images.
 * @param {ImageQuery} query The query to perform.
 */
export async function queryImages(query: ImageQuery): Promise<QueryResult> {
  const response = await api
    .queryImagesImagesQueryPost(50, 1, query)
    .catch(function (error) {
      console.log(error.toJSON());
      throw error;
    });

  const rawResult = response.data;
  return {
    imageIds: rawResult.image_ids,
    pageNum: rawResult.page_num,
    isLastPage: rawResult.is_last_page,
  };
}
