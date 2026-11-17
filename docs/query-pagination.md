# Query pagination

`POST /query` supports legacy page-number pagination and opt-in keyset cursor
pagination. The request body is unchanged, for example:

```json
{
  "queries": [{}],
  "orderings": [{ "field": "capture_date", "ascending": false }]
}
```

The frontend always uses cursor pagination, including the initial request and
bounded autocomplete queries. Legacy pagination remains available on the
backend for other clients. Regenerate the frontend API client when building
against the cursor-capable backend.

## Legacy pagination

Omit the `cursor` query parameter:

```text
POST /query?results_per_page=50&page_num=2
```

The response retains its original shape:

```json
{
  "imageIds": [],
  "pageNum": 2,
  "isLastPage": true
}
```

Legacy pagination still uses offsets. A full page reports `isLastPage: false`,
even if it is the final nonempty page; the next page can be empty.

## Cursor pagination

Start by supplying an **empty** `cursor` query parameter:

```text
POST /query?results_per_page=50&cursor=
```

Cursor responses include a continuation token:

```json
{
  "imageIds": [
    { "id": { "bucket": "example", "name": "image.jpg" }, "type": "image" }
  ],
  "pageNum": null,
  "isLastPage": false,
  "nextCursor": "<opaque continuation token>"
}
```

Send that token as the next request's `cursor` query parameter, keeping the
same `queries` and `orderings` body. Page size may change between requests.
Treat the token as opaque; do not construct it or depend on its encoding.
A final page has `nextCursor: null` and `isLastPage: true`, including when it
contains exactly `results_per_page` results. There is no page number in cursor
mode, so `pageNum` is null. Omit `page_num` or leave it at 1; combining a cursor
with another page number is an error. To restart, send `cursor=` again.

Cursor mode currently requires the **SQL metadata backend**. iRODS and other
backends that have not implemented keyset queries return HTTP 501 for cursor
requests; their legacy pagination remains available. Invalid, oversized, or
query/order-mismatched tokens return HTTP 422. The frontend does not fall back
to legacy pagination on these errors or on HTTP 501; frontend deployments
therefore require a cursor-capable metadata backend.

### Ordering and consistency

SQL cursor queries use the requested ordering fields, followed by ascending
artifact bucket and key to break ties. With no requested orderings, results
are ordered by bucket and key. Nullable sort fields put null values last in
both ascending and descending order. These guarantees apply to cursor mode;
legacy ordering behavior is unchanged.

The token records ordering values rather than requiring the last artifact to
still exist. Deleting that artifact does not invalidate continuation. Tokens
are versioned and bound to the query and ordering, but are not signed or
encrypted: they are validated untrusted input, not authorization credentials.
They can expose sort values and object identity to the requesting client.
Normal request authentication and authorization still apply.

Cursor traversal is not a database snapshot. Concurrent edits to sort fields,
query membership changes, and newly visible records can affect the results.
Use a snapshot/export mechanism if a complete point-in-time result is needed.

### Performance

Cursor queries use keyset predicates and a limit, not a growing offset. They
fetch at most one extra artifact to determine whether another page exists;
there is no full result count. This removes the work of skipping earlier
pages, but filtering, joins, relationship loading, and sorting can still cost
time. Suitable indexes and actual query plans matter. In particular, the
portable null-last ordering of nullable columns uses a CASE expression that
may require a sort rather than ordinary index ordering. No schema or index
migration is included in this change.
