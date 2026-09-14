import { useMemo, useState } from 'react';
import type { ExcludedEntry, ManifestFile, PriorityTier } from '../types';

interface Props {
  files: ManifestFile[];
  excluded: ExcludedEntry[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onToggleMany: (paths: string[], nextSelected: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

const TIER_LABELS: Record<PriorityTier, string> = {
  auth: 'auth', api: 'api', data: 'data', source: 'source',
  util: 'util', config: 'config', test: 'test', docs: 'docs',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface FolderNode {
  kind: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}
interface FileNode {
  kind: 'file';
  name: string;
  file: ManifestFile;
}
type TreeNode = FolderNode | FileNode;

// A real nested tree (VS Code-style: folders before files, alphabetical
// within each, collapsible, indented by depth) rather than the earlier
// flat-by-top-directory grouping -- built once from the manifest's flat
// file list, which only ever describes files (no explicit empty-directory
// entries), so every folder node here is guaranteed to contain something.
function buildTree(files: ManifestFile[]): FolderNode {
  const root: FolderNode = { kind: 'folder', name: '', path: '', children: [] };
  for (const file of files) {
    const segments = file.path.split('/');
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const path = segments.slice(0, i + 1).join('/');
      let next = cursor.children.find((c): c is FolderNode => c.kind === 'folder' && c.name === seg);
      if (!next) {
        next = { kind: 'folder', name: seg, path, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push({ kind: 'file', name: segments[segments.length - 1], file });
  }
  const sortRec = (node: FolderNode) => {
    node.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
    for (const c of node.children) if (c.kind === 'folder') sortRec(c);
  };
  sortRec(root);
  return root;
}

function allFolderPaths(node: FolderNode, acc: string[] = []): string[] {
  for (const c of node.children) {
    if (c.kind === 'folder') {
      acc.push(c.path);
      allFolderPaths(c, acc);
    }
  }
  return acc;
}

function descendantFilePaths(node: FolderNode): string[] {
  const acc: string[] = [];
  const walk = (n: FolderNode) => {
    for (const c of n.children) {
      if (c.kind === 'file') acc.push(c.file.path);
      else walk(c);
    }
  };
  walk(node);
  return acc;
}

const CHEVRON = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9,5 16,12 9,19" />
  </svg>
);
const FOLDER_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" />
  </svg>
);

function FolderRow({
  node, depth, selected, onToggleMany, expanded, onToggleExpand,
}: {
  node: FolderNode; depth: number; selected: Set<string>;
  onToggleMany: (paths: string[], next: boolean) => void;
  expanded: boolean; onToggleExpand: () => void;
}) {
  const descendants = useMemo(() => descendantFilePaths(node), [node]);
  const selectedCount = descendants.filter((p) => selected.has(p)).length;
  const allSelected = selectedCount === descendants.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div
      className="file-tree-node file-tree-folder-row"
      style={{ paddingLeft: 10 + depth * 18 }}
      onClick={onToggleExpand}
    >
      <span className={`file-tree-chevron${expanded ? ' open' : ''}`} aria-hidden="true">{CHEVRON}</span>
      <input
        type="checkbox"
        className="file-tree-checkbox"
        checked={allSelected}
        ref={(el) => { if (el) el.indeterminate = someSelected; }}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleMany(descendants, !allSelected)}
      />
      <span className="file-tree-folder-icon" aria-hidden="true">{FOLDER_ICON}</span>
      <span className="file-tree-folder-name">{node.name}</span>
      <span className="file-tree-folder-count">{descendants.length}</span>
    </div>
  );
}

function FileRow({ node, depth, selected, onToggle }: { node: FileNode; depth: number; selected: Set<string>; onToggle: (path: string) => void }) {
  const f = node.file;
  return (
    <label className="file-tree-node file-tree-row" style={{ paddingLeft: 34 + depth * 18 }}>
      <input
        type="checkbox"
        className="file-tree-checkbox"
        checked={selected.has(f.path)}
        onChange={() => onToggle(f.path)}
      />
      <span className="file-tree-path">{node.name}</span>
      <span className={`badge tier-badge tier-${f.tier}`}>{TIER_LABELS[f.tier]}</span>
      <span className="file-tree-meta">{f.lines.toLocaleString()} lines &middot; {formatSize(f.size)}</span>
    </label>
  );
}

function TreeLevel({
  nodes, depth, selected, onToggle, onToggleMany, expandedFolders, onToggleExpand,
}: {
  nodes: TreeNode[]; depth: number; selected: Set<string>;
  onToggle: (path: string) => void; onToggleMany: (paths: string[], next: boolean) => void;
  expandedFolders: Set<string>; onToggleExpand: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'folder' ? (
          <div key={node.path}>
            <FolderRow
              node={node} depth={depth} selected={selected} onToggleMany={onToggleMany}
              expanded={expandedFolders.has(node.path)} onToggleExpand={() => onToggleExpand(node.path)}
            />
            {expandedFolders.has(node.path) && (
              <TreeLevel
                nodes={node.children} depth={depth + 1} selected={selected} onToggle={onToggle}
                onToggleMany={onToggleMany} expandedFolders={expandedFolders} onToggleExpand={onToggleExpand}
              />
            )}
          </div>
        ) : (
          <FileRow key={node.file.path} node={node} depth={depth} selected={selected} onToggle={onToggle} />
        )
      )}
    </>
  );
}

export default function ProjectFileTree({ files, excluded, selected, onToggle, onToggleMany, onSelectAll, onDeselectAll }: Props) {
  const [showExcluded, setShowExcluded] = useState(false);
  const tree = useMemo(() => buildTree(files), [files]);
  // All folders start expanded -- matches VS Code's default when opening a
  // project small enough that this per-file review tool applies to in the
  // first place (§4.1 caps at 500 files).
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(allFolderPaths(tree)));

  const toggleExpand = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectedLines = files.filter((f) => selected.has(f.path)).reduce((s, f) => s + f.lines, 0);
  const selectedSize = files.filter((f) => selected.has(f.path)).reduce((s, f) => s + f.size, 0);

  return (
    <div className="card file-tree-card">
      <div className="file-tree-toolbar">
        <div className="file-tree-stats">
          <span><strong>{selected.size}</strong> file{selected.size === 1 ? '' : 's'} selected</span>
          <span>{selectedLines.toLocaleString()} lines</span>
          <span>{formatSize(selectedSize)}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }} onClick={onSelectAll}>Select all</button>
          <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }} onClick={onDeselectAll}>Deselect all</button>
        </div>
      </div>

      <div className="file-tree-scroll">
        <TreeLevel
          nodes={tree.children} depth={0} selected={selected} onToggle={onToggle}
          onToggleMany={onToggleMany} expandedFolders={expandedFolders} onToggleExpand={toggleExpand}
        />
      </div>

      {excluded.length > 0 && (
        <div>
          <button className="file-tree-excluded-toggle" onClick={() => setShowExcluded((v) => !v)}>
            <span className={`file-tree-excluded-chevron${showExcluded ? ' open' : ''}`} aria-hidden="true">▸</span>
            {excluded.length} file{excluded.length === 1 ? '' : 's'} auto-excluded
          </button>
          {showExcluded && (
            <div className="file-tree-scroll" style={{ maxHeight: 200 }}>
              {excluded.map((e) => (
                <div key={e.path} className="file-tree-excluded-row">
                  <span>{e.path}</span>
                  <span>{e.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
