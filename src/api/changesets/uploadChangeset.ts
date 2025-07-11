import type { OsmChange, Tags } from "../../types";
import { type FetchOptions, osmFetch } from "../_osmFetch";
import { version } from "../../../package.json";
import {
  createChangesetMetaXml,
  createOsmChangeXml,
} from "./_createOsmChangeXml";
import { chunkOsmChange, getOsmChangeSize } from "./chunkOsmChange";

export interface UploadChunkInfo {
  /** the total number of features being uploaded (counting all chunks) */
  featureCount: number;

  /** the index of this changeset (the first is 0) */
  changesetIndex: number;
  /** the number of changesets required for this upload */
  changesetTotal: number;
}

/**
 * uploads a changeset to the OSM API.
 * @returns the changeset number
 */
export async function uploadChangeset(
  tags: Tags,
  diff: OsmChange,
  options?: FetchOptions & {
    /**
     * Some changesets are too big to upload, so they have to be
     * split ("chunked") into multiple changesets.
     * When this happens, you can customize the changeset tags for
     * each chunk by returning {@link Tags}.
     */
    onChunk?(info: UploadChunkInfo): Tags;
  }
): Promise<number> {
  const chunks = chunkOsmChange(diff);
  const csIds: number[] = [];

  const featureCount = getOsmChangeSize(diff);

  for (const [index, chunk] of chunks.entries()) {
    let tagsForChunk = tags;

    // if this is a chunk of an enourmous changeset, the tags
    // for each chunk get custom tags
    if (chunks.length > 1) {
      if (options?.onChunk) {
        // there is a custom implementation for tags.
        tagsForChunk = options.onChunk({
          featureCount,
          changesetIndex: index,
          changesetTotal: chunks.length,
        });
      } else {
        // there is no custom implementation,
        // so add some default tags to the changeset.
        tagsForChunk["chunk"] = `${index + 1}/${chunks.length}`;
      }
    }

    // if the user didn't include a `created_by` tag, we'll add one.
    tagsForChunk["created_by"] ||= `osm-api-js ${version}`;

    const csId = +(await osmFetch<string>("/0.6/changeset/create", undefined, {
      ...options,
      method: "PUT",
      body: createChangesetMetaXml(tagsForChunk),
      headers: {
        ...options?.headers,
        "content-type": "application/xml; charset=utf-8",
      },
    }));

    const osmChangeXml = createOsmChangeXml(csId, chunk);

    await osmFetch(`/0.6/changeset/${csId}/upload`, undefined, {
      ...options,
      method: "POST",
      body: osmChangeXml,
      headers: {
        ...options?.headers,
        "content-type": "application/xml; charset=utf-8",
      },
    });

    await osmFetch(`/0.6/changeset/${csId}/close`, undefined, {
      ...options,
      method: "PUT",
    });
    csIds.push(csId);
  }

  return csIds[0]; // TODO:(semver breaking) return an array of IDs
}
