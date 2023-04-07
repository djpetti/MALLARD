declare module "@shellophobia/transform-image-js" {
  export enum OutputType {
    BLOB = "blob",
    BASE64 = "base64",
    FILE = "file",
  }

  /** Options passed to the constructor. */
  export interface InitOptions {
    sizeLimit?: number;
    outputType?: OutputType;
    allowedFileTypes?: string[];
  }

  /** Options passed to resizeImage. */
  export interface ResizeImageOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  }

  /** Metadata returned by resizeImage. */
  export interface ImageMetadata {
    originalHeight: number;
    originalWidth: number;
    resizedHeight: number;
    resizedWidth: number;
  }

  /** Return type for resizeImage. */
  export interface ResizeImageReturn {
    output: Blob | string;
    metadata: ImageMetadata;
  }

  export class TransformImage {
    constructor(options?: InitOptions);

    async resizeImage(
      image: File | Blob,
      options?: ResizeImageOptions,
      fileName?: string
    ): Promise<ResizeImageReturn>;
  }
}
