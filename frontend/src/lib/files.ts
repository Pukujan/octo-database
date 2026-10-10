import { apiSend } from './api';

// File transport shared by the Files view and the header upload control.

export async function uploadFile(workspaceId: string, file: File): Promise<void> {
  const data = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...Array.from(data.subarray(offset, offset + 0x8000)));
  }
  await apiSend('/api/files/upload', 'POST', {
    workspaceId,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    data: btoa(binary),
    dataEncoding: 'base64',
  });
}

export async function downloadFile(workspaceId: string, id: string, name: string): Promise<void> {
  const blob = await fetch(`/api/files/content?workspaceId=${encodeURIComponent(workspaceId)}&fileId=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('octo_token') ?? ''}` },
  }).then(async (response) => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Download failed');
    return response.blob();
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
