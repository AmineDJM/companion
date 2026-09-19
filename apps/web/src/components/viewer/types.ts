import type { Branding, CompanionStatus, DocumentKind } from '@companion/shared';

export interface ViewerFile {
  id: string;
  name: string;
  path: string;
  kind: DocumentKind;
  folderPath: string | null;
  pageCount: number | null;
  sizeBytes: number;
  ready: boolean;
  statusMessage: string | null;
}

export interface ViewerPreview {
  kind: 'page_images' | 'pdf' | 'sheets' | 'image' | 'text' | 'unavailable';
  pageCount: number;
  baseUrl: string;
  mimeType: string;
}

export interface ViewerData {
  slug: string;
  name: string;
  status: CompanionStatus;
  senderLabel: string;
  branding: Branding;
  downloadAllowed: boolean;
  aiEnabled: boolean;
  expiresAt: string | null;
  files: ViewerFile[];
  activeFileId: string | null;
  preview: ViewerPreview | null;
  multiFile: boolean;
}
