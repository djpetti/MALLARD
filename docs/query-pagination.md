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
If artifacts disappear between page selection and type lookup, they are
omitted, but the continuation still advances past the selected identities.
Such a page can be short or empty with a non-null nextCursor; use the token,
not the page length, to decide whether to continue. Use a snapshot/export
mechanism if a complete point-in-time result is needed.

### Performance

Cursor queries use keyset predicates and a limit, not a growing offset. They
fetch at most one extra reference to determine whether another page exists;
there is no full result count. The page selection projects only artifact
identity and sort values so that a covering index can serve it. A separate,
bounded lookup determines the returned artifacts' image/video/raster types,
without loading full metadata relationships.

Revision `8c2f6a9d104e` adds virtual generated columns to `artifacts`:
`capture_date_is_null`, `session_name_is_null`, and `name_is_null`. The new
`ix_artifacts_cursor_sort` index orders these ranks and their source fields as:

```text
capture_date_is_null ASC, capture_date DESC,
session_name_is_null ASC, session_name ASC,
name_is_null ASC, name ASC, bucket ASC, key ASC
```

This matches the frontend's default capture-date/session/name ordering with
nulls last and deterministic identity tie breakers. Cursor SQL references the
generated columns explicitly: MariaDB 10.11 does not automatically replace an
ORDER BY CASE expression with an equivalent indexed generated column. On
continuation pages, leading sort terms fixed to NULL by the seek predicate
are omitted from ORDER BY to avoid unnecessary MariaDB filesorts; the logical
ordering and token format remain unchanged.

The existing legacy sort index is retained. This new index targets the default
ordering, not every combination of filters or sort directions. Other nullable
fields still use portable CASE ranking; custom sorts and selective filters may
need different indexes or plans. SQLite can still choose a temporary sort on
some continuation predicates. Removing offsets alone never guarantees bounded
work for an arbitrary search.

### Deploying the cursor sort index

1. Back up the metadata database and test the migration on staging first.
2. Apply `alembic upgrade head` from the repository root in the configured
   gateway/database migration environment, using the production database's
   connection configuration. This is the same migration command used by
   `init_db.sh`; check that it targets the intended database before running it.
3. Confirm that `ix_artifacts_cursor_sort` and all three generated columns
   exist, then deploy/restart gateway workers with the updated code. Apply the
   migration **before** deploying the code: ORM queries now reference the new
   columns, including ordinary metadata reads.
4. Check the real default query with EXPLAIN. Expect index-ordered access to
   `artifacts` using `ix_artifacts_cursor_sort` rather than `ALL` plus
   `Using filesort`, followed by primary-key lookups into `rasters`. Test both
   the initial page and continuation through null-valued fields.

On a large table, adding the index can take significant time, temporary disk
space, and I/O, and may wait for metadata locks or block concurrent work.
Schedule a maintenance window appropriate for the deployment; the migration
does not promise lock-free or instant DDL. Do not drop the existing legacy
index to make room without evaluating clients that still use it. For rollback,
restore the old gateway code before downgrading the schema.

The database-specific regression tests use disposable databases only:

```sh
MALLARD_TEST_MARIADB_URL="mysql+aiomysql://USER:PASSWORD@HOST/TEST_DB" \
  python -m pytest mallard/gateway/backends/metadata/sql/tests/test_cursor_index_plan.py
```

The supplied account needs CREATE/DROP DATABASE privileges. The tests create
and remove unique owned databases; they do not modify the database named in
the URL. Use a disposable test server, not production. Without the variable,
MariaDB-specific cases are skipped and SQLite coverage still runs.
