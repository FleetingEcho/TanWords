export interface DocumentRevision {
  id: string;
  title: string;
  content: string;
  contentText: string;
  wordCount: number;
  createdAt: number;
}

const KEY_PREFIX = "tanwords_doc_revisions_v1:";
const LOCAL_KEY_PREFIX = "tanwords_local_doc_revisions_v1:";
const MAX_REVISIONS = 10;

function key(documentId: number): string {
  return `${KEY_PREFIX}${documentId}`;
}

export function saveDocumentRevision(documentId: number, revision: Omit<DocumentRevision, "id" | "createdAt">): void {
  try {
    const existing = listDocumentRevisions(documentId);
    const next: DocumentRevision[] = [
      {
        ...revision,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      },
      ...existing,
    ].slice(0, MAX_REVISIONS);
    localStorage.setItem(key(documentId), JSON.stringify(next));
  } catch {
    // Version history is a convenience; never block saving on it.
  }
}

export function listDocumentRevisions(documentId: number): DocumentRevision[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(documentId)) ?? "[]");
    return Array.isArray(parsed) ? parsed as DocumentRevision[] : [];
  } catch {
    return [];
  }
}

export function getDocumentRevision(documentId: number, revisionId: string): DocumentRevision | null {
  return listDocumentRevisions(documentId).find((revision) => revision.id === revisionId) ?? null;
}

export function saveLocalDocumentRevision(
  relPath: string,
  revision: Omit<DocumentRevision, "id" | "createdAt">,
): void {
  try {
    const existing = listLocalDocumentRevisions(relPath);
    const next: DocumentRevision[] = [
      {
        ...revision,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      },
      ...existing,
    ].slice(0, MAX_REVISIONS);
    localStorage.setItem(`${LOCAL_KEY_PREFIX}${encodeURIComponent(relPath)}`, JSON.stringify(next));
  } catch {
    // Best-effort snapshot.
  }
}

export function listLocalDocumentRevisions(relPath: string): DocumentRevision[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${LOCAL_KEY_PREFIX}${encodeURIComponent(relPath)}`) ?? "[]");
    return Array.isArray(parsed) ? parsed as DocumentRevision[] : [];
  } catch {
    return [];
  }
}
