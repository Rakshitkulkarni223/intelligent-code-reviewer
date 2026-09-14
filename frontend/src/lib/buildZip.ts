import JSZip from 'jszip';

// Backend project review (docs/PROJECT_ZIP_REVIEW_PLAN.md) only ever accepts
// a real zip archive -- zip_extraction.py works on actual zip bytes, not an
// arbitrary file list. So when a user picks loose files or a folder instead
// of an already-zipped archive, this bundles them into one client-side,
// reusing the exact same upload pipeline (uploadProjectManifest) unchanged.

export async function filesToZip(files: File[], zipName = 'project.zip'): Promise<File> {
  const zip = new JSZip();
  for (const file of files) {
    // webkitRelativePath is set when the picker used webkitdirectory (a
    // real folder selection, e.g. "my-app/src/main.py") -- preserves the
    // structure the tier/manifest logic groups files by. A plain multi-file
    // selection (no folder) has no relative path, so files land flat at the
    // archive root instead, which is the best this input shape can do.
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    zip.file(path, file);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return new File([blob], zipName, { type: 'application/zip' });
}

export function isSingleZipFile(files: File[]): boolean {
  return files.length === 1 && files[0].name.toLowerCase().endsWith('.zip');
}
