/**
 * Service worker the implements bulk downloading.
 */

self.addEventListener("fetch", async (event ): Response => {
   const body = await (event as FetchEvent).request.text();
   // The files to download should be passed as JSON data.
    const downloadUrls = JSON.parse(body);
});
