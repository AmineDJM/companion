import { notFound } from 'next/navigation';
import { requireAuth } from '@/server/auth/session';
import { getCompanionById } from '@/server/services/companions';
import { listFiles, listVersions } from '@/server/services/files';
import { loadWorkspaceContext } from '@/server/services/workspace';
import { FileManager } from '@/components/app/file-manager';

export const dynamic = 'force-dynamic';

export default async function CompanionFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;

  const companion = await getCompanionById(id, auth.workspace.id);
  if (!companion) notFound();

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) notFound();

  const files = await listFiles(companion.id);
  const versions = await Promise.all(
    files.map(async (file) => ({
      fileId: file.id,
      versions: file.versionCount > 1 ? await listVersions(file.id) : [],
    })),
  );
  const versionsByFile = new Map(versions.map((entry) => [entry.fileId, entry.versions]));

  return (
    <FileManager
      companionId={companion.id}
      defaultFileId={companion.defaultFileId}
      canReplace={workspace.entitlements.replaceDocuments}
      files={files.map((file) => ({
        id: file.id,
        name: file.name,
        path: file.path,
        kind: file.kind,
        status: file.status,
        statusMessage: file.statusMessage,
        sizeBytes: file.sizeBytes,
        pageCount: file.pageCount,
        isContainer: file.isContainer,
        versionCount: file.versionCount,
        versions: (versionsByFile.get(file.id) ?? []).map((version) => ({
          version: version.version,
          createdAt: version.createdAt.toISOString(),
          sizeBytes: version.sizeBytes,
          filename: version.originalFilename,
          current: version.supersededAt === null,
        })),
      }))}
    />
  );
}
