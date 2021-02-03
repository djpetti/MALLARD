import asyncio
from pathlib import Path

from irods.session import iRODSSession

from mallard.backends.metadata.irods_image_metadata_store import (
    IrodsImageMetadataStore,
)
from mallard.backends.metadata.models import ImageQuery, UavImageMetadata
from mallard.backends.objects.irods_object_store import IrodsObjectStore
from mallard.backends.objects.models import ObjectRef


async def main():
    with iRODSSession(
        host="localhost",
        port=1247,
        user="rods",
        password="password",
        zone="tempZone",
    ) as session:
        object_store = IrodsObjectStore(
            session=session, root_collection=Path("/tempZone/mallard/")
        )
        meta_store = IrodsImageMetadataStore(
            session=session, root_collection=Path("/tempZone/mallard/")
        )

        # Create the bucket.
        await object_store.create_bucket("bucket")

        # Create the metadata.
        metadata = UavImageMetadata(
            name="image1.jpg", session_number=0, sequence_number=0
        )
        metadata2 = UavImageMetadata(
            name="image2.jpg", session_number=1, sequence_number=2
        )

        await meta_store.add(
            object_id=ObjectRef(bucket="bucket", name="image1.jpg"),
            metadata=metadata,
        )
        await meta_store.add(
            object_id=ObjectRef(bucket="bucket", name="image2.jpg"),
            metadata=metadata2,
        )

        query = ImageQuery(name="image")

        print([r async for r in meta_store.query(query)])

        # Clean up after ourselves.
        await object_store.delete_bucket("bucket")


asyncio.run(main())
