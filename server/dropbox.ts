import { Dropbox } from 'dropbox';

// Dropbox integration - uses DROPBOX_ACCESS_TOKEN secret directly
// Falls back to Replit OAuth integration if available

let oauthConnectionSettings: any;

async function getAccessToken(): Promise<string> {
  // Prefer direct access token from env (user-provided)
  if (process.env.DROPBOX_ACCESS_TOKEN) {
    return process.env.DROPBOX_ACCESS_TOKEN;
  }

  // Fallback: Replit OAuth integration
  if (oauthConnectionSettings && oauthConnectionSettings.settings.expires_at && new Date(oauthConnectionSettings.settings.expires_at).getTime() > Date.now()) {
    return oauthConnectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('Dropbox not connected. Please set DROPBOX_ACCESS_TOKEN.');
  }

  oauthConnectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=dropbox',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken,
      },
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = oauthConnectionSettings?.settings?.access_token || oauthConnectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!oauthConnectionSettings || !accessToken) {
    throw new Error('Dropbox not connected. Please set DROPBOX_ACCESS_TOKEN.');
  }
  return accessToken;
}

// WARNING: Never cache this client. Access tokens expire.
// Always call this function again to get a fresh client.
export async function getUncachableDropboxClient() {
  const accessToken = await getAccessToken();
  return new Dropbox({ accessToken });
}

export async function uploadToDropbox(fileBuffer: Buffer, fileName: string, mimeType: string, folderPath = '') {
  const dbx = await getUncachableDropboxClient();
  const base = folderPath && folderPath !== '/' ? folderPath : '';
  const dropboxPath = `${base}/${fileName}`;

  const uploadResult = await dbx.filesUpload({
    path: dropboxPath,
    contents: fileBuffer,
    mode: { '.tag': 'add' },
    autorename: true,
  });

  // Create a shared link
  let shareUrl: string;
  try {
    const linkResult = await dbx.sharingCreateSharedLinkWithSettings({
      path: uploadResult.result.path_display!,
      settings: { requested_visibility: { '.tag': 'public' } },
    });
    shareUrl = linkResult.result.url.replace('?dl=0', '?dl=1');
  } catch (e: any) {
    if (e.error?.error?.['.tag'] === 'shared_link_already_exists') {
      const existingLink = e.error.error.shared_link_already_exists.metadata;
      shareUrl = (existingLink?.url || '').replace('?dl=0', '?dl=1');
    } else {
      shareUrl = '';
    }
  }

  return {
    dropboxPath: uploadResult.result.path_display,
    shareUrl,
    fileName: uploadResult.result.name,
    size: uploadResult.result.size,
  };
}

export async function listDropboxFiles(folderPath = '') {
  const dbx = await getUncachableDropboxClient();
  try {
    const path = folderPath === '/' ? '' : folderPath;
    const result = await dbx.filesListFolder({ path, limit: 200 });
    return result.result.entries.map((entry: any) => ({
      name: entry.name,
      path: entry.path_display,
      type: entry['.tag'],
      size: entry.size || 0,
      modified: entry.server_modified || null,
      id: entry.id,
    }));
  } catch {
    return [];
  }
}

export async function getDropboxShareLink(dropboxPath: string) {
  const dbx = await getUncachableDropboxClient();
  try {
    const result = await dbx.sharingCreateSharedLinkWithSettings({
      path: dropboxPath,
      settings: { requested_visibility: { '.tag': 'public' } },
    });
    return result.result.url.replace('?dl=0', '?dl=1');
  } catch (e: any) {
    if (e.error?.error?.['.tag'] === 'shared_link_already_exists') {
      const existing = e.error.error.shared_link_already_exists.metadata;
      return (existing?.url || '').replace('?dl=0', '?dl=1');
    }
    return null;
  }
}
